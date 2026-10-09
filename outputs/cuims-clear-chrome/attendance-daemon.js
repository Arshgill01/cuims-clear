// Decides when the background may talk to CUIMS, and how much.
// One run at a time, a request budget, and a login guard shared with the
// CUIMS tab. Nothing runs on a timer: every request follows a popup action.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  const MINUTE = 60_000;
  const MANUAL_GAP_MS = 60_000;
  const BUDGET_WINDOW_MS = 10 * MINUTE;
  const BUDGET_MAX = 25;
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
  const RUN_LOCK_MS = 2 * MINUTE;
  const MAX_MARK_READS = 4;
  // Whole-semester mark lists for the Forecast tab, beyond today's reads.
  // The marks call is cookie-less and outside CUIMS's page throttle; a
  // subject is read again only after its counts move.
  const MAX_HISTORY_READS = 4;
  // History is optional: it only spends the budget while this much is left
  // for the reads that matter (a refresh, a sign-in, opening CUIMS or LMS).
  const HISTORY_RESERVE = 12;
  const HISTORY_VERSION = 1;
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
    attendanceHistory: null,
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
    // The CUIMS conversation in progress (a refresh or an open), and the
    // refresh in progress, if that is what it is.
    let inflight = null;
    let refreshing = null;

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
        room: () => BUDGET_MAX - log.length,
      };
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
      if (guard.failures.length >= BACKGROUND_FAILURE_LIMIT) throw client.coded("cooldown");

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
      } catch (error) {
        if (error.code === "portal-busy" || error.code === "busy") {
          await storage.set({ attendanceTimetable: { day: cached?.day || "", slots, triedAt: now() } });
          throw error;
        }
        // Other optional-page failures keep the cached timetable.
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
        } catch (error) {
          if (error.code === "portal-busy" || error.code === "busy") throw error;
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

    // Duty leave follows every attendance refresh; medical leave stays
    // infrequent and yields to attendance/timetable page loads.
    async function readLeaves(state, request, meta, heavy) {
      let leaves = currentLeaves(state);
      for (const which of ["dl", "ml"]) {
        if (which === "ml" && (heavy.used || now() - Math.max(Number(leaves?.mlTriedAt || 0), Number(leaves?.mlAt || 0)) < LEAVE_CHECK_MS)) continue;
        try {
          const applications = await client.readLeavePage(request, which);
          if (which === "dl") await storage.set({ sessionAlive: true, sessionCheckedAt: now() });
          leaves = await mergeLeaves({ ...state, attendanceLeaves: leaves }, request, meta, which, applications);
        } catch (error) {
          if (error.code === "portal-busy" || error.code === "busy" || (which === "dl" && ["signed-out", "tab-login"].includes(error.code))) throw error;
          leaves = { ...(leaves || {}), v: client.LEAVES_VERSION, triedAt: now(), ...(which === "ml" ? { mlTriedAt: now() } : {}) };
          await storage.set({ attendanceLeaves: leaves });
        }
      }
      return leaves;
    }

    // The student opened a leave page on CUIMS: read it there, for free.
    async function readLeaveUpdate(which, html) {
      if (!client.LEAVE_PAGES[which]) return null;
      const state = await storage.get(DEFAULTS);
      const wait = paused(state);
      if (wait) throw wait;
      const meta = state.attendanceMeta;
      const applications = which === "dl" ? client.parseDutyLeaves(html) : client.parseMedicalLeaves(html);
      const budget = meter(state);
      try {
        const leaves = await mergeLeaves(state, createRequest(budget), meta, which, applications);
        if (state.attendanceSnapshot) {
          await storage.set({ attendanceSnapshot: { ...state.attendanceSnapshot, leaves: snapshotLeaves(leaves) } });
        }
        return leaves;
      } catch (error) {
        const message = await recordBackoff(state, error);
        await setStatus({ working: false, error: message, code: error.code || "network" });
        throw error;
      } finally {
        await storage.set({ attendanceRequests: budget.log });
      }
    }

    // A subject's stored history is current while its counts stand still:
    // every new mark, and every leave decision, moves attended or delivered.
    function historyStale(entry, subject) {
      return !entry || Number(entry.attended) !== Number(subject.attended) || Number(entry.delivered) !== Number(subject.delivered);
    }

    // Day-by-day marks are only worth a request for subjects whose class
    // today has started and is not already known to be marked. The same call
    // answers with the whole semester, which the Forecast tab keeps; subjects
    // whose counts moved are read for it too, a few per refresh.
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
      for (const subject of subjects) {
        const mine = started.filter((slot) => client.slotBelongsTo(slot, subject));
        const earlier = sameDay ? previous.subjects?.find((item) => item.code === subject.code) : null;
        subject.marks = earlier?.marks || null;
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
      const allowance = failed ? 0 : Math.max(0, Math.min(MAX_HISTORY_READS, budget.room() - HISTORY_RESERVE));
      for (const subject of stale.slice(0, allowance)) {
        try {
          keep(subject, await client.readMarks(request, meta, subject.encryptCode));
        } catch (error) {
          // CUIMS pushing back stops the whole read; anything else waits for
          // the next refresh, keeping the attendance already read.
          if (error.code === "portal-busy") {
            if (changed) await storage.set({ attendanceHistory: { v: HISTORY_VERSION, subjects: history } });
            throw error;
          }
          break;
        }
      }
      if (changed) await storage.set({ attendanceHistory: { v: HISTORY_VERSION, subjects: history } });
    }

    async function run(reason) {
      const state = await storage.get(DEFAULTS);
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
      await onStep("Checking your CUIMS session…");
      try {
        // The report ids from the attendance page stay valid, so a normal
        // refresh uses GetReport plus the duty-leave page. The attendance
        // page is reopened only when
        // the ids are missing or stop working. GetReport answers without a
        // signed-in session, so only the page read says the session is alive.
        let meta = state.attendanceMeta?.reportId ? state.attendanceMeta : null;
        let subjects = null;
        if (meta) {
          try {
            subjects = await client.readSummary(request, meta);
          } catch (error) {
            if (error.code === "portal-busy" || error.code === "busy" || error.code === "network" || error.code === "server") throw error;
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
        // Attendance and timetable still take turns; duty leave is required
        // on every refresh, with medical leave deferred during those loads.
        const heavy = { used: pageLoaded ? 1 : 0 };
        const slots = await readTimetable(state, request, campus.key, heavy);
        await readTodaysMarks(state, request, meta, subjects, slots, campus, budget);
        await onStep("Reading duty leave…");
        let leaves;
        try {
          leaves = await readLeaves(state, request, meta, heavy);
        } catch (error) {
          if (error.code !== "signed-out") throw error;
          await storage.set({ sessionAlive: false, sessionCheckedAt: now() });
          await ensureSignedIn(state, request, reason, onStep);
          heavy.used = 1;
          try {
            leaves = await readLeaves(state, request, meta, heavy);
          } catch (again) {
            if (again.code === "signed-out") throw client.coded("login-shape", "CUIMS accepted the login but did not keep the session. Try again.");
            throw again;
          }
        }
        const snapshot = {
          fetchedAt: new Date(now()).toISOString(),
          marksDay: campus.key,
          slots,
          subjects: subjects.map(({ encryptCode, ...subject }) => subject),
          leaves: snapshotLeaves(leaves),
        };
        await storage.set({ attendanceSnapshot: snapshot, attendanceFailStreak: 0, attendanceBackoffUntil: 0 });
        await setStatus({ working: false, phase: "", error: "", code: "" });
        return { snapshot, nextRefreshAt: started + MANUAL_GAP_MS };
      } catch (error) {
        const code = error.code || "network";
        let message = error.code ? error.message : client.MESSAGES.network;
        if (code === "tab-login") {
          // Not a failure: the tab owns the session. Run again once it lands.
          await storage.set({ attendanceAfterTab: now(), attendanceLastAttemptAt: 0 });
          await setStatus({ working: false, phase: "", error: message, code });
          return { snapshot: state.attendanceSnapshot, error: message, code, nextRefreshAt: 0 };
        }
        message = await recordBackoff(state, error);
        await setStatus({ working: false, phase: "", error: message, code });
        return { snapshot: state.attendanceSnapshot, error: message, code, nextRefreshAt: (await storage.get({ attendanceBackoffUntil: 0 })).attendanceBackoffUntil || started + MANUAL_GAP_MS };
      } finally {
        await storage.set({ attendanceRequests: budget.log, attendanceRunUntil: 0 });
      }
    }

    // A second refresh joins the one already running. An open that is
    // running is not a refresh: the refresh waits for it, then reads.
    function refresh(reason = "manual") {
      if (refreshing) return refreshing;
      const tracked = exclusive(() => run(reason)).finally(() => {
        if (refreshing === tracked) refreshing = null;
      });
      refreshing = tracked;
      return tracked;
    }

    // Before the popup opens CUIMS or LMS: make sure this browser holds a
    // signed-in session, so the tab goes straight in instead of showing the
    // login page and solving a second captcha. The background and the tabs
    // share one cookie jar, so a background sign-in is the tab's session.
    // Never runs while a tab is on the login page, and obeys the same guard,
    // budget, and limits as a manual refresh.
    async function openSession({ signal } = {}) {
      const state = await storage.get({ ...DEFAULTS, autoSubmitLogin: true });
      const wait = paused(state);
      if (wait) return { alive: false, reason: wait.code, error: wait.message };
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
        const message = await recordBackoff(state, error);
        if (BACKOFF_CODES.has(error.code || "network")) await setStatus({ working: false, error: message, code: error.code || "network" });
        return { alive: false, reason: error.code || "network", error: message };
      } finally {
        await storage.set({ attendanceRequests: budget.log });
        // Put back whatever the attendance tab was showing.
        if (signing && Number((await storage.get({ attendanceBackoffUntil: 0 })).attendanceBackoffUntil) <= now()) await storage.set({ attendanceStatus: state.attendanceStatus ? { ...state.attendanceStatus, working: false } : null });
      }
    }

    // One CUIMS conversation at a time: an open waits for a running refresh.
    function exclusive(task) {
      const run = (inflight || Promise.resolve()).catch(() => {}).then(task);
      const tracked = run.finally(() => {
        if (inflight === tracked) inflight = null;
      });
      inflight = tracked;
      return tracked;
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

    // LMS SSO shares the same queue, meter and cooldown as attendance.
    function withRequests(task) {
      return exclusive(async () => {
        const state = await storage.get(DEFAULTS);
        const wait = paused(state);
        if (wait) throw wait;
        const budget = meter(state);
        const request = createRequest(budget);
        try {
          return await task((target, options = {}) => request(target, { ...options, response: true }));
        } catch (error) {
          error.message = await recordBackoff(state, error);
          await setStatus({ working: false, error: error.message, code: error.code || "network" });
          throw error;
        } finally {
          await storage.set({ attendanceRequests: budget.log });
        }
      });
    }

    function ingestLeavePage(which, html) {
      return exclusive(() => readLeaveUpdate(which, html));
    }

    return { refresh, afterTabSignIn, ensureSession, ingestLeavePage, withRequests };
  }

  api.DAEMON_DEFAULTS = DEFAULTS;
  api.LOGIN_TAB_FRESH_MS = LOGIN_TAB_FRESH_MS;
  api.freshGuard = freshGuard;
  api.createDaemon = createDaemon;
})(globalThis);
