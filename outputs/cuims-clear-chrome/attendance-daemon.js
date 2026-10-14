// Decides when the background may talk to CUIMS, and how much.
//
// Two kinds of request, kept apart:
// - Report calls (GetReport, GetFullReport) go without cookies and answer
//   from the saved report ids alone. They never touch the CUIMS session, and
//   CUIMS kept answering them, one a second, even while it was refusing pages.
//   Attendance, today's marks and the Forecast's history come from these.
// - Session requests (the attendance page, timetable, leave pages, a sign-in)
//   are what CUIMS refuses: a few page loads a second or two apart cost the
//   account its menu for 5–10 minutes, longer when it happens again. The
//   background loads one only when it has to, six seconds from any other page
//   (its own or a CUIMS tab's), an optional one only five minutes clear of
//   any, and none at all while CUIMS is refusing them.
//
// Nothing runs on a timer: every request follows a popup action.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const MANUAL_GAP_MS = 30_000;
  const BUDGET_WINDOW_MS = 10 * MINUTE;
  // Local safety nets, not CUIMS's numbers: report calls (cookie-less) and
  // session requests (anything with the CUIMS cookie) in any ten minutes.
  const REPORT_MAX = 60;
  const SESSION_MAX = 10;
  const FAILURE_WINDOW_MS = 20 * MINUTE;
  const LOCKOUT_MS = 20 * MINUTE;
  // Any refused login in the last 20 minutes, the tab's or its own, stops the
  // background from signing in: the login tab keeps all three of its tries,
  // and the account stays well clear of CUIMS's lockout (1 + 3 refusals).
  const BACKGROUND_FAILURE_LIMIT = 1;
  const PAGE_LOGIN_GRACE_MS = 25_000;
  // A CUIMS tab on the login page beats every 8 s; background tabs may be
  // throttled to one beat a minute.
  const LOGIN_TAB_FRESH_MS = 75_000;
  const AFTER_TAB_MS = 5 * MINUTE;
  const SIGNIN_LOCK_MS = 90_000;
  // Background sign-ins in any hour, whatever they are for; and how long a
  // sign-in for an optional page waits after the last good one (sessions
  // ending sooner than that are being ended by something else).
  const BACKGROUND_SIGNIN_MAX = 3;
  const OPTIONAL_SIGNIN_GAP_MS = 30 * MINUTE;
  const RUN_LOCK_MS = 2 * MINUTE;
  const MAX_MARK_READS = 4;
  // Whole-semester mark lists for the Forecast tab, beyond today's reads. A
  // subject is read again only after its counts move.
  const MAX_HISTORY_READS = 4;
  // History is optional: it only spends report calls while this many are left.
  const HISTORY_RESERVE = 20;
  const HISTORY_VERSION = 1;
  const BACKOFF_MINUTES = [1, 2, 5, 10, 20];
  // CUIMS answering 429/503 lasts minutes, so its backoff starts at five.
  const THROTTLE_MINUTES = [5, 10, 20, 30];
  // A network failure is not CUIMS pushing back (often the student's own
  // connection), so it never holds the next Refresh back.
  const BACKOFF_CODES = new Set(["report-shape", "portal-redirect", "portal-busy", "busy", "server", "login-shape"]);
  // The timetable is the semester's: read once, kept a week, read again when
  // the semester changes, and taken for free whenever the student opens it.
  const TIMETABLE_KEEP_MS = 7 * 24 * HOUR;
  const TIMETABLE_RETRY_MS = HOUR;
  // A leave page is read once, then daily, or every three hours while it has
  // an application pending. An approval shows sooner, from the attendance
  // counts (countPending); the page is only needed for a refusal or an
  // application made elsewhere. Opening the page on CUIMS updates it for free.
  const LEAVE_DAILY_MS = 24 * HOUR;
  const LEAVE_PENDING_MS = 3 * HOUR;
  const LEAVE_RETRY_MS = 3 * HOUR;
  // Optional pages (timetable, leave) wait this long after any page, the
  // background's or a CUIMS tab's: never mixed into the student's browsing.
  const PAGE_GAP_MS = 5 * MINUTE;
  // Live tests: page loads 5–6 s apart were served; a third load a second or
  // two after two others lost the menu. Each background page waits at least
  // this long after the last page, its own or a tab's.
  const PAGE_REQUEST_GAP_MS = 6_000;
  // With no timetable saved, the Forecast has nothing to count ahead, so the
  // first one only waits this long after a CUIMS tab's last page (and the six
  // seconds after the background's own).
  const FIRST_TIMETABLE_GAP_MS = MINUTE;
  // A refused page holds every background page and sign-in this long, longer
  // when it happens again within two hours. A CUIMS tab that loads a page
  // with its menu ends the hold early. Report calls carry on throughout.
  const PAGE_PAUSE_MINUTES = [15, 30, 60];
  const PAUSE_STREAK_RESET_MS = 2 * HOUR;
  // Local log of CUIMS requests and page refusals, for "Copy diagnostics".
  const JOURNAL_MAX = 150;
  // Optional pages per read, each six seconds after the last: a sign-in's
  // landing step and two pages stay far from the three-in-three-seconds
  // pattern CUIMS refuses. One when the read already loaded the attendance
  // page.
  const MAX_OPTIONAL_PAGES = 2;
  // A second optional page never takes a read past this many page loads
  // (a legacy timetable is two: its GET and postback).
  const READ_PAGE_CEILING = 3;
  // The date sheet is read from this long before a test week until its end,
  // at most daily, until it lists the student's papers for that test.
  const DATESHEET_LEAD_DAYS = 10;
  const DATESHEET_RETRY_MS = 24 * HOUR;
  // Report ids read before a semester began are read again from the
  // attendance page, and once more a week in (CUIMS may switch late): the
  // old ones may keep answering with last semester's attendance.
  const META_RECHECK_DAYS = 7;

  const DEFAULTS = {
    uid: "",
    password: "",
    autoSolveCaptcha: true,
    attendanceOwner: "",
    attendanceSnapshot: null,
    attendanceTimetable: null,
    attendanceLeaves: null,
    attendanceCourses: null,
    attendanceHistory: null,
    attendanceDateSheet: null,
    academicCalendar: "auto",
    attendanceRequests: [],
    attendanceSessionRequests: [],
    attendancePageAt: 0,
    tabPageAt: 0,
    tabMenuOkAt: 0,
    pagesPausedUntil: 0,
    pagesPausedAt: 0,
    pagesPauseStreak: 0,
    tabLimitedAt: 0,
    attendanceRunUntil: 0,
    attendanceStatus: null,
    attendanceMeta: null,
    attendanceLastAttemptAt: 0,
    attendanceBackoffUntil: 0,
    attendanceFailStreak: 0,
    sessionAlive: false,
    sessionCheckedAt: 0,
    loginGuard: null,
    pageLoginAt: 0,
    loginTabAt: 0,
  };

  // What page admission reads fresh from storage, since a CUIMS tab writes it.
  const PAGE_KEYS = { tabPageAt: 0, tabMenuOkAt: 0, pagesPausedUntil: 0, pagesPausedAt: 0, tabLimitedAt: 0 };

  // Everything read for one student. A different saved UID starts over.
  const STUDENT_KEYS = ["attendanceSnapshot", "attendanceTimetable", "attendanceLeaves", "attendanceCourses", "attendanceHistory", "attendanceDateSheet", "attendanceMeta", "attendanceStatus"];

  // A refusal the background met (pagesPausedUntil) or a CUIMS tab met
  // (tabLimitedAt: error.html or an empty menu) holds pages, unless a CUIMS
  // tab has since loaded a page with its menu (tabMenuOkAt).
  function pagesPauseEnd(state) {
    const refusedAt = Math.max(Number(state.pagesPausedAt || 0), Number(state.tabLimitedAt || 0));
    if (Number(state.tabMenuOkAt || 0) > refusedAt) return 0;
    return Math.max(Number(state.pagesPausedUntil || 0), Number(state.tabLimitedAt || 0) + PAGE_PAUSE_MINUTES[0] * MINUTE);
  }

  function freshGuard(guard, now) {
    const value = guard && typeof guard === "object" ? guard : {};
    return {
      failures: (Array.isArray(value.failures) ? value.failures : []).filter((item) => now - Number(item?.at || 0) < FAILURE_WINDOW_MS),
      lockoutUntil: Number(value.lockoutUntil || 0),
      rejectedUid: String(value.rejectedUid || ""),
    };
  }

  function studentOf(uid) {
    return String(uid || "").trim().toUpperCase();
  }

  // Only the path: no query (it carries ids), no host.
  function journalPath(value) {
    try {
      return new URL(value).pathname;
    } catch {
      return "";
    }
  }

  // The saved timetable, in this build's shape or 0.10.3's ({ day, slots,
  // triedAt }, where triedAt also moved on success).
  function timetableOf(state) {
    const cached = state.attendanceTimetable || {};
    const slots = Array.isArray(cached.slots) ? cached.slots : [];
    return {
      slots,
      savedAt: Number(cached.savedAt || (slots.length ? cached.triedAt || Date.parse(cached.day || "") : 0) || 0),
      session: String(cached.session || ""),
      failedAt: Number(cached.failedAt || (slots.length ? 0 : cached.triedAt) || 0),
    };
  }

  function createDaemon({ storage, fetchImpl, solveCaptcha, now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
    const client = api;
    // The CUIMS conversation in progress (a read, or a page a CUIMS tab
    // handed over), and the read in progress, if that is what it is.
    let inflight = null;
    let refreshing = null;

    // ---- journal ----

    let journalQueue = [];
    let journalWrite = Promise.resolve();

    function note(entry) {
      journalQueue.push({ at: now(), ...entry });
    }

    function flushJournal() {
      if (!journalQueue.length) return journalWrite;
      const batch = journalQueue;
      journalQueue = [];
      journalWrite = journalWrite
        .then(async () => {
          const { cuimsJournal } = await storage.get({ cuimsJournal: [] });
          await storage.set({ cuimsJournal: [...(Array.isArray(cuimsJournal) ? cuimsJournal : []), ...batch].slice(-JOURNAL_MAX) });
        })
        .catch(() => {});
      return journalWrite;
    }

    // Every request the background makes: what was asked, where it ended up,
    // and what came of it ("ok", "page-limit", "signed-out", …).
    function observe({ target, url, status, result }) {
      const path = journalPath(target);
      const to = journalPath(url);
      note({ by: "bg", path, ...(to && to !== path ? { to } : {}), status, result });
    }

    // A CUIMS tab loaded a page (content.js): its path and whether CUIMS
    // served it with its menu.
    function noteTabPage({ path, result }) {
      note({ by: "tab", path: String(path || "").split("?")[0].slice(0, 80), result: String(result || "").slice(0, 20) });
      return flushJournal();
    }

    // ---- shared state ----

    // A tab showing the login form beats every 8 s (loginTabAt), and a tab
    // that has just started loading it says so before its captcha is even
    // requested (tabLoginTouchAt). Either one means the session's captcha
    // belongs to that tab.
    async function tabOnLoginPage() {
      const { loginTabAt, tabLoginTouchAt } = await storage.get({ loginTabAt: 0, tabLoginTouchAt: 0 });
      const latest = Math.max(Number(loginTabAt || 0), Number(tabLoginTouchAt || 0));
      return now() - latest < LOGIN_TAB_FRESH_MS;
    }

    function markLoginTouch() {
      return storage.set({ bgLoginTouchAt: now() });
    }

    function createRequest(budget) {
      return client.createRequest({ fetchImpl, budget: budget.take, yieldToTab: tabOnLoginPage, onLoginTouch: markLoginTouch, observe });
    }

    async function setStatus(status) {
      await storage.set({ attendanceStatus: { ...status, at: now() } });
    }

    // A different saved UID: what was read belongs to someone else.
    async function claimStudent(state) {
      const student = studentOf(state.uid);
      if (!student || state.attendanceOwner === student) return state;
      const patch = { attendanceOwner: student };
      // An install from before 0.10.4 has no owner yet: its reads are this
      // student's.
      if (state.attendanceOwner) {
        for (const key of STUDENT_KEYS) patch[key] = null;
        Object.assign(patch, { sessionAlive: false, sessionCheckedAt: now(), attendanceLastAttemptAt: 0, attendanceBackoffUntil: 0, attendanceFailStreak: 0 });
      }
      await storage.set(patch);
      return { ...state, ...patch };
    }

    // Report calls and session requests are metered apart. Every session
    // page waits PAGE_REQUEST_GAP_MS after the last page, the background's
    // (attendancePageAt) or a CUIMS tab's (tabPageAt, from content.js, or
    // Open CUIMS/LMS about to load one). `optional` pages also re-check,
    // right before they go, that no tab has loaded a page within that many ms.
    function meter(state) {
      const reports = (state.attendanceRequests || []).filter((at) => now() - at < BUDGET_WINDOW_MS);
      const session = (state.attendanceSessionRequests || []).filter((at) => now() - at < BUDGET_WINDOW_MS);
      let pageAt = Number(state.attendancePageAt || 0);
      // Pages this read has loaded so far.
      let pagesTaken = 0;
      const freeAt = async (gap = PAGE_GAP_MS, ownGap = gap) => {
        // A tab may have loaded or been refused while the report was reading.
        const current = await storage.get(PAGE_KEYS);
        return Math.max(pagesPauseEnd(current), pageAt + ownGap, Number(current.tabPageAt || 0) + gap);
      };
      const waitForPage = async ({ signal, optional = 0 } = {}) => {
        for (;;) {
          if (signal?.aborted) throw client.coded("cancelled");
          const current = await storage.get(PAGE_KEYS);
          const limit = pagesPaused(current);
          if (limit) throw limit.error;
          if (optional && now() < Number(current.tabPageAt || 0) + optional) throw client.coded("yield");
          const delay = Math.max(pageAt, Number(current.tabPageAt || 0)) + PAGE_REQUEST_GAP_MS - now();
          if (delay <= 0) return;
          await sleep(delay);
        }
      };
      return {
        async take(target, options = {}) {
          if (options.anonymous) {
            if (reports.length >= REPORT_MAX) throw client.coded("busy");
            reports.push(now());
            return;
          }
          // The login flow is not what CUIMS refuses, and sign-ins have their
          // own limits (one submit, BACKGROUND_SIGNIN_MAX an hour): only
          // pages count here.
          const login = client.isLoginFlow(target);
          if (!login && session.length >= SESSION_MAX) throw client.coded("busy");
          const page = client.isInnerPage(target);
          if (page) await waitForPage({ signal: options.signal, optional: options.optional || 0 });
          if (!login) session.push(now());
          if (page) {
            pageAt = now();
            pagesTaken += 1;
          }
        },
        reportRoom: () => REPORT_MAX - reports.length,
        sessionRoom: () => SESSION_MAX - session.length,
        pagesTaken: () => pagesTaken,
        freeAt,
        pageFree: async (gap = PAGE_GAP_MS, ownGap = gap) => now() >= (await freeAt(gap, ownGap)),
        saved: () => ({ attendanceRequests: reports, attendanceSessionRequests: session, attendancePageAt: pageAt }),
      };
    }

    // Requests for an optional page: they give way to a CUIMS tab in use.
    function optionalRequest(request, gap) {
      return (target, options = {}) => request(target, { ...options, optional: gap });
    }

    function paused(state) {
      const until = Number(state.attendanceBackoffUntil || 0);
      if (until <= now()) return null;
      const minutes = Math.max(1, Math.ceil((until - now()) / MINUTE));
      const reason = (state.attendanceStatus?.error || "").replace(/\s*Next try in \d+ min\.\s*$/, "") || "CUIMS refused the last read.";
      return client.coded("backoff", `${reason} Next try in ${minutes} min.`);
    }

    async function recordBackoff(state, error) {
      const code = error.code || "network";
      let message = error.code ? error.message : client.MESSAGES.network;
      if (!BACKOFF_CODES.has(code)) return message;
      const streak = Number(state.attendanceFailStreak || 0) + 1;
      const table = code === "portal-busy" ? THROTTLE_MINUTES : BACKOFF_MINUTES;
      const retryAfter = error.detail?.retryAfter || "";
      const retryMs = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, (Date.parse(retryAfter) || 0) - now());
      const until = now() + Math.max(table[Math.min(streak, table.length) - 1] * MINUTE, retryMs);
      const minutes = Math.ceil((until - now()) / MINUTE);
      const said = (error.detail?.title || error.detail?.text || "").trim().slice(0, 70);
      const kept = state.attendanceSnapshot ? " Showing your last read." : "";
      message = `${message}${said ? ` CUIMS said “${said}”.` : ""}${kept} Next try in ${minutes} min.`;
      await storage.set({
        attendanceFailStreak: streak,
        attendanceBackoffUntil: until,
        ...(code === "report-shape" || code === "portal-redirect" ? { attendanceMeta: null } : {}),
        ...(error.detail ? { attendanceLastBad: { ...error.detail, code, at: now() } } : {}),
      });
      return message;
    }

    // CUIMS refused a page: hold every background page load and sign-in. A
    // page that loads again ends the streak; so do two quiet hours.
    async function pausePages(state) {
      const last = await storage.get({ pagesPauseStreak: 0, pagesPausedAt: 0 });
      const streak = now() - Number(last.pagesPausedAt || 0) > PAUSE_STREAK_RESET_MS ? 1 : Number(last.pagesPauseStreak || 0) + 1;
      const until = now() + PAGE_PAUSE_MINUTES[Math.min(streak, PAGE_PAUSE_MINUTES.length) - 1] * MINUTE;
      const patch = { pagesPausedUntil: until, pagesPausedAt: now(), pagesPauseStreak: streak };
      Object.assign(state, patch);
      await storage.set(patch);
      return until;
    }

    function pagesPaused(state) {
      const until = pagesPauseEnd(state);
      if (until <= now()) return null;
      const minutes = Math.max(1, Math.ceil((until - now()) / MINUTE));
      const kept = state.attendanceSnapshot ? " Showing your last read." : "";
      return { until, error: client.coded("page-limit", `${client.MESSAGES["page-limit"]}${kept} Next try in ${minutes} min.`) };
    }

    async function markSignedOut(state) {
      Object.assign(state, { sessionAlive: false, sessionCheckedAt: now() });
      await storage.set({ sessionAlive: false, sessionCheckedAt: now() });
    }

    async function markPageServed(state) {
      Object.assign(state, { sessionAlive: true, sessionCheckedAt: now(), pagesPauseStreak: 0 });
      await storage.set({ sessionAlive: true, sessionCheckedAt: now(), pagesPauseStreak: 0 });
    }

    async function recordFailure(guard, patch = {}) {
      const next = { ...guard, ...patch, failures: [...guard.failures, { at: now(), by: "bg" }] };
      await storage.set({ loginGuard: next });
      return next;
    }

    // Runs right before a background login submit. Every request of this
    // sign-in already checked that no tab was on the login flow, so a tab
    // signal now means one arrived while we were reading the captcha, and
    // drew a newer one: submitting ours would only be refused.
    function guardSubmit(signal) {
      return async () => {
        if (signal?.aborted) throw client.coded("cancelled");
        if (await tabOnLoginPage()) throw client.coded("tab-login");
      };
    }

    // Signs in for the attendance page. Answers the page's report ids when a
    // CUIMS tab's own sign-in already got them there, else null.
    // `budget`: a sign-in starts only with room for its landing step and the
    // page it is for, so it never leaves a session half signed in.
    async function ensureSignedIn(state, request, onStep, signal, budget) {
      const uid = String(state.uid || "").trim();
      if (!uid || !state.password) throw client.coded("needs-login");
      if (state.autoSolveCaptcha === false) {
        throw client.coded("needs-login", "Captcha solving is off, so fetch cannot sign in. Sign in on CUIMS, then refresh.");
      }
      let guard = freshGuard(state.loginGuard, now());
      if (guard.lockoutUntil > now()) throw client.coded("lockout");
      if (guard.rejectedUid && guard.rejectedUid === uid) throw client.coded("bad-password");
      if (guard.failures.length >= BACKGROUND_FAILURE_LIMIT) throw client.coded("cooldown");
      if (budget && budget.sessionRoom() < 2) throw client.coded("busy");
      const { bgSignIns } = await storage.get({ bgSignIns: [] });
      const lastHour = (Array.isArray(bgSignIns) ? bgSignIns : []).filter((at) => now() - Number(at) < HOUR);
      if (lastHour.length >= BACKGROUND_SIGNIN_MAX) throw client.coded("cooldown");

      if (now() - Number(state.pageLoginAt || 0) < PAGE_LOGIN_GRACE_MS) {
        onStep("Waiting for the CUIMS tab to sign in…");
        await sleep(4000);
        try {
          return await client.openAttendance(request);
        } catch (error) {
          if (error.code !== "signed-out") throw error;
        }
        throw client.coded("cooldown", "A CUIMS tab is signing in. Refresh in a moment.");
      }

      await storage.set({ bgSignIns: [...lastHour, now()] });
      // One submit per sign-in: the solver is all but always right, so a
      // refusal means something else is going on, and guessing again only
      // walks towards CUIMS's lockout. Unsure reads are re-drawn for free.
      const submits = 1;
      await storage.set({ bgSignInUntil: now() + SIGNIN_LOCK_MS });
      try {
        let submitted = 0;
        let unreadable = 0;
        // signIn already re-draws an unsure captcha once; a second unsure
        // pass would only replace more captchas, so one pass it is.
        while (submitted < submits && unreadable < 1) {
          let result;
          try {
            result = await client.signIn({ request, uid, password: state.password, solveCaptcha, onStep, beforeSubmit: guardSubmit(signal) });
          } catch (error) {
            if (error.code === "bad-captcha") {
              unreadable += 1;
              continue;
            }
            if (error.code === "lockout") await recordFailure(guard, { lockoutUntil: now() + LOCKOUT_MS });
            throw error;
          }
          if (result.outcome === "ok") {
            await storage.set({
              loginGuard: { ...guard, failures: [] },
              bgSignInOkAt: now(),
            });
            return null;
          }
          submitted += 1;
          if (result.outcome === "lockout") {
            await recordFailure(guard, { lockoutUntil: now() + LOCKOUT_MS });
            throw client.coded("lockout");
          }
          if (result.outcome === "bad-password") {
            await recordFailure(guard, { rejectedUid: uid });
            throw client.coded("bad-password");
          }
          guard = await recordFailure(guard);
        }
        throw client.coded("bad-captcha");
      } finally {
        await storage.set({ bgSignInUntil: 0 });
      }
    }

    // ---- timetable ----

    function timetableDue(state, meta) {
      const saved = timetableOf(state);
      if (now() - saved.failedAt < TIMETABLE_RETRY_MS) return false;
      if (!saved.slots.length) return true;
      if (meta?.sessionId && saved.session && saved.session !== meta.sessionId) return true;
      return now() - saved.savedAt >= TIMETABLE_KEEP_MS;
    }

    async function saveTimetable(state, slots, meta) {
      const saved = { slots, savedAt: now(), session: String(meta?.sessionId || state.attendanceMeta?.sessionId || "") };
      state.attendanceTimetable = saved;
      await storage.set({ attendanceTimetable: saved });
    }

    // The timetable only shapes the Forecast and today's class chips, so it
    // never fails a read. A failed read is retried at most hourly. Answers
    // the slots and how the page went (optionalOutcome).
    async function readTimetablePage(state, request, meta) {
      const saved = timetableOf(state);
      try {
        const fresh = await client.readTimetable(request);
        await markPageServed(state);
        if (fresh.length) {
          await saveTimetable(state, fresh, meta);
          return { slots: fresh, outcome: "ok" };
        }
      } catch (error) {
        if (error.code === "portal-busy") {
          await storage.set({ attendanceTimetable: { ...saved, failedAt: now() } });
          throw error;
        }
        const outcome = await optionalOutcome(state, error);
        // Given way to a tab, or signed out (tried again once signed in).
        if (outcome === "stop" || outcome === "signed-out") return { slots: saved.slots, outcome };
        // Refused or failed: the saved timetable stays, tried again hourly.
        state.attendanceTimetable = { ...saved, failedAt: now() };
        await storage.set({ attendanceTimetable: state.attendanceTimetable });
        return { slots: saved.slots, outcome };
      }
      state.attendanceTimetable = { ...saved, failedAt: now() };
      await storage.set({ attendanceTimetable: state.attendanceTimetable });
      return { slots: saved.slots, outcome: "failed" };
    }

    // What an optional page's failure means for the read: "stop" (a tab is
    // in use, our own budget), "refused" (CUIMS refused it: pages pause),
    // "signed-out" (worth one sign-in), or "failed" (this page waits for its
    // retry).
    async function optionalOutcome(state, error) {
      if (error.code === "yield" || error.code === "tab-login" || error.code === "busy" || error.code === "cancelled") return "stop";
      if (error.code === "page-limit") {
        await pausePages(state);
        return "refused";
      }
      if (error.code === "signed-out") {
        await markSignedOut(state);
        return "signed-out";
      }
      return "failed";
    }

    // While no timetable is saved, when a read can next try it (0: not until
    // the CUIMS session is seen alive). The popup reads again then, so the
    // Forecast fills in without a Refresh.
    async function firstTimetableDue(budget) {
      const fresh = await storage.get({ attendanceTimetable: null });
      return Math.max(await budget.freeAt(FIRST_TIMETABLE_GAP_MS, PAGE_REQUEST_GAP_MS), timetableOf(fresh).failedAt + TIMETABLE_RETRY_MS);
    }

    // ---- leave ----

    // Pending leave per subject: the absent marks on a pending application's
    // days (and, for lecture-based duty leave, at its class times). Approval
    // turns that mark into a leave mark and moves the subject's counts, so
    // this recount, run on every read, shows an approval without loading the
    // leave page; only a refusal waits for the page. Marks come from the
    // class record the Forecast tab keeps. A subject is read again, with the
    // cookie-less marks call, only when it has no record, or its counts moved
    // and its record holds a mark a pending leave covers.
    async function countPending(request, meta, subjects, history, leaves) {
      if (!leaves?.apps) return leaves;
      const waiting = [...(leaves.apps.dl || []), ...(leaves.apps.ml || [])].filter((leave) => leave.state === "pending");
      if (!waiting.length && !Object.keys(leaves.pending || {}).length) return leaves;
      const covers = ([day, start, char]) =>
        char === "a" ? waiting.find((leave) => leave.days.includes(day) && (!leave.timings.length || leave.timings.some((timing) => client.parseRange(timing)?.start === start))) : null;
      const counts = {};
      let read = false;
      const saveHistory = () => (read ? storage.set({ attendanceHistory: { v: HISTORY_VERSION, subjects: history } }) : null);
      try {
        for (const subject of waiting.length ? subjects : []) {
          const code = client.normCode(subject.code);
          let kept = history[code];
          if (subject.encryptCode && (!kept || (historyStale(kept, subject) && kept.marks.some(covers)))) {
            try {
              const marks = await client.readMarks(request, meta, subject.encryptCode);
              kept = history[code] = { attended: subject.attended, delivered: subject.delivered, at: now(), marks: client.compactMarks(marks) };
              read = true;
            } catch (error) {
              if (error.code === "portal-busy" || error.code === "busy") throw error;
            }
          }
          for (const mark of kept?.marks || []) {
            const leave = covers(mark);
            if (!leave) continue;
            const entry = (counts[code] ||= { vdl: 0, idl: 0, adl: 0, ml: 0 });
            entry[leave.kind === "ml" ? "ml" : leave.dlType || "vdl"] += 1;
          }
        }
      } catch (error) {
        await saveHistory();
        // Our own budget ran out: the last counts stand until the next read.
        if (error.code === "busy") return leaves;
        throw error;
      }
      await saveHistory();
      const next = { ...leaves, pending: counts };
      await storage.set({ attendanceLeaves: next });
      return next;
    }

    // Leave read before LEAVES_VERSION counted refusals as pending; drop it.
    function currentLeaves(state) {
      const cached = state.attendanceLeaves;
      return cached?.v === client.LEAVES_VERSION ? cached : null;
    }

    function snapshotLeaves(leaves) {
      return leaves?.checkedAt ? { v: client.LEAVES_VERSION, checkedAt: leaves.checkedAt, pending: leaves.pending || {} } : null;
    }

    // Folds one leave page's applications in. Pending counts are redone by
    // the next read (countPending).
    async function mergeLeaves(cached, which, applications) {
      const apps = { dl: cached?.apps?.dl || [], ml: cached?.apps?.ml || [], [which]: applications };
      const leaves = { ...(cached || {}), v: client.LEAVES_VERSION, apps, pending: cached?.pending || {}, [`${which}At`]: now(), checkedAt: now(), triedAt: now() };
      await storage.set({ attendanceLeaves: leaves });
      return leaves;
    }

    // When a leave page is next worth a request: never read yet, then daily,
    // or every three hours while it holds a pending application.
    function leaveDueAt(leaves, which) {
      const read = Number(leaves?.[`${which}At`] || 0);
      const tried = Number(leaves?.[`${which}TriedAt`] || 0);
      const pending = (leaves?.apps?.[which] || []).some((leave) => leave.state === "pending");
      const due = read ? read + (pending ? LEAVE_PENDING_MS : LEAVE_DAILY_MS) : 0;
      return Math.max(due, tried ? tried + LEAVE_RETRY_MS : 0);
    }

    // The most overdue leave page, if any is due.
    function dueLeave(leaves) {
      const due = ["dl", "ml"].map((which) => ({ which, at: leaveDueAt(leaves, which) })).filter((item) => item.at <= now());
      due.sort((left, right) => left.at - right.at);
      return due[0]?.which || "";
    }

    async function readLeave(state, request, which, onStep) {
      let leaves = currentLeaves(state);
      await onStep(which === "dl" ? "Reading duty leave…" : "Reading medical leave…");
      let outcome = "ok";
      try {
        const applications = await client.readLeavePage(request, which);
        await markPageServed(state);
        leaves = await mergeLeaves(leaves, which, applications);
      } catch (error) {
        if (error.code === "portal-busy") throw error;
        // Refused: the attendance already read stands, and this page is
        // tried again once the pause is over. Signed out: tried again once
        // signed in.
        outcome = await optionalOutcome(state, error);
        if (outcome !== "failed") return { leaves: currentLeaves(state) || leaves, outcome };
        leaves = { ...(leaves || {}), v: client.LEAVES_VERSION, triedAt: now(), [`${which}TriedAt`]: now() };
        await storage.set({ attendanceLeaves: leaves });
      }
      state.attendanceLeaves = leaves;
      return { leaves, outcome };
    }

    // The student opened a leave page on CUIMS: keep what it shows, with no
    // request of our own. The next read counts what is pending.
    async function readLeaveUpdate(which, html) {
      if (!client.LEAVE_PAGES[which]) return null;
      const state = await storage.get(DEFAULTS);
      const applications = which === "dl" ? client.parseDutyLeaves(html) : client.parseMedicalLeaves(html);
      const leaves = await mergeLeaves(currentLeaves(state), which, applications);
      if (state.attendanceSnapshot) {
        await storage.set({ attendanceSnapshot: { ...state.attendanceSnapshot, leaves: snapshotLeaves(leaves) } });
      }
      return leaves;
    }

    // The student opened My Time Table on CUIMS: keep it, with no request.
    async function readTimetableUpdate(html) {
      const slots = client.parseTimetable(html);
      if (!slots.length) return null;
      const state = await storage.get(DEFAULTS);
      await saveTimetable(state, slots, state.attendanceMeta);
      if (state.attendanceSnapshot) {
        const { timetableDueAt, ...snapshot } = state.attendanceSnapshot;
        await storage.set({ attendanceSnapshot: { ...snapshot, slots } });
      }
      return slots;
    }

    // ---- date sheet ----

    // The student's tests (MST-1, MST-2…): a week with one of their papers in
    // it has no classes (academic-calendar.js).
    function calendarContext(state) {
      return { calendar: client.calendarFor ? client.calendarFor(state.academicCalendar, state.uid) : "cu" };
    }

    function savedExams(state) {
      const saved = state.attendanceDateSheet;
      return Array.isArray(saved?.exams) ? saved.exams : [];
    }

    // Due from DATESHEET_LEAD_DAYS before one of the calendar's test weeks
    // until the week is over, while the saved sheet lists no paper for it
    // this semester. At most daily.
    function dateSheetDue(state, campus) {
      if (!client.testWeeks) return false;
      const saved = state.attendanceDateSheet || {};
      if (now() - Number(saved.triedAt || 0) < DATESHEET_RETRY_MS) return false;
      const context = calendarContext(state);
      const today = client.dayNumberOf(campus.key);
      const start = client.semesterStart(today, context);
      if (start == null) return false;
      const listed = new Set(
        savedExams(state)
          .filter((exam) => client.dayNumberOf(exam.day) >= start)
          .map((exam) => Number(String(exam.type).match(/^MST-?(\d)/i)?.[1] || 0)),
      );
      return client.testWeeks(today, context).some((week) => today >= week.from - DATESHEET_LEAD_DAYS && today <= week.to && !listed.has(week.n));
    }

    // Rows from a page (the whole sheet, or one type the student filtered
    // to): its types replace the saved ones, the rest stay.
    async function mergeDateSheet(state, exams, tried) {
      const types = new Set(exams.map((exam) => exam.type));
      const kept = savedExams(state).filter((exam) => !types.has(exam.type));
      const next = { exams: [...kept, ...exams].sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0)), savedAt: now(), triedAt: tried ? now() : Number(state.attendanceDateSheet?.triedAt || 0) };
      state.attendanceDateSheet = next;
      await storage.set({ attendanceDateSheet: next });
      return next.exams;
    }

    async function readDateSheetPage(state, request, onStep) {
      await onStep("Reading your date sheet…");
      try {
        const exams = await client.readDateSheet(request);
        await markPageServed(state);
        return { exams: await mergeDateSheet(state, exams, true), outcome: "ok" };
      } catch (error) {
        if (error.code === "portal-busy") throw error;
        const outcome = await optionalOutcome(state, error);
        if (outcome === "failed") {
          state.attendanceDateSheet = { ...(state.attendanceDateSheet || {}), triedAt: now() };
          await storage.set({ attendanceDateSheet: state.attendanceDateSheet });
        }
        return { exams: savedExams(state), outcome };
      }
    }

    // The student opened the Date Sheet on CUIMS: keep it, with no request.
    async function readDateSheetUpdate(html) {
      const exams = client.parseDateSheet(html);
      if (!exams.length) return null;
      const state = await storage.get(DEFAULTS);
      const all = await mergeDateSheet(state, exams, false);
      if (state.attendanceSnapshot) await storage.set({ attendanceSnapshot: { ...state.attendanceSnapshot, exams: all } });
      return all;
    }

    // ---- optional pages ----

    // The session was last seen signed out, and no CUIMS tab has shown its
    // menu since. A CUIMS session lasts a couple of hours idle, so anything
    // else is tried as it is: a signed-out page answers with a redirect.
    async function sessionKnownGone() {
      const fresh = await storage.get({ sessionAlive: null, sessionCheckedAt: 0, tabMenuOkAt: 0 });
      return fresh.sessionAlive === false && Number(fresh.sessionCheckedAt || 0) > Number(fresh.tabMenuOkAt || 0);
    }

    // Signs in for an optional page when the session is gone, if signing in
    // is allowed at all (saved login, captcha solving on, no refused login
    // lately, no CUIMS tab on its login page). Answers whether it did.
    async function signInForPages(state, request, onStep, budget) {
      if (now() - Number(state.pageLoginAt || 0) < PAGE_LOGIN_GRACE_MS) return false;
      const { bgSignInOkAt } = await storage.get({ bgSignInOkAt: 0 });
      if (now() - Number(bgSignInOkAt || 0) < OPTIONAL_SIGNIN_GAP_MS) return false;
      try {
        await ensureSignedIn(state, request, onStep, null, budget);
        await markPageServed(state);
        return true;
      } catch (error) {
        if (error.code === "portal-busy") throw error;
        if (error.code === "page-limit") await pausePages(state);
        // Anything else (a refused login, a tab signing in, our budget): the
        // pages wait for the next read. The login guard keeps the count.
        return false;
      }
    }

    // Which optional page is due, most needed first: a first timetable, the
    // most overdue leave page, the date sheet before a test week, a
    // timetable refresh.
    function nextOptional(state, meta, campus, done) {
      if (!done.has("timetable") && !timetableOf(state).slots.length && timetableDue(state, meta)) return "first-timetable";
      const leave = dueLeave(currentLeaves(state));
      if (leave && !done.has(leave)) return leave;
      const other = leave === "dl" ? "ml" : leave === "ml" ? "dl" : "";
      if (other && !done.has(other) && leaveDueAt(currentLeaves(state), other) <= now()) return other;
      if (!done.has("datesheet") && dateSheetDue(state, campus)) return "datesheet";
      if (!done.has("timetable") && timetableDue(state, meta)) return "timetable";
      return "";
    }

    async function readOne(which, state, request, meta, onStep, gap) {
      const paced = optionalRequest(request, gap);
      if (which === "first-timetable" || which === "timetable") {
        await onStep("Reading your timetable…");
        const { slots, outcome } = await readTimetablePage(state, paced, meta);
        return { outcome, found: { slots } };
      }
      if (which === "datesheet") {
        const { exams, outcome } = await readDateSheetPage(state, paced, onStep);
        return { outcome, found: { exams } };
      }
      const { leaves, outcome } = await readLeave(state, paced, which, onStep);
      return { outcome, found: { leaves } };
    }

    // Up to MAX_OPTIONAL_PAGES due pages, six seconds apart, none while CUIMS
    // is refusing pages, and only five minutes clear of a CUIMS tab's last
    // page (a minute for the first timetable). A page that finds the session
    // gone signs in, once, and is tried again, so leave stays current
    // without the student opening its page, and Open CUIMS right after
    // lands in that session.
    async function readOptionalPages(state, request, meta, budget, onStep, campus) {
      const found = {};
      const done = new Set();
      let pages = 0;
      let signedIn = false;
      // A read that already loaded the attendance page (a first read, new
      // report ids) takes one optional page, not two.
      const most = budget.pagesTaken() ? 1 : MAX_OPTIONAL_PAGES;
      while (pages < most) {
        const which = nextOptional(state, meta, campus, done);
        if (!which) break;
        done.add(which === "first-timetable" ? "timetable" : which);
        const gap = which === "first-timetable" ? FIRST_TIMETABLE_GAP_MS : PAGE_GAP_MS;
        // The first page also keeps five minutes from the background's own
        // last page (not after a sign-in of this read); later ones six seconds.
        const ownGap = pages || which === "first-timetable" ? 0 : gap;
        if (pages && budget.pagesTaken() >= READ_PAGE_CEILING) break;
        if (!(await budget.pageFree(gap, ownGap))) break;
        if (!signedIn && (await sessionKnownGone())) {
          if (!(await signInForPages(state, request, onStep, budget))) break;
          signedIn = true;
        }
        let result = await readOne(which, state, request, meta, onStep, gap);
        if (result.outcome === "signed-out" && !signedIn) {
          if (!(await signInForPages(state, request, onStep, budget))) break;
          signedIn = true;
          result = await readOne(which, state, request, meta, onStep, gap);
        }
        Object.assign(found, result.found);
        pages += 1;
        if (result.outcome !== "ok" && result.outcome !== "failed") break;
      }
      return found;
    }

    // ---- marks ----

    // A subject's stored history is current while its counts stand still:
    // every new mark, and every leave decision, moves attended or delivered.
    function historyStale(entry, subject) {
      return !entry || Number(entry.attended) !== Number(subject.attended) || Number(entry.delivered) !== Number(subject.delivered);
    }

    // Today's marks read earlier today stay with each subject until a newer
    // read replaces them, so a read in progress never shows a class as missed.
    function carryMarks(subjects, previous, campus) {
      const sameDay = previous?.marksDay === campus.key;
      for (const subject of subjects) {
        const earlier = sameDay ? previous.subjects?.find((item) => item.code === subject.code) : null;
        subject.marks = earlier?.marks || null;
      }
    }

    // Day-by-day marks are only worth a request for subjects whose class
    // today has started and is not already known to be marked. The same call
    // answers with the whole semester, which the Forecast tab keeps; subjects
    // whose counts moved are read for it too, a few per read.
    async function readTodaysMarks(state, request, meta, subjects, slots, campus, budget) {
      const previous = state.attendanceSnapshot;
      const sameDay = previous?.marksDay === campus.key;
      const started = client.todaysSlots(slots, campus).filter((slot) => slot.start <= campus.minutes);
      const stored = state.attendanceHistory?.v === HISTORY_VERSION ? state.attendanceHistory.subjects || {} : {};
      const history = {};
      for (const subject of subjects) {
        const code = client.normCode(subject.code);
        if (stored[code]) history[code] = stored[code];
      }
      let changed = Object.keys(history).length !== Object.keys(stored).length;
      const keep = (subject, marks) => {
        history[client.normCode(subject.code)] = { attended: subject.attended, delivered: subject.delivered, at: now(), marks: client.compactMarks(marks) };
        changed = true;
      };
      let reads = 0;
      let failed = false;
      const read = new Set();
      carryMarks(subjects, previous, campus);
      for (const subject of subjects) {
        const mine = started.filter((slot) => client.slotBelongsTo(slot, subject));
        const earlier = sameDay ? previous.subjects?.find((item) => item.code === subject.code) : null;
        if (!mine.length) continue;
        // History read since the counts last moved already holds today's marks.
        const kept = history[client.normCode(subject.code)];
        if (kept && !historyStale(kept, subject)) {
          subject.marks = client.expandMarks(kept.marks.filter(([day]) => day === campus.key));
          continue;
        }
        if (failed || !subject.encryptCode || reads >= MAX_MARK_READS) continue;
        const known = (subject.marks || []).filter((mark) => client.parseDateKey(mark.date) === campus.key).length;
        if (subject.marks && known >= mine.length) continue;
        // A new mark always raises the delivered count, so an unchanged count
        // means the marks read earlier today are still current.
        if (earlier?.marks && Number(earlier.delivered) === Number(subject.delivered)) continue;
        reads += 1;
        try {
          const marks = await client.readMarks(request, meta, subject.encryptCode);
          subject.marks = (marks || []).filter((mark) => client.parseDateKey(mark.date) === campus.key);
          keep(subject, marks);
          read.add(subject);
        } catch (error) {
          if (error.code === "portal-busy" || error.code === "busy") throw error;
          // Today's marks are extra detail; the totals already arrived.
          failed = true;
        }
      }
      // History the Forecast tab is missing first, then the oldest.
      const stale = subjects
        .filter((subject) => subject.encryptCode && !read.has(subject) && historyStale(history[client.normCode(subject.code)], subject))
        .sort((left, right) => Number(history[client.normCode(left.code)]?.at || 0) - Number(history[client.normCode(right.code)]?.at || 0));
      const allowance = failed ? 0 : Math.max(0, Math.min(MAX_HISTORY_READS, budget.reportRoom() - HISTORY_RESERVE));
      for (const subject of stale.slice(0, allowance)) {
        try {
          keep(subject, await client.readMarks(request, meta, subject.encryptCode));
        } catch (error) {
          // CUIMS pushing back stops the whole read; anything else waits for
          // the next read, keeping the attendance already read.
          if (error.code === "portal-busy") {
            if (changed) await storage.set({ attendanceHistory: { v: HISTORY_VERSION, subjects: history } });
            throw error;
          }
          break;
        }
      }
      if (changed) await storage.set({ attendanceHistory: { v: HISTORY_VERSION, subjects: history } });
      return history;
    }

    function buildSnapshot(subjects, campus, slots, leaves, timetableDueAt, exams = []) {
      return {
        fetchedAt: new Date(now()).toISOString(),
        marksDay: campus.key,
        slots,
        exams,
        ...(slots.length || !timetableDueAt ? {} : { timetableDueAt }),
        subjects: subjects.map(({ encryptCode, ...subject }) => subject),
        leaves: snapshotLeaves(leaves),
      };
    }

    // ---- a read ----

    // Report ids from before this semester began, or not checked since its
    // first week ended.
    function metaStale(state, campus) {
      const at = Number(state.attendanceMeta?.at || 0);
      const today = client.dayNumberOf?.(campus.key);
      const start = today == null ? null : client.semesterStart?.(today, calendarContext(state));
      if (!at || start == null) return false;
      // The campus day starts at midnight in Mohali, 5 h 30 before UTC's.
      const dayStart = (day) => day * 24 * HOUR - 330 * MINUTE;
      if (at < dayStart(start)) return true;
      return today >= start + META_RECHECK_DAYS && at < dayStart(start + META_RECHECK_DAYS);
    }

    // The attendance page holds the report ids. Signed out, sign in for it;
    // it waits out a page refusal like any page.
    async function openReportIds(state, request, onStep, budget) {
      Object.assign(state, await storage.get(PAGE_KEYS));
      const limit = pagesPaused(state);
      if (limit) throw limit.error;
      await onStep("Checking your CUIMS session…");
      let meta;
      try {
        meta = await client.openAttendance(request);
      } catch (error) {
        if (error.code !== "signed-out") throw error;
        await markSignedOut(state);
        meta = await ensureSignedIn(state, request, onStep, null, budget);
        try {
          meta ||= await client.openAttendance(request);
        } catch (again) {
          if (again.code === "signed-out") throw client.coded("login-shape", "CUIMS accepted the login but did not keep the session. Try again.");
          throw again;
        }
      }
      await markPageServed(state);
      return meta;
    }

    async function run() {
      const state = await claimStudent(await storage.get(DEFAULTS));
      const started = now();
      const lastError = state.attendanceStatus?.error || "";
      const wait = paused(state);
      if (wait) return { snapshot: state.attendanceSnapshot, code: wait.code, error: wait.message, nextRefreshAt: state.attendanceBackoffUntil };
      if (started - Number(state.attendanceLastAttemptAt || 0) < MANUAL_GAP_MS) {
        return { snapshot: state.attendanceSnapshot, recent: true, nextRefreshAt: Number(state.attendanceLastAttemptAt) + MANUAL_GAP_MS, ...(lastError ? { error: lastError, code: state.attendanceStatus?.code } : {}) };
      }

      if (Number(state.attendanceRunUntil || 0) > started) return { snapshot: state.attendanceSnapshot, busy: true };

      const budget = meter(state);
      const request = createRequest(budget);
      const onStep = (phase) => setStatus({ working: true, phase });
      await storage.set({
        attendanceRunUntil: started + RUN_LOCK_MS,
        attendanceLastAttemptAt: started,
      });
      await onStep("Reading attendance…");
      try {
        // The report ids from the attendance page stay valid, so a normal
        // read is GetReport and the marks calls, none of them a session
        // request. The attendance page is reopened only when the ids are
        // missing or stop working, and that is the only read that signs in.
        const campus = client.campusParts(new Date(now()));
        let meta = state.attendanceMeta?.reportId ? state.attendanceMeta : null;
        let subjects = null;
        if (meta && metaStale(state, campus)) {
          try {
            meta = await openReportIds(state, request, onStep, budget);
          } catch (error) {
            if (error.code === "portal-busy") throw error;
            // The page or a sign-in is not to be had now: the saved ids still
            // answer, and the check waits for the next read.
          }
        }
        if (meta) {
          try {
            subjects = await client.readSummary(request, meta);
          } catch (error) {
            if (error.code === "portal-busy" || error.code === "busy" || error.code === "network" || error.code === "server") throw error;
            meta = null;
          }
        }
        if (!subjects) {
          meta = await openReportIds(state, request, onStep, budget);
          await onStep("Reading attendance…");
          subjects = await client.readSummary(request, meta);
        }
        const fresh = meta !== state.attendanceMeta;
        await storage.set({ attendanceMeta: { reportId: meta.reportId, sessionId: meta.sessionId, at: fresh ? now() : Number(meta.at || now()) } });
        const courses = Object.fromEntries(subjects.filter((subject) => subject.encryptCode).map((subject) => [client.normCode(subject.code), subject.encryptCode]));
        await storage.set({ attendanceCourses: courses });
        state.attendanceCourses = courses;

        // The totals are in: show them now, before any optional work, so a
        // slow or refused page never hides fresh attendance.
        carryMarks(subjects, state.attendanceSnapshot, campus);
        const early = buildSnapshot(subjects, campus, timetableOf(state).slots, currentLeaves(state), state.attendanceSnapshot?.timetableDueAt, savedExams(state));
        await storage.set({ attendanceSnapshot: early });

        const optional = await readOptionalPages(state, request, meta, budget, onStep, campus);
        const slots = optional.slots || timetableOf(state).slots;
        const history = await readTodaysMarks(state, request, meta, subjects, slots, campus, budget);
        let leaves = optional.leaves || currentLeaves(state);
        leaves = await countPending(request, meta, subjects, history, leaves);
        const snapshot = buildSnapshot(subjects, campus, slots, leaves, slots.length ? 0 : await firstTimetableDue(budget), optional.exams || savedExams(state));
        await storage.set({ attendanceSnapshot: snapshot, attendanceFailStreak: 0, attendanceBackoffUntil: 0 });
        await setStatus({ working: false, phase: "", error: "", code: "" });
        return { snapshot, nextRefreshAt: started + MANUAL_GAP_MS };
      } catch (error) {
        const code = error.code || "network";
        let message = error.code ? error.message : client.MESSAGES.network;
        // Whatever was saved before the failure (fresh totals, usually).
        const { attendanceSnapshot: latest } = await storage.get({ attendanceSnapshot: state.attendanceSnapshot });
        if (code === "tab-login") {
          // Not a failure: the tab owns the session. Run again once it lands.
          await storage.set({ attendanceAfterTab: now(), attendanceLastAttemptAt: 0 });
          await setStatus({ working: false, phase: "", error: message, code });
          return { snapshot: latest, error: message, code, nextRefreshAt: 0 };
        }
        if (code === "page-limit") {
          // The attendance page (or a sign-in's landing step) was refused.
          // Only pages wait; report calls carry on.
          if (!pagesPaused(state)) await pausePages(state);
          const limit = pagesPaused(state);
          await setStatus({ working: false, phase: "", error: limit.error.message, code });
          return { snapshot: latest, error: limit.error.message, code, nextRefreshAt: limit.until };
        }
        message = await recordBackoff(state, error);
        await setStatus({ working: false, phase: "", error: message, code });
        return { snapshot: latest, error: message, code, nextRefreshAt: (await storage.get({ attendanceBackoffUntil: 0 })).attendanceBackoffUntil || started + MANUAL_GAP_MS };
      } finally {
        await storage.set({ ...budget.saved(), attendanceRunUntil: 0 });
        await flushJournal();
      }
    }

    // A second refresh joins the one already running.
    function refresh() {
      if (refreshing) return refreshing;
      const tracked = exclusive(() => run()).finally(() => {
        if (refreshing === tracked) refreshing = null;
      });
      refreshing = tracked;
      return tracked;
    }

    // One CUIMS conversation at a time.
    function exclusive(task) {
      const run = (inflight || Promise.resolve()).catch(() => {}).then(task);
      const tracked = run.finally(() => {
        if (inflight === tracked) inflight = null;
      });
      inflight = tracked;
      return tracked;
    }

    // The CUIMS tab reached StudentHome after a refresh gave way to it.
    async function afterTabSignIn() {
      const { attendanceAfterTab } = await storage.get({ attendanceAfterTab: 0 });
      if (!attendanceAfterTab || now() - Number(attendanceAfterTab) > AFTER_TAB_MS) return { skipped: true };
      await storage.set({ attendanceAfterTab: 0 });
      return { refreshed: await refresh() };
    }

    function ingestLeavePage(which, html) {
      return exclusive(() => readLeaveUpdate(which, html));
    }

    function ingestTimetablePage(html) {
      return exclusive(() => readTimetableUpdate(html));
    }

    function ingestDateSheetPage(html) {
      return exclusive(() => readDateSheetUpdate(html));
    }

    // The saved UID changed: drop the last student's reads right away.
    function checkStudent() {
      return exclusive(async () => {
        await claimStudent(await storage.get(DEFAULTS));
      });
    }

    return { refresh, afterTabSignIn, ingestLeavePage, ingestTimetablePage, ingestDateSheetPage, noteTabPage, checkStudent };
  }

  api.DAEMON_DEFAULTS = DEFAULTS;
  api.LOGIN_TAB_FRESH_MS = LOGIN_TAB_FRESH_MS;
  api.freshGuard = freshGuard;
  api.createDaemon = createDaemon;
})(globalThis);
