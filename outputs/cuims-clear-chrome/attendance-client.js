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
  // CUIMS finishes a login in the browser: LandingPage.aspx calls this, and
  // until it runs the session has no menu rights, so every inner page
  // (attendance, timetable) redirects to error.html.
  const LANDING_INIT = "/LandingPage.aspx/ShowLandingPage";
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
    "report-shape": "CUIMS answered without the attendance report.",
    "login-shape": "CUIMS changed its login page, so sign-in could not run.",
    "signed-out": "Signed out of CUIMS.",
    "tab-login": "A CUIMS tab is signing in. Attendance refreshes once it is done.",
    "portal-busy": "CUIMS is limiting requests right now.",
    "page-limit": "CUIMS is limiting page loads for your account right now.",
    cancelled: "Sign-in was stopped before it submitted.",
    yield: "A CUIMS tab is in use, so this page waits.",
  };

  function coded(code, message, detail) {
    const error = new Error(message || MESSAGES[code] || "Could not fetch attendance.");
    error.code = code;
    if (detail) error.detail = detail;
    return error;
  }

  // What CUIMS actually sent when it was not the report, kept short so it
  // can be stored and shown when diagnosing a refusal or a changed page.
  function describe(result) {
    const html = String(result?.html || "");
    return {
      url: result?.url || "",
      status: result?.status || 0,
      title: api.stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 120),
      text: api.stripTags(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")).slice(0, 280),
    };
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

  // Anything that makes CUIMS draw or check a captcha for this session.
  function isLoginFlow(value) {
    if (isLoginUrl(value)) return true;
    try {
      return /^\/generatecaptcha\.aspx$/i.test(new URL(value).pathname);
    } catch {
      return false;
    }
  }

  // Pages we space locally: portal .aspx pages and the landing step of a
  // sign-in. This classification is not a measured server quota.
  function isInnerPage(value) {
    try {
      const path = new URL(value).pathname.toLowerCase();
      if (path === LANDING_INIT.toLowerCase()) return true;
      return /\.aspx$/.test(path) && !isLoginFlow(value);
    } catch {
      return false;
    }
  }

  function isRedirect(response) {
    return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
  }

  // One request with cookies from the shared jar. `budget` meters requests,
  // and is told each target and its options, so it can tell report calls,
  // pages and optional pages apart. `observe` hears how each one went.
  // CUIMS keeps one captcha per session and a CUIMS tab shares this session,
  // so while `yieldToTab` says a tab is on the login page, nothing here may
  // reach the login flow: login URLs are refused and redirects are not
  // followed, because a signed-out redirect lands on Login.aspx. Every request
  // that does reach the login flow is reported through `onLoginTouch`.
  function createRequest({ fetchImpl = root.fetch?.bind(root), timeoutMs = 20_000, budget, yieldToTab, onLoginTouch, observe } = {}) {
    return async function request(target, options = {}) {
      let yielding = Boolean(await yieldToTab?.());
      if (yielding && isLoginFlow(target)) throw coded("tab-login");
      await budget?.(target, options);
      // Page admission can wait; a login tab that appeared meanwhile wins.
      yielding = Boolean(await yieldToTab?.());
      if (yielding && isLoginFlow(target)) throw coded("tab-login");
      const manual = yielding || options.manual || options.redirect === "manual";
      const headers = new Headers(options.headers || {});
      let response;
      const seen = (result, status = response?.status || 0, finalUrl = response?.url || target) => {
        try {
          observe?.({ target, url: finalUrl, status, result });
        } catch {}
      };
      try {
        response = await fetchImpl(target, {
          method: options.method || "GET",
          headers,
          body: options.body,
          credentials: options.anonymous ? "omit" : "include",
          redirect: manual ? "manual" : options.redirect || "follow",
          cache: "no-store",
          signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(options.timeoutMs ?? timeoutMs) : undefined,
        });
      } catch {
        seen("network", 0);
        throw coded("network");
      } finally {
        if (isLoginFlow(target)) await onLoginTouch?.();
      }
      if (manual && isRedirect(response)) {
        seen("redirect");
        throw coded(yielding ? "tab-login" : "signed-out");
      }
      const finalUrl = response.url || target;
      if (!isLoginFlow(target) && isLoginUrl(finalUrl)) await onLoginTouch?.();
      if (response.status === 429 || response.status === 503) {
        seen("portal-busy");
        throw coded("portal-busy", null, { retryAfter: response.headers?.get?.("retry-after") || "" });
      }
      // An inner page sent to error.html is unusable, whether the cause is a
      // throttle or missing session rights.
      if (isErrorPage(finalUrl)) {
        const code = isInnerPage(target) ? "page-limit" : "portal-busy";
        seen(code);
        throw coded(code);
      }
      if (response.status >= 500) {
        seen("server");
        throw coded("server");
      }
      if (options.raw) {
        seen("ok");
        return { url: finalUrl, status: response.status, bytes: await response.arrayBuffer() };
      }
      const html = await response.text();
      // CUIMS also refuses pages with HTTP 200 and an empty rendered menu.
      // The login's landing response precedes menu initialization.
      if (isInnerPage(target) && hasEmptyMenu(html)) {
        seen("empty-menu");
        throw coded("page-limit");
      }
      seen(isLoginUrl(finalUrl) ? "login-page" : "ok");
      return { url: finalUrl, status: response.status, html };
    };
  }

  // A CUIMS page whose sidebar came back with no links: the refusal live
  // tests saw most, HTTP 200 and all.
  function hasEmptyMenu(html) {
    const menu = String(html).match(/<ul\b[^>]*\bid\s*=\s*["']menu-content["'][^>]*>([\s\S]*?)<\/ul>/i);
    return Boolean(menu && /\bid\s*=\s*["']uims_sidebar["']/i.test(html) && !/<a\b/i.test(menu[1]));
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

  // GetReport and GetFullReport answer from the report ids alone, with no
  // CUIMS session. Sending them without cookies keeps them clear of the
  // session's inner-page throttle and never touches the student's session.
  async function postJson(request, path, payload) {
    const result = await request(url(path), {
      method: "POST",
      body: payload,
      anonymous: true,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    if (isLoginUrl(result.url) || api.isLoginDocument(result.html)) throw coded("signed-out");
    let parsed;
    try {
      parsed = JSON.parse(result.html || "");
    } catch {
      throw coded("report-shape", null, describe(result));
    }
    const rows = api.unwrapReport(parsed);
    if (!rows) throw coded("report-shape", null, describe(result));
    return rows;
  }

  function quote(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  // The attendance page doubles as the session check: signed out, CUIMS
  // redirects it to Login.aspx.
  function isErrorPage(value) {
    try {
      return /^\/error\.html$/i.test(new URL(value).pathname);
    } catch {
      return false;
    }
  }

  async function completeLanding(request) {
    try {
      await request(url(LANDING_INIT), { method: "POST", body: "{}", headers: { "content-type": "application/json; charset=utf-8" } });
    } catch (error) {
      if (error.code === "portal-busy" || error.code === "page-limit" || error.code === "busy" || error.code === "tab-login") throw error;
    }
  }

  async function openAttendance(request) {
    const page = await request(url(`${ATTENDANCE}${ATTENDANCE_QUERY}`));
    if (isLoginUrl(page.url) || api.isLoginDocument(page.html)) throw coded("signed-out");
    // An error page is not evidence of a signed-out session.
    if (isErrorPage(page.url)) throw coded("page-limit");
    const meta = api.extractReportMeta(page.html);
    if (meta.reportId && meta.sessionId) return meta;
    if (/StudentHome\.aspx/i.test(page.url)) throw coded("portal-redirect", null, describe(page));
    throw coded("report-shape", null, describe(page));
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

  // Optional pages never follow redirects: a signed-out answer redirects to
  // the login page, and loading it would replace a tab's captcha. CUIMS's
  // error.html redirect looks the same from here, and nothing else is loaded
  // to tell them apart: either way the page waits until a CUIMS tab shows the
  // session serving pages again.
  async function optionalPage(request, target) {
    const page = await request(target, { manual: true });
    if (isLoginUrl(page.url) || api.isLoginDocument(page.html)) throw coded("signed-out");
    if (isErrorPage(page.url)) throw coded("page-limit");
    return page;
  }

  // Optional, so signed out just means "later".
  async function readTimetable(request) {
    const target = url(TIMETABLE);
    let page = await optionalPage(request, target);
    if (!api.hasTimetable(page.html)) {
      page = await postForm(request, target, { ...api.hiddenFields(page.html), __EVENTTARGET: TIMETABLE_TARGET, __EVENTARGUMENT: "" });
    }
    return api.parseTimetable(page.html);
  }

  const LEAVE_PAGES = { dl: "/frmStudentApplyDutyLeave.aspx", ml: "/frmStudentMedicalLeaveApply.aspx" };

  // The student's own duty or medical leave applications and their status.
  // Never follow a redirect to a login page; the daemon owns sign-in and
  // retry decisions so the page cannot replace a tab's captcha.
  async function readLeavePage(request, which) {
    const page = await optionalPage(request, url(LEAVE_PAGES[which]));
    return which === "dl" ? api.parseDutyLeaves(page.html) : api.parseMedicalLeaves(page.html);
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

  // CUIMS captchas are always four letters and digits.
  function validCaptcha(text) {
    return /^[A-Za-z0-9]{4}$/.test(text);
  }

  // The solver answers { text, confident }; older callers answer a string.
  function captchaAnswer(read) {
    if (read && typeof read === "object") return read.confident === false ? "" : String(read.text || "").trim();
    return String(read || "").trim();
  }

  // UID step, password step, one submit. Unsure reads are re-drawn (at most
  // `reads` times) before anything is submitted, since only a submit counts
  // against CUIMS's lockout. `beforeSubmit()` runs last, right before the
  // submit: it throws when something else (a CUIMS tab) has drawn a newer
  // captcha for this session since ours, which would make even a perfect
  // read fail.
  async function signIn({ request, uid, password, solveCaptcha, reads = 2, onStep, beforeSubmit }) {
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
        answer = captchaAnswer(await solveCaptcha(image.bytes));
      } catch {
        answer = "";
      }
    }
    if (!validCaptcha(answer)) throw coded("bad-captcha", "Could not read the captcha. Try again.");
    await beforeSubmit?.();

    onStep?.("Checking the login…");
    const posted = await postForm(request, new URL(api.formAction(step.html) || step.url, step.url).href, {
      ...api.hiddenFields(step.html),
      txtLoginPassword: password,
      txtcaptcha: answer,
      btnLogin: "LOGIN",
    });
    const outcome = loginOutcome(posted);
    if (outcome === "ok") await completeLanding(request);
    return { outcome, submitted: true };
  }

  api.MESSAGES = MESSAGES;
  api.coded = coded;
  api.isLoginUrl = isLoginUrl;
  api.isLoginFlow = isLoginFlow;
  api.isInnerPage = isInnerPage;
  api.createRequest = createRequest;
  api.openAttendance = openAttendance;
  api.completeLanding = completeLanding;
  api.readSummary = readSummary;
  api.readMarks = readMarks;
  api.readTimetable = readTimetable;
  api.readLeavePage = readLeavePage;
  api.LEAVE_PAGES = LEAVE_PAGES;
  api.hasEmptyMenu = hasEmptyMenu;
  api.loginOutcome = loginOutcome;
  api.signIn = signIn;
  api.validCaptcha = validCaptcha;
})(globalThis);
