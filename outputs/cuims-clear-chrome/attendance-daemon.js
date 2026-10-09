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
  // CUIMS throttles the account for 10+ minutes after a few inner pages
  // (attendance, timetable, leave) close together; StudentHome and the
  // report calls do not count. So a Refresh loads at most one inner page,
  // and an optional one (timetable, leave) only when neither the background
  // nor a CUIMS tab has loaded one for five minutes. Only the attendance
  // page, when the report ids are missing, goes ahead regardless.
  const PAGE_GAP_MS = 5 * MINUTE;
  // Open CUIMS skips its StudentHome check this soon after a read or a CUIMS
  // tab showed the session alive.
  const SESSION_FRESH_MS = 2 * MINUTE;
  // When CUIMS limits the account's page loads (inner pages redirect to
  // error.html, for 10+ minutes), the background loads no inner page and
  // never signs in for this long, longer each time it happens again. The
  // report calls are outside the limit, so attendance still updates.
  const PAGE_PAUSE_MINUTES = [15, 30, 60];

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
    attendancePageAt: 0,
    tabPageAt: 0,
    pagesPausedUntil: 0,
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

  // A CUIMS tab that lands on error.html (tabLimitedAt, from content.js) has
  // met the limit too.
  function pagesPauseEnd(state) {
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

    // Every request counts against the rolling budget; inner pages also move
    // the clock that spaces them out (PAGE_GAP_MS), as do the ones a CUIMS
    // tab loads (tabPageAt, from content.js).
    function meter(state) {
      const log = (state.attendanceRequests || []).filter((at) => now() - at < BUDGET_WINDOW_MS);
      let pageAt = Number(state.attendancePageAt || 0);
      const tabPageAt = Number(state.tabPageAt || 0);
      const pausedUntil = pagesPauseEnd(state);
      return {
        log,
        take(target) {
          if (log.length >= BUDGET_MAX) throw client.coded("busy");
          log.push(now());
          if (client.isInnerPage(target)) pageAt = now();
        },
        room: () => BUDGET_MAX - log.length,
        pageFree: () => now() >= pausedUntil && now() - Math.max(pageAt, tabPageAt) >= PAGE_GAP_MS,
        saved: () => ({ attendanceRequests: log, attendancePageAt: pageAt }),
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

    // CUIMS refused an inner page: hold every page load and sign-in. A page
    // that loads again ends the streak.
    async function pausePages(state) {
      const streak = Number(state.pagesPauseStreak || 0) + 1;
      const until = now() + PAGE_PAUSE_MINUTES[Math.min(streak, PAGE_PAUSE_MINUTES.length) - 1] * MINUTE;
      Object.assign(state, { pagesPausedUntil: until, pagesPauseStreak: streak });
      await storage.set({ pagesPausedUntil: until, pagesPauseStreak: streak });
      return until;
    }

    function pagesPaused(state) {
      const until = pagesPauseEnd(state);
      if (until <= now()) return null;
      const minutes = Math.max(1, Math.ceil((until - now()) / MINUTE));
      const kept = state.attendanceSnapshot ? " Showing your last read." : "";
      return { until, error: client.coded("page-limit", `${client.MESSAGES["page-limit"]}${kept} Next try in ${minutes} min.`) };
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

    // The timetable only shapes today's class chips, so it never fails a
    // refresh. A good read lasts the day; a failed one is retried at most
    // hourly. It is an optional inner page: it waits for PAGE_GAP_MS after
    // any other, including the attendance page in the same run.
    async function readTimetable(state, request, today, budget) {
      const cached = state.attendanceTimetable;
      const slots = cached?.slots || [];
      if (cached?.day === today && slots.length) return slots;
      if (!budget.pageFree() || now() - Number(cached?.triedAt || 0) < TIMETABLE_RETRY_MS) return slots;
      try {
        const fresh = await client.readTimetable(request);
        await storage.set({ pagesPauseStreak: 0 });
        if (fresh.length) {
          await storage.set({ attendanceTimetable: { day: today, slots: fresh, triedAt: now() } });
          return fresh;
        }
      } catch (error) {
        if (error.code === "page-limit") await pausePages(state);
        if (error.code === "portal-busy" || error.code === "busy") {
          await storage.set({ attendanceTimetable: { day: cached?.day || "", slots, triedAt: now() } });
          throw error;
        }
        // Other optional-page failures keep the cached timetable.
      }
      await storage.set({ attendanceTimetable: { day: cached?.day || "", slots, triedAt: now() } });
      return slots;
    }

    // Pending leave per subject: the absent marks on a pending application's
    // days (and, for lecture-based duty leave, at its class times). Approval
    // turns that mark into a leave mark and moves the subject's counts, so
    // this recount, run on every Refresh, shows an approval without loading
    // the leave page; only a refusal waits for the page. Marks come from the
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
        // Our own budget ran out: the last counts stand until the next Refresh.
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
    // the next Refresh (countPending).
    async function mergeLeaves(cached, which, applications) {
      const apps = { dl: cached?.apps?.dl || [], ml: cached?.apps?.ml || [], [which]: applications };
      const leaves = { ...(cached || {}), v: client.LEAVES_VERSION, apps, pending: cached?.pending || {}, [`${which}At`]: now(), checkedAt: now(), triedAt: now() };
      await storage.set({ attendanceLeaves: leaves });
      return leaves;
    }

    // Leave pages are optional inner pages: each at most every three hours,
    // only while no other inner page was loaded in PAGE_GAP_MS (so duty and
    // medical leave never share a Refresh), and never a reason to sign in.
    // Once one finds the session signed out, they wait until a CUIMS tab, Open
    // CUIMS or the attendance page shows it alive again.
    async function readLeaves(state, request, budget, onStep) {
      let leaves = currentLeaves(state);
      const signedOut = state.sessionAlive === false && Number(state.sessionCheckedAt || 0) > 0;
      for (const which of signedOut ? [] : ["dl", "ml"]) {
        const last = Math.max(Number(leaves?.[`${which}At`] || 0), Number(leaves?.[`${which}TriedAt`] || 0));
        if (now() - last < LEAVE_CHECK_MS || !budget.pageFree()) continue;
        await onStep(which === "dl" ? "Reading duty leave…" : "Reading medical leave…");
        try {
          const applications = await client.readLeavePage(request, which);
          await storage.set({ sessionAlive: true, sessionCheckedAt: now(), pagesPauseStreak: 0 });
          leaves = await mergeLeaves(leaves, which, applications);
        } catch (error) {
          if (error.code === "portal-busy" || error.code === "busy") throw error;
          // Limited, not signed out: the attendance already read stands, and
          // this page is tried again once the pause is over.
          if (error.code === "page-limit") {
            await pausePages(state);
            break;
          }
          if (error.code === "signed-out") await storage.set({ sessionAlive: false, sessionCheckedAt: now() });
          if (error.code === "signed-out" || error.code === "tab-login") break;
          leaves = { ...(leaves || {}), v: client.LEAVES_VERSION, triedAt: now(), [`${which}TriedAt`]: now() };
          await storage.set({ attendanceLeaves: leaves });
        }
      }
      return leaves;
    }

    // The student opened a leave page on CUIMS: keep what it shows, with no
    // request of our own. The next Refresh counts what is pending.
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
      return history;
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
        // refresh is GetReport and the marks calls, none of them an inner
        // page. The attendance page is reopened only when the ids are missing
        // or stop working, and that is the only read that signs in. GetReport
        // answers without a signed-in session, so only a page read says the
        // session is alive.
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
        // The page and any sign-in wait out CUIMS's page limit; nothing more
        // can be read without the report ids.
        const limit = subjects ? null : pagesPaused(state);
        if (limit) throw limit.error;
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
          await storage.set({ sessionAlive: true, sessionCheckedAt: now(), pagesPauseStreak: 0 });
          state.sessionAlive = true;
          await onStep("Reading attendance…");
          subjects = await client.readSummary(request, meta);
        }
        await storage.set({ attendanceMeta: { reportId: meta.reportId, sessionId: meta.sessionId } });
        const campus = client.campusParts(new Date(now()));
        const courses = Object.fromEntries(subjects.filter((subject) => subject.encryptCode).map((subject) => [client.normCode(subject.code), subject.encryptCode]));
        await storage.set({ attendanceCourses: courses });
        state.attendanceCourses = courses;
        // At most one optional inner page follows, and only after
        // PAGE_GAP_MS without one: the timetable when due, else a leave page.
        const slots = await readTimetable(state, request, campus.key, budget);
        const history = await readTodaysMarks(state, request, meta, subjects, slots, campus, budget);
        let leaves = await readLeaves(state, request, budget, onStep);
        leaves = await countPending(request, meta, subjects, history, leaves);
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
        if (code === "page-limit") {
          // The attendance page (or a sign-in's landing step) was limited.
          // Only pages wait; nothing else is held back.
          if (!pagesPaused(state)) await pausePages(state);
          const limit = pagesPaused(state);
          await setStatus({ working: false, phase: "", error: limit.error.message, code });
          return { snapshot: state.attendanceSnapshot, error: limit.error.message, code, nextRefreshAt: limit.until };
        }
        message = await recordBackoff(state, error);
        await setStatus({ working: false, phase: "", error: message, code });
        return { snapshot: state.attendanceSnapshot, error: message, code, nextRefreshAt: (await storage.get({ attendanceBackoffUntil: 0 })).attendanceBackoffUntil || started + MANUAL_GAP_MS };
      } finally {
        await storage.set({ ...budget.saved(), attendanceRunUntil: 0 });
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
      if (state.sessionAlive === true && now() - Number(state.sessionCheckedAt || 0) < SESSION_FRESH_MS) return { alive: true };
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
        // A sign-in ends on an inner page, so it waits out CUIMS's page limit.
        // The tab still opens and can sign itself in.
        if (pagesPaused(state)) return { alive: false, reason: "page-limit" };
        signing = true;
        await ensureSignedIn(state, request, "open", (phase) => setStatus({ working: true, phase }), signal);
        await storage.set({ sessionAlive: true, sessionCheckedAt: now() });
        return { alive: true, signedIn: true };
      } catch (error) {
        if (error.code === "page-limit") {
          await pausePages(state);
          return { alive: false, reason: "page-limit" };
        }
        const message = await recordBackoff(state, error);
        if (BACKOFF_CODES.has(error.code || "network")) await setStatus({ working: false, error: message, code: error.code || "network" });
        return { alive: false, reason: error.code || "network", error: message };
      } finally {
        await storage.set(budget.saved());
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
          await storage.set(budget.saved());
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
