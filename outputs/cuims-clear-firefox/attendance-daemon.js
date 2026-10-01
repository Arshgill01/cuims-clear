// Decides when the background may talk to CUIMS, and how much.
// One run at a time, a request budget, and a login guard shared with the
// CUIMS tab. Nothing runs on a timer: every request follows a popup action.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  const MINUTE = 60_000;
  const MANUAL_GAP_MS = 30_000;
  const BUDGET_WINDOW_MS = 10 * MINUTE;
  const BUDGET_MAX = 40;
  const FAILURE_WINDOW_MS = 20 * MINUTE;
  const LOCKOUT_MS = 20 * MINUTE;
  const MANUAL_FAILURE_LIMIT = 3;
  const PAGE_LOGIN_GRACE_MS = 25_000;
  // A CUIMS tab on the login page beats every 8 s; background tabs may be
  // throttled to one beat a minute.
  const LOGIN_TAB_FRESH_MS = 75_000;
  const AFTER_TAB_MS = 5 * MINUTE;
  const SIGNIN_LOCK_MS = 90_000;
  const RUN_LOCK_MS = 2 * MINUTE;
  const MAX_MARK_READS = 4;
  const BACKOFF_MINUTES = [1, 2, 5, 10, 20];
  // CUIMS's own throttle lasts minutes, so its backoff starts at five.
  const THROTTLE_MINUTES = [5, 10, 20, 30];
  const BACKOFF_CODES = new Set(["report-shape", "portal-redirect", "portal-busy", "busy", "server", "network", "login-shape"]);
  const TIMETABLE_RETRY_MS = 60 * MINUTE;
  const LEAVE_CHECK_MS = 3 * 60 * MINUTE;

  const DEFAULTS = {
    uid: "",
    password: "",
    autoSolveCaptcha: true,
    attendanceSnapshot: null,
    attendanceTimetable: null,
    attendanceLeaves: null,
    attendanceCourses: null,
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

    async function ensureSignedIn(state, request, reason, onStep, signal) {
      const uid = String(state.uid || "").trim();
      if (!uid || !state.password) throw client.coded("needs-login");
      if (state.autoSolveCaptcha === false) {
        throw client.coded("needs-login", "Captcha solving is off, so fetch cannot sign in. Sign in on CUIMS, then refresh.");
      }
      let guard = freshGuard(state.loginGuard, now());
      if (guard.lockoutUntil > now()) throw client.coded("lockout");
      if (guard.rejectedUid && guard.rejectedUid === uid) throw client.coded("bad-password");
      if (guard.failures.length >= MANUAL_FAILURE_LIMIT) throw client.coded("cooldown");

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

      // One submit per sign-in: the solver is all but always right, so a
      // refusal means something else is going on, and guessing again only
      // walks towards CUIMS's lockout. Unsure reads are re-drawn for free.
      const submits = Math.min(1, MANUAL_FAILURE_LIMIT - guard.failures.length);
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

    // The timetable only shapes today's class chips, so
    // it never fails a refresh. A good read lasts the day; a failed one is
    // retried at most hourly. It is also never read in the same run as the
    // heavy attendance page: CUIMS throttles a session that opens several
    // inner pages at once.
    async function readTimetable(state, request, today, heavy) {
      const cached = state.attendanceTimetable;
      const slots = cached?.slots || [];
      if (cached?.day === today && slots.length) return slots;
      if (heavy.used || now() - Number(cached?.triedAt || 0) < TIMETABLE_RETRY_MS) return slots;
      heavy.used += 1;
      try {
        const fresh = await client.readTimetable(request);
        if (fresh.length) {
          await storage.set({ attendanceTimetable: { day: today, slots: fresh, triedAt: now() } });
          return fresh;
        }
      } catch {
        // Signed out, throttled, or a tab owns the session: try again later.
      }
      await storage.set({ attendanceTimetable: { day: cached?.day || "", slots, triedAt: now() } });
      return slots;
    }

    // Which subjects' classes a pending leave covers: the absent marks on its
    // days (and, for lecture-based duty leave, at its class times). Read with
    // the cookie-less marks call, one per subject that could be affected.
    async function countPendingLeave(request, meta, courses, applications) {
      const waiting = applications.filter((leave) => leave.state === "pending");
      const counts = {};
      if (!waiting.length) return counts;
      for (const [code, encryptCode] of Object.entries(courses || {})) {
        let marks;
        try {
          marks = await client.readMarks(request, meta, encryptCode);
        } catch {
          continue;
        }
        for (const mark of marks || []) {
          if (mark.kind !== "absent") continue;
          const day = client.parseDateKey(mark.date);
          const start = client.parseRange(mark.time)?.start;
          for (const leave of waiting) {
            if (!leave.days.includes(day)) continue;
            if (leave.timings.length && !leave.timings.some((timing) => client.parseRange(timing)?.start === start)) continue;
            const entry = (counts[code] ||= { vdl: 0, idl: 0, adl: 0, ml: 0 });
            entry[leave.kind === "ml" ? "ml" : leave.dlType || "vdl"] += 1;
            break;
          }
        }
      }
      return counts;
    }

    // Leave read before LEAVES_VERSION counted refusals as pending; drop it.
    function currentLeaves(state) {
      const cached = state.attendanceLeaves;
      return cached?.v === client.LEAVES_VERSION ? cached : null;
    }

    function snapshotLeaves(leaves) {
      return leaves?.checkedAt ? { v: client.LEAVES_VERSION, checkedAt: leaves.checkedAt, pending: leaves.pending || {} } : null;
    }

    // Folds one leave page's applications in and recounts pending leave when
    // the set of pending applications changed.
    async function mergeLeaves(state, request, meta, which, applications) {
      const cached = currentLeaves(state) || {};
      const apps = { dl: cached.apps?.dl || [], ml: cached.apps?.ml || [], [which]: applications };
      const all = [...apps.dl, ...apps.ml];
      const pendingKey = all.filter((leave) => leave.state === "pending").map((leave) => leave.id).sort().join(",");
      const pending = pendingKey === cached.pendingKey && cached.pending ? cached.pending : await countPendingLeave(request, meta, state.attendanceCourses, all);
      const leaves = { ...cached, v: client.LEAVES_VERSION, apps, pending, pendingKey, [`${which}At`]: now(), checkedAt: now(), triedAt: now() };
      await storage.set({ attendanceLeaves: leaves });
      return leaves;
    }

    // Leave pages are heavy inner pages: at most one every three hours,
    // alternating duty and medical, and never alongside another heavy page.
    async function readLeaves(state, request, meta, heavy) {
      const cached = currentLeaves(state);
      if (heavy.used || now() - Number(cached?.triedAt || 0) < LEAVE_CHECK_MS) return cached;
      heavy.used += 1;
      const which = Number(cached?.dlAt || 0) <= Number(cached?.mlAt || 0) ? "dl" : "ml";
      try {
        return await mergeLeaves(state, request, meta, which, await client.readLeavePage(request, which));
      } catch {
        const leaves = { ...(cached || {}), v: client.LEAVES_VERSION, triedAt: now() };
        await storage.set({ attendanceLeaves: leaves });
        return leaves;
      }
    }

    // The student opened a leave page on CUIMS: read it there, for free.
    async function ingestLeavePage(which, html) {
      if (!client.LEAVE_PAGES[which]) return null;
      const state = await storage.get(DEFAULTS);
      const meta = state.attendanceMeta;
      const applications = which === "dl" ? client.parseDutyLeaves(html) : client.parseMedicalLeaves(html);
      const budget = meter(state);
      try {
        const leaves = await mergeLeaves(state, createRequest(budget), meta, which, applications);
        if (state.attendanceSnapshot) {
          await storage.set({ attendanceSnapshot: { ...state.attendanceSnapshot, leaves: snapshotLeaves(leaves) } });
        }
        return leaves;
      } finally {
        await storage.set({ attendanceRequests: budget.log });
      }
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
        } catch {
          // Today's marks are extra detail; the totals already arrived.
          return;
        }
      }
    }

    async function run(reason) {
      const state = await storage.get(DEFAULTS);
      const started = now();
      const lastError = state.attendanceStatus?.error || "";
      if (started - Number(state.attendanceLastAttemptAt || 0) < MANUAL_GAP_MS) {
        return { snapshot: state.attendanceSnapshot, recent: true, ...(lastError ? { error: lastError, code: state.attendanceStatus?.code } : {}) };
      }
      const backoffUntil = Number(state.attendanceBackoffUntil || 0);
      if (backoffUntil > started) {
        const minutes = Math.max(1, Math.ceil((backoffUntil - started) / MINUTE));
        const reason = lastError.replace(/\s*Next try in \d+ min\.\s*$/, "") || "CUIMS refused the last read.";
        return { snapshot: state.attendanceSnapshot, code: "backoff", error: `${reason} Next try in ${minutes} min.` };
      }
      if (Number(state.attendanceRunUntil || 0) > started) return { snapshot: state.attendanceSnapshot, busy: true };

      const budget = meter(state);
      const request = createRequest(budget);
      const onStep = (phase) => setStatus({ working: true, phase });
      await storage.set({
        attendanceRunUntil: started + RUN_LOCK_MS,
        attendanceLastAttemptAt: started,
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
        const pageLoaded = !subjects;
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
        const courses = Object.fromEntries(subjects.filter((subject) => subject.encryptCode).map((subject) => [client.normCode(subject.code), subject.encryptCode]));
        await storage.set({ attendanceCourses: courses });
        state.attendanceCourses = courses;
        // At most one heavy CUIMS page per refresh: the attendance page, else
        // the timetable, else a leave page.
        const heavy = { used: pageLoaded ? 1 : 0 };
        const slots = await readTimetable(state, request, campus.key, heavy);
        await readTodaysMarks(state, request, meta, subjects, slots, campus);
        const leaves = await readLeaves(state, request, meta, heavy);
        const snapshot = {
          fetchedAt: new Date(now()).toISOString(),
          marksDay: campus.key,
          slots,
          subjects: subjects.map(({ encryptCode, ...subject }) => subject),
          leaves: snapshotLeaves(leaves),
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
          const table = code === "portal-busy" ? THROTTLE_MINUTES : BACKOFF_MINUTES;
          const minutes = table[Math.min(streak, table.length) - 1];
          const said = (error.detail?.title || error.detail?.text || "").trim().slice(0, 70);
          const kept = state.attendanceSnapshot ? " Showing your last read." : "";
          message = `${message}${said ? ` CUIMS said “${said}”.` : ""}${kept} Next try in ${minutes} min.`;
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

    // Before the popup opens CUIMS or LMS: make sure this browser holds a
    // signed-in session, so the tab goes straight in instead of showing the
    // login page and solving a second captcha. The background and the tabs
    // share one cookie jar, so a background sign-in is the tab's session.
    // Never runs while a tab is on the login page, and obeys the same guard,
    // budget, and limits as a manual refresh.
    async function openSession({ signal } = {}) {
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
        await ensureSignedIn(state, request, "open", (phase) => setStatus({ working: true, phase }), signal);
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

    // `signal` lets the caller give up: an aborted sign-in never submits.
    function ensureSession(options = {}) {
      return exclusive(() => openSession(options));
    }

    // The CUIMS tab reached StudentHome after a refresh gave way to it.
    async function afterTabSignIn() {
      const { attendanceAfterTab } = await storage.get({ attendanceAfterTab: 0 });
      if (!attendanceAfterTab || now() - Number(attendanceAfterTab) > AFTER_TAB_MS) return { skipped: true };
      await storage.set({ attendanceAfterTab: 0 });
      return { refreshed: await refresh("manual") };
    }

    return { refresh, afterTabSignIn, ensureSession, ingestLeavePage };
  }

  api.DAEMON_DEFAULTS = DEFAULTS;
  api.LOGIN_TAB_FRESH_MS = LOGIN_TAB_FRESH_MS;
  api.freshGuard = freshGuard;
  api.createDaemon = createDaemon;
})(globalThis);
