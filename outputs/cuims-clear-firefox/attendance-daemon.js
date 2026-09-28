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
      const request = client.createRequest({ fetchImpl, budget: budget.take });
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
      if (!inflight) inflight = run(reason).finally(() => (inflight = null));
      return inflight;
    }

    // Alarm tick. Outside weekday class hours it does nothing at all.
    async function tick() {
      if (inflight) return { skipped: true };
      const state = await storage.get(DEFAULTS);
      if (!state.attendanceAuto) return { skipped: true };
      const slots = state.attendanceTimetable?.slots || state.attendanceSnapshot?.slots || [];
      const window = client.campusWindow(slots, new Date(now()));
      if (!window.open) return { skipped: true };
      if (client.classEndedSince(slots, state.attendanceSnapshot?.fetchedAt, new Date(now()))) {
        return { refreshed: await refresh("scheduled") };
      }
      if (!state.sessionAlive || now() - Number(state.sessionCheckedAt || 0) < KEEPALIVE_MS) return { skipped: true };
      const budget = meter(state);
      try {
        const alive = await client.pingHome(client.createRequest({ fetchImpl, budget: budget.take }));
        await storage.set({ sessionAlive: alive, sessionCheckedAt: now() });
        return { pinged: true, alive };
      } catch {
        return { pinged: false };
      } finally {
        await storage.set({ attendanceRequests: budget.log });
      }
    }

    return { refresh, tick };
  }

  api.DAEMON_DEFAULTS = DEFAULTS;
  api.freshGuard = freshGuard;
  api.createDaemon = createDaemon;
})(globalThis);
