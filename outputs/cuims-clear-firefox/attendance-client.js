// Talks to students.cuchd.in with the browser's own CUIMS session.
// The caller decides when a sign-in is allowed; this file never retries a
// login submit on its own, and never touches a login page while signed in.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const ORIGIN = "https://students.cuchd.in";
  const HOME = "/StudentHome.aspx";
  const ATTENDANCE = "/frmStudentCourseWiseAttendanceSummary.aspx";
  const ATTENDANCE_QUERY = "?type=etgkYfqBdH1fSfc255iYGw==";
  const TIMETABLE = "/frmMyTimeTable.aspx";
  const TIMETABLE_TARGET = "ctl00$ContentPlaceHolder1$ReportViewer1$ctl09$Reserved_AsyncLoadTarget";

  const LOCKOUT = [
    /try\s+after\s+\d+\s*min/i,
    /try\s+again\s+after\s+\d+/i,
    /account\s+(has\s+been\s+)?lock/i,
    /locked\s+(out|for\s+\d+)/i,
    /too\s+many\s+(failed\s+)?(login|attempt)/i,
    /temporarily\s+(disabled|locked|blocked)/i,
    /login\s+disabled\s+for/i,
  ];
  const BAD_CAPTCHA = /invalid\s+captcha|captcha\s+(code\s+)?(is\s+)?(invalid|incorrect|wrong|mismatch)|wrong\s+captcha/i;
  const BAD_PASSWORD = /invalid\s+(user(\s*id)?|uid|password|credentials)|incorrect\s+(user|uid|password)|user\s*id\s+or\s+password|wrong\s+password/i;

  const MESSAGES = {
    "needs-login": "Save your UID and password on the Login tab first.",
    "bad-password": "CUIMS rejected the saved UID or password. Fix it on the Login tab.",
    "bad-uid": "CUIMS did not accept the saved UID.",
    "bad-captcha": "The captcha read was wrong. Try again in a moment.",
    lockout: "CUIMS has paused logins for this account. Wait about 20 minutes.",
    cooldown: "A few sign-ins failed recently. Waiting before trying again.",
    busy: "Going easy on CUIMS. Try again in a few minutes.",
    network: "CUIMS did not respond. Try again.",
    server: "CUIMS is having trouble right now. Try again later.",
    "portal-redirect": "CUIMS sent attendance back to the home page. Open CUIMS once, then refresh.",
    "report-shape": "CUIMS changed the attendance report, so it could not be read.",
    "login-shape": "CUIMS changed its login page, so sign-in could not run.",
    "signed-out": "Signed out of CUIMS.",
  };

  function coded(code, message) {
    const error = new Error(message || MESSAGES[code] || "Could not fetch attendance.");
    error.code = code;
    return error;
  }

  function url(path) {
    return new URL(path, `${ORIGIN}/`).href;
  }

  function isLoginUrl(value) {
    try {
      const { pathname } = new URL(value);
      return pathname === "/" || /^\/login\.aspx$/i.test(pathname);
    } catch {
      return false;
    }
  }

  // One request, redirects followed by the browser, cookies from the shared
  // jar. `budget` is called before every request so the daemon can meter them.
  function createRequest({ fetchImpl = root.fetch?.bind(root), timeoutMs = 20_000, budget } = {}) {
    return async function request(target, options = {}) {
      budget?.();
      const headers = new Headers(options.headers || {});
      let response;
      try {
        response = await fetchImpl(target, {
          method: options.method || "GET",
          headers,
          body: options.body,
          credentials: "include",
          redirect: "follow",
          cache: "no-store",
          signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
        });
      } catch {
        throw coded("network");
      }
      if (response.status === 429 || response.status === 503) throw coded("busy");
      if (response.status >= 500) throw coded("server");
      const finalUrl = response.url || target;
      if (options.raw) return { url: finalUrl, status: response.status, bytes: await response.arrayBuffer() };
      return { url: finalUrl, status: response.status, html: await response.text() };
    };
  }

  function formBody(fields) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.set(key, value ?? "");
    return body.toString();
  }

  function postForm(request, target, fields) {
    return request(target, {
      method: "POST",
      body: formBody(fields),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }

  async function postJson(request, path, payload) {
    const result = await request(url(path), {
      method: "POST",
      body: payload,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    if (isLoginUrl(result.url) || api.isLoginDocument(result.html)) throw coded("signed-out");
    let parsed;
    try {
      parsed = JSON.parse(result.html || "");
    } catch {
      throw coded("report-shape");
    }
    const rows = api.unwrapReport(parsed);
    if (!rows) throw coded("report-shape");
    return rows;
  }

  function quote(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  // The attendance page doubles as the session check: signed out, CUIMS
  // redirects it to Login.aspx.
  async function openAttendance(request) {
    const page = await request(url(`${ATTENDANCE}${ATTENDANCE_QUERY}`));
    if (isLoginUrl(page.url) || api.isLoginDocument(page.html)) throw coded("signed-out");
    const meta = api.extractReportMeta(page.html);
    if (meta.reportId && meta.sessionId) return meta;
    if (/StudentHome\.aspx/i.test(page.url)) throw coded("portal-redirect");
    throw coded("report-shape");
  }

  async function readSummary(request, meta) {
    const rows = await postJson(request, `${ATTENDANCE}/GetReport`, `{UID:'${quote(meta.reportId)}',Session:'${quote(meta.sessionId)}'}`);
    const subjects = rows.map(api.normalizeSummary).filter(Boolean);
    if (!subjects.length) throw coded("report-shape");
    return subjects;
  }

  async function readMarks(request, meta, encryptCode) {
    const rows = await postJson(
      request,
      `${ATTENDANCE}/GetFullReport`,
      `{course:'${quote(encryptCode)}',UID:'${quote(meta.reportId)}',fromDate:'0',toDate:'0',type:'All',Session:'${quote(meta.sessionId)}'}`,
    );
    return api.normalizeMarks(rows);
  }

  async function readTimetable(request) {
    const target = url(TIMETABLE);
    let page = await request(target);
    if (isLoginUrl(page.url) || api.isLoginDocument(page.html)) throw coded("signed-out");
    if (!/gvMyTimeTable/i.test(page.html || "")) {
      page = await postForm(request, target, { ...api.hiddenFields(page.html), __EVENTTARGET: TIMETABLE_TARGET, __EVENTARGUMENT: "" });
    }
    return api.parseTimetable(page.html);
  }

  async function pingHome(request) {
    const page = await request(url(HOME));
    return !(isLoginUrl(page.url) || api.isLoginDocument(page.html));
  }

  function loginOutcome(page) {
    if (!isLoginUrl(page.url) && !api.isLoginDocument(page.html)) return "ok";
    const text = api.stripTags(page.html);
    if (LOCKOUT.some((pattern) => pattern.test(text))) return "lockout";
    const captcha = BAD_CAPTCHA.test(text);
    const password = BAD_PASSWORD.test(text.replace(BAD_CAPTCHA, ""));
    if (password) return "bad-password";
    if (captcha) return "bad-captcha";
    return "rejected";
  }

  function validCaptcha(text) {
    return /^[A-Za-z0-9]{4,6}$/.test(text);
  }

  // UID step, password step, one submit. Unreadable captchas are re-drawn
  // (at most `reads` times) before anything is submitted, since only a submit
  // counts against CUIMS's lockout.
  async function signIn({ request, uid, password, solveCaptcha, reads = 3, onStep }) {
    onStep?.("Signing in…");
    const start = await request(url("/"));
    if (!api.isUidStep(start.html)) {
      if (!isLoginUrl(start.url)) return { outcome: "ok", submitted: false };
      throw coded("login-shape");
    }
    const step = await postForm(request, new URL(api.formAction(start.html) || "./", start.url).href, {
      ...api.hiddenFields(start.html),
      txtUserId: uid,
      btnNext: "NEXT",
    });
    if (!api.isPasswordStep(step.html)) {
      const text = api.stripTags(step.html);
      if (LOCKOUT.some((pattern) => pattern.test(text))) throw coded("lockout");
      throw coded(api.isUidStep(step.html) || isLoginUrl(step.url) ? "bad-uid" : "login-shape");
    }

    const src = api.captchaSrc(step.html);
    if (!src) throw coded("login-shape");
    let answer = "";
    for (let read = 0; read < reads && !validCaptcha(answer); read += 1) {
      const imageUrl = read === 0 ? new URL(src, step.url).href : url(`/GenerateCaptcha.aspx?${Date.now()}`);
      const image = await request(imageUrl, { raw: true });
      try {
        answer = String(await solveCaptcha(image.bytes)).trim();
      } catch {
        answer = "";
      }
    }
    if (!validCaptcha(answer)) throw coded("bad-captcha", "Could not read the captcha. Try again.");

    onStep?.("Checking the login…");
    const posted = await postForm(request, new URL(api.formAction(step.html) || step.url, step.url).href, {
      ...api.hiddenFields(step.html),
      txtLoginPassword: password,
      txtcaptcha: answer,
      btnLogin: "LOGIN",
    });
    return { outcome: loginOutcome(posted), submitted: true };
  }

  api.MESSAGES = MESSAGES;
  api.coded = coded;
  api.isLoginUrl = isLoginUrl;
  api.createRequest = createRequest;
  api.openAttendance = openAttendance;
  api.readSummary = readSummary;
  api.readMarks = readMarks;
  api.readTimetable = readTimetable;
  api.pingHome = pingHome;
  api.loginOutcome = loginOutcome;
  api.signIn = signIn;
})(globalThis);
