// Decides when the background may talk to CUIMS, and how much.
// One run at a time, a request budget, a login guard shared with the CUIMS
// tab, and automatic work only during weekday class hours.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  const MINUTE = 60_000;
  const MANUAL_GAP_MS = 30_000;
  const BUDGET_WINDOW_MS = 10 * MINUTE;
  const BUDGET_MAX = 40;
  const FAILURE_WINDOW_MS = 20 * MINUTE;
  const LOCKOUT_MS = 20 * MINUTE;
  const MANUAL_FAILURE_LIMIT = 3;
  const AUTO_SIGNIN_GAP_MS = 60 * MINUTE;
  const KEEPALIVE_MS = 9 * MINUTE;
  const PAGE_LOGIN_GRACE_MS = 25_000;
  // A CUIMS tab on the login page beats every 8 s; background tabs may be
  // throttled to one beat a minute.
  const LOGIN_TAB_FRESH_MS = 75_000;
  const AFTER_TAB_MS = 5 * MINUTE;
  const SIGNIN_LOCK_MS = 90_000;
  const RUN_LOCK_MS = 2 * MINUTE;
  const MAX_MARK_READS = 4;
  const BACKOFF_MINUTES = [1, 2, 5, 10, 20];
  const BACKOFF_CODES = new Set(["report-shape", "portal-redirect", "busy", "server", "network", "login-shape"]);

  const DEFAULTS = {
    uid: "",
    password: "",
    autoSolveCaptcha: true,
    attendanceAuto: false,
    attendanceSnapshot: null,
    attendanceTimetable: null,
    attendanceRequests: [],
    attendanceRunUntil: 0,
    attendanceStatus: null,
    attendanceMeta: null,
    attendanceLastAttemptAt: 0,
    attendanceBackoffUntil: 0,
    attendanceFailStreak: 0,
    sessionAlive: false,
    sessionCheckedAt: 0,
    loginGuard: null,
    lastAutoSignInAt: 0,
    pageLoginAt: 0,
    loginTabAt: 0,
  };

  function freshGuard(guard, now) {
    const value = guard && typeof guard === "object" ? guard : {};
    return {
      failures: (Array.isArray(value.failures) ? value.failures : []).filter((item) => now - Number(item?.at || 0) < FAILURE_WINDOW_MS),
      lockoutUntil: Number(value.lockoutUntil || 0),
      rejectedUid: String(value.rejectedUid || ""),
    };
  }

  function createDaemon({ storage, fetchImpl, solveCaptcha, now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
    const client = api;
    let inflight = null;

    async function tabOnLoginPage() {
      const { loginTabAt } = await storage.get({ loginTabAt: 0 });
      return now() - Number(loginTabAt || 0) < LOGIN_TAB_FRESH_MS;
    }

    function markLoginTouch() {
      return storage.set({ bgLoginTouchAt: now() });
    }

    function createRequest(budget) {
      return client.createRequest({ fetchImpl, budget: budget.take, yieldToTab: tabOnLoginPage, onLoginTouch: markLoginTouch });
    }

    async function setStatus(status) {
      await storage.set({ attendanceStatus: { ...status, at: now() } });
    }

    function meter(state) {
      const log = (state.attendanceRequests || []).filter((at) => now() - at < BUDGET_WINDOW_MS);
      return {
        log,
        take() {
          if (log.length >= BUDGET_MAX) throw client.coded("busy");
          log.push(now());
        },
      };
    }

    async function recordFailure(guard, patch = {}) {
      const next = { ...guard, ...patch, failures: [...guard.failures, { at: now(), by: "bg" }] };
      await storage.set({ loginGuard: next });
      return next;
    }

    async function ensureSignedIn(state, request, reason, onStep) {
      const uid = String(state.uid || "").trim();
      if (!uid || !state.password) throw client.coded("needs-login");
      if (state.autoSolveCaptcha === false) {
        throw client.coded("needs-login", "Captcha solving is off, so fetch cannot sign in. Sign in on CUIMS, then refresh.");
      }
      let guard = freshGuard(state.loginGuard, now());
      if (guard.lockoutUntil > now()) throw client.coded("lockout");
      if (guard.rejectedUid && guard.rejectedUid === uid) throw client.coded("bad-password");
      if (reason === "scheduled") {
        if (guard.failures.length || now() - Number(state.lastAutoSignInAt || 0) < AUTO_SIGNIN_GAP_MS) throw client.coded("cooldown");
      } else if (guard.failures.length >= MANUAL_FAILURE_LIMIT) {
        throw client.coded("cooldown");
      }

      if (now() - Number(state.pageLoginAt || 0) < PAGE_LOGIN_GRACE_MS) {
        onStep("Waiting for the CUIMS tab to sign in…");
        await sleep(4000);
        try {
          await client.openAttendance(request);
          return;
        } catch (error) {
          if (error.code !== "signed-out") throw error;
        }
        throw client.coded("cooldown", "A CUIMS tab is signing in. Refresh in a moment.");
      }

      const submits = reason === "scheduled" ? 1 : Math.min(2, MANUAL_FAILURE_LIMIT - guard.failures.length);
      await storage.set({ bgSignInUntil: now() + SIGNIN_LOCK_MS });
      try {
        let submitted = 0;
        let unreadable = 0;
        while (submitted < submits && unreadable < 2) {
          let result;
          try {
            result = await client.signIn({ request, uid, password: state.password, solveCaptcha, onStep });
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
              ...(reason === "scheduled" ? { lastAutoSignInAt: now() } : {}),
            });
            return;
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

    async function readTimetable(state, request, today) {
      const cached = state.attendanceTimetable;
      if (cached && cached.day === today) return cached.slots || [];
      let slots = cached?.slots || [];
      try {
        const fresh = await client.readTimetable(request);
        if (fresh.length) slots = fresh;
      } catch (error) {
        if (error.code === "signed-out" || error.code === "busy") throw error;
      }
      await storage.set({ attendanceTimetable: { day: today, slots } });
      return slots;
    }

    // Day-by-day marks are only worth a request for subjects whose class
    // today has started and is not already known to be marked.
    async function readTodaysMarks(state, request, meta, subjects, slots, campus) {
      const previous = state.attendanceSnapshot;
      const sameDay = previous?.marksDay === campus.key;
      const started = client.todaysSlots(slots, campus).filter((slot) => slot.start <= campus.minutes);
      let reads = 0;
      for (const subject of subjects) {
        const mine = started.filter((slot) => client.slotBelongsTo(slot, subject));
        const earlier = sameDay ? previous.subjects?.find((item) => item.code === subject.code) : null;
        subject.marks = earlier?.marks || null;
        if (!mine.length || !subject.encryptCode || reads >= MAX_MARK_READS) continue;
        const known = (subject.marks || []).filter((mark) => client.parseDateKey(mark.date) === campus.key).length;
        if (subject.marks && known >= mine.length) continue;
        // A new mark always raises the delivered count, so an unchanged count
        // means the marks read earlier today are still current.
        if (earlier?.marks && Number(earlier.delivered) === Number(subject.delivered)) continue;
        reads += 1;
        try {
          const marks = await client.readMarks(request, meta, subject.encryptCode);
          subject.marks = (marks || []).filter((mark) => client.parseDateKey(mark.date) === campus.key);
        } catch (error) {
          if (error.code === "signed-out" || error.code === "busy") throw error;
        }
      }
    }

    async function run(reason) {
      const state = await storage.get(DEFAULTS);
      const started = now();
      if (reason === "scheduled" && !state.attendanceAuto) return { skipped: true };
      const lastError = state.attendanceStatus?.error || "";
      if (reason !== "scheduled" && started - Number(state.attendanceLastAttemptAt || 0) < MANUAL_GAP_MS) {
        return { snapshot: state.attendanceSnapshot, recent: true, ...(lastError ? { error: lastError, code: state.attendanceStatus?.code } : {}) };
      }
      const backoffUntil = Number(state.attendanceBackoffUntil || 0);
      if (backoffUntil > started) {
        const minutes = Math.max(1, Math.ceil((backoffUntil - started) / MINUTE));
        return { snapshot: state.attendanceSnapshot, code: "backoff", error: `${lastError || "CUIMS refused the last read."} Next try in ${minutes} min.` };
      }
      if (Number(state.attendanceRunUntil || 0) > started) return { snapshot: state.attendanceSnapshot, busy: true };

      const budget = meter(state);
      const request = createRequest(budget);
      const onStep = (phase) => setStatus({ working: true, phase });
      await storage.set({
        attendanceRunUntil: started + RUN_LOCK_MS,
        attendanceLastAttemptAt: started,
        ...(reason === "manual" ? { attendanceAuto: true } : {}),
      });
      await onStep("Checking your CUIMS session…");
      try {
        // The report ids from the attendance page stay valid, so a normal
        // refresh is one GetReport call. The heavy page is reopened only when
        // the ids are missing or stop working. GetReport answers without a
        // signed-in session, so only the page read says the session is alive.
        let meta = state.attendanceMeta?.reportId ? state.attendanceMeta : null;
        let subjects = null;
        if (meta) {
          try {
            subjects = await client.readSummary(request, meta);
          } catch (error) {
            if (error.code === "busy" || error.code === "network" || error.code === "server") throw error;
            meta = null;
          }
        }
        if (!subjects) {
          try {
            meta = await client.openAttendance(request);
          } catch (error) {
            if (error.code !== "signed-out") throw error;
            await storage.set({ sessionAlive: false, sessionCheckedAt: now() });
            await ensureSignedIn(state, request, reason, onStep);
            try {
              meta = await client.openAttendance(request);
            } catch (again) {
              if (again.code === "signed-out") throw client.coded("login-shape", "CUIMS accepted the login but did not keep the session. Try again.");
              throw again;
            }
          }
          await storage.set({ sessionAlive: true, sessionCheckedAt: now() });
          await onStep("Reading attendance…");
          subjects = await client.readSummary(request, meta);
        }
        await storage.set({ attendanceMeta: { reportId: meta.reportId, sessionId: meta.sessionId } });
        const campus = client.campusParts(new Date(now()));
        const slots = await readTimetable(state, request, campus.key);
        await readTodaysMarks(state, request, meta, subjects, slots, campus);
        const snapshot = {
          fetchedAt: new Date(now()).toISOString(),
          marksDay: campus.key,
          slots,
          subjects: subjects.map(({ encryptCode, ...subject }) => subject),
        };
        await storage.set({ attendanceSnapshot: snapshot, attendanceFailStreak: 0, attendanceBackoffUntil: 0 });
        await setStatus({ working: false, phase: "", error: "", code: "" });
        return { snapshot };
      } catch (error) {
        const code = error.code || "network";
        let message = error.code ? error.message : client.MESSAGES.network;
        if (code === "tab-login") {
          // Not a failure: the tab owns the session. Run again once it lands.
          await storage.set({ attendanceAfterTab: now(), attendanceLastAttemptAt: 0 });
          await setStatus({ working: false, phase: "", error: message, code });
          return { snapshot: state.attendanceSnapshot, error: message, code };
        }
        if (BACKOFF_CODES.has(code)) {
          const streak = Number(state.attendanceFailStreak || 0) + 1;
          const minutes = BACKOFF_MINUTES[Math.min(streak, BACKOFF_MINUTES.length) - 1];
          const said = (error.detail?.title || error.detail?.text || "").trim().slice(0, 70);
          message = `${message}${said ? ` CUIMS said “${said}”.` : ""} Next try in ${minutes} min.`;
          await storage.set({
            attendanceFailStreak: streak,
            attendanceBackoffUntil: now() + minutes * MINUTE,
            ...(code === "report-shape" || code === "portal-redirect" ? { attendanceMeta: null } : {}),
            ...(error.detail ? { attendanceLastBad: { ...error.detail, code, at: now() } } : {}),
          });
        }
        await setStatus({ working: false, phase: "", error: message, code });
        return { snapshot: state.attendanceSnapshot, error: message, code };
      } finally {
        await storage.set({ attendanceRequests: budget.log, attendanceRunUntil: 0 });
      }
    }

    function refresh(reason = "manual") {
      return inflight || exclusive(() => run(reason));
    }

    // Alarm tick. Outside weekday class hours it does nothing at all.
    async function tick() {
      if (inflight) return { skipped: true };
      const state = await storage.get(DEFAULTS);
      if (!state.attendanceAuto) return { skipped: true };
      const slots = state.attendanceTimetable?.slots || state.attendanceSnapshot?.slots || [];
      const hours = client.campusWindow(slots, new Date(now()));
      if (!hours.open) return { skipped: true };
      if (client.classEndedSince(slots, state.attendanceSnapshot?.fetchedAt, new Date(now()))) {
        return { refreshed: await refresh("scheduled") };
      }
      if (!state.sessionAlive || now() - Number(state.sessionCheckedAt || 0) < KEEPALIVE_MS) return { skipped: true };
      const budget = meter(state);
      try {
        const alive = await client.pingHome(createRequest(budget));
        await storage.set({ sessionAlive: alive, sessionCheckedAt: now() });
        return { pinged: true, alive };
      } catch {
        return { pinged: false };
      } finally {
        await storage.set({ attendanceRequests: budget.log });
      }
    }

    // Before the popup opens CUIMS or LMS: make sure this browser holds a
    // signed-in session, so the tab goes straight in instead of showing the
    // login page and solving a second captcha. The background and the tabs
    // share one cookie jar, so a background sign-in is the tab's session.
    // Never runs while a tab is on the login page, and obeys the same guard,
    // budget, and limits as a manual refresh.
    async function openSession() {
      const state = await storage.get({ ...DEFAULTS, autoSubmitLogin: true });
      if (await tabOnLoginPage()) return { alive: false, reason: "tab-login" };
      const budget = meter(state);
      const request = createRequest(budget);
      let signing = false;
      try {
        if (await client.pingHome(request)) {
          await storage.set({ sessionAlive: true, sessionCheckedAt: now() });
          return { alive: true };
        }
        await storage.set({ sessionAlive: false, sessionCheckedAt: now() });
        if (state.autoSubmitLogin === false) return { alive: false, reason: "disabled" };
        signing = true;
        await ensureSignedIn(state, request, "open", (phase) => setStatus({ working: true, phase }));
        await storage.set({ sessionAlive: true, sessionCheckedAt: now() });
        return { alive: true, signedIn: true };
      } catch (error) {
        return { alive: false, reason: error.code || "network" };
      } finally {
        await storage.set({ attendanceRequests: budget.log });
        // Put back whatever the attendance tab was showing.
        if (signing) await storage.set({ attendanceStatus: state.attendanceStatus ? { ...state.attendanceStatus, working: false } : null });
      }
    }

    // One CUIMS conversation at a time: an open waits for a running refresh.
    function exclusive(task) {
      const run = (inflight || Promise.resolve()).catch(() => {}).then(task);
      const tracked = run.finally(() => {
        if (inflight === tracked) inflight = null;
      });
      inflight = tracked;
      return run;
    }

    function ensureSession() {
      return exclusive(openSession);
    }

    // The CUIMS tab reached StudentHome after a refresh gave way to it.
    async function afterTabSignIn() {
      const { attendanceAfterTab } = await storage.get({ attendanceAfterTab: 0 });
      if (!attendanceAfterTab || now() - Number(attendanceAfterTab) > AFTER_TAB_MS) return { skipped: true };
      await storage.set({ attendanceAfterTab: 0 });
      return { refreshed: await refresh("manual") };
    }

    return { refresh, tick, afterTabSignIn, ensureSession };
  }

  api.DAEMON_DEFAULTS = DEFAULTS;
  api.LOGIN_TAB_FRESH_MS = LOGIN_TAB_FRESH_MS;
  api.freshGuard = freshGuard;
  api.createDaemon = createDaemon;
})(globalThis);
