// Attendance totals, 75% subject room, and 90% overall room.
// Pure data in, view model out. "Today" follows the Mohali campus clock.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const SUBJECT_MIN = 0.75;
  const OVERALL_MIN = 0.9;
  const CAMPUS_TZ = "Asia/Kolkata";

  function maxMisses(attended, delivered, ratio) {
    const present = Number(attended);
    const held = Number(delivered);
    if (!(present >= 0) || !(held >= 0) || !(ratio > 0) || ratio >= 1) return 0;
    let skips = Math.floor(present / ratio - held + 1e-8);
    if (skips < 0) skips = 0;
    while (skips > 0 && present / (held + skips) + 1e-10 < ratio) skips -= 1;
    return skips;
  }

  function classesToRecover(attended, delivered, ratio) {
    const present = Number(attended);
    const held = Number(delivered);
    if (!(held > 0) || !(ratio > 0) || ratio >= 1) return 0;
    if (present / held + 1e-12 >= ratio) return 0;
    let need = Math.ceil((ratio * held - present) / (1 - ratio) - 1e-8);
    if (need < 1) need = 1;
    while ((present + need) / (held + need) + 1e-12 < ratio) need += 1;
    return need;
  }

  function percentOf(attended, delivered) {
    return delivered > 0 ? (attended / delivered) * 100 : null;
  }

  function formatPercent(value) {
    return value == null ? "—" : `${(Math.round(value * 10) / 10).toFixed(1)}%`;
  }

  function campusParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CAMPUS_TZ,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value || "";
    const hour = Number(pick("hour")) % 24;
    return {
      weekday: pick("weekday").slice(0, 3).toLowerCase(),
      key: `${pick("year")}-${pick("month")}-${pick("day")}`,
      minutes: hour * 60 + Number(pick("minute") || 0),
    };
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function parseDateKey(value) {
    const text = String(value || "").trim();
    let match = text.match(/\/Date\((\d+)/);
    if (match) return campusParts(new Date(Number(match[1]))).key;
    match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (match) {
      let day = Number(match[1]);
      let month = Number(match[2]);
      if (month > 12 && day <= 12) [day, month] = [month, day];
      return `${match[3]}-${pad(month)}-${pad(day)}`;
    }
    // "Tuesday, 29 Sep 2026" and "29 Sep 2026" both appear.
    match = text.replace(/^[A-Za-z]+,\s*/, "").match(/^(\d{1,2})[\s/-]+([A-Za-z]{3,})[\s/,-]+(\d{4})/);
    if (!match) return null;
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    return month ? `${match[3]}-${pad(month)}-${pad(match[1])}` : null;
  }

  function parseClock(token) {
    const match = String(token || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const suffix = (match[3] || "").toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  // "09:40 - 10:20 AM", "1:00 - 1:40 PM", "9:30 AM to 10:20 AM".
  function parseRange(value) {
    const text = String(value || "").trim();
    const match = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (!match) return null;
    let start = parseClock(match[1]);
    let end = parseClock(match[2]);
    if (start == null || end == null) return null;
    const endIsPm = /pm/i.test(match[2]);
    if (!/am|pm/i.test(match[1]) && endIsPm && start < 12 * 60 && start + 12 * 60 <= end) start += 12 * 60;
    // College hours: an unsuffixed 1:00–5:59 start is afternoon.
    if (!/am|pm/i.test(match[1]) && !/am|pm/i.test(match[2]) && start < 8 * 60) {
      start += 12 * 60;
      end += 12 * 60;
    }
    if (end < start) end += 12 * 60;
    return { start, end };
  }

  function formatClock(minutes) {
    const hour24 = Math.floor(minutes / 60) % 24;
    const hour = hour24 % 12 || 12;
    return `${hour}:${pad(minutes % 60)}`;
  }

  function normCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function normText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function slotBelongsTo(slot, subject) {
    const left = normCode(subject.code);
    const right = normCode(slot.shortCode);
    if (left && right && (left === right || left.endsWith(right) || right.endsWith(left))) return true;
    const a = normText(subject.title);
    const b = normText(slot.title);
    return Boolean(a && b && (a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a)))));
  }

  function todaysSlots(slots, campus) {
    return (slots || [])
      .filter((slot) => slot.weekday === campus.weekday)
      .sort((left, right) => left.start - right.start);
  }

  // Pair today's posted marks with today's slots by start time.
  function pairMarks(slots, marks, todayKey) {
    const todays = (marks || []).filter((mark) => parseDateKey(mark.date) === todayKey);
    const used = new Set();
    const paired = slots.map((slot) => {
      let best = -1;
      let bestDistance = 50;
      todays.forEach((mark, index) => {
        if (used.has(index)) return;
        const range = parseRange(mark.time);
        if (!range) return;
        const distance = Math.abs(range.start - slot.start);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      if (best >= 0) used.add(best);
      return { slot, mark: best >= 0 ? todays[best] : null };
    });
    todays.forEach((mark, index) => {
      if (used.has(index)) return;
      const open = paired.find((item) => !item.mark);
      if (open) open.mark = mark;
    });
    return paired;
  }

  function classState(slot, mark, minutes) {
    if (mark) return mark.present ? "present" : mark.kind === "dl" || mark.kind === "ml" ? "leave" : "absent";
    if (minutes < slot.start) return "next";
    if (minutes <= slot.end) return "now";
    return "pending";
  }

  // The two attendance rules students live by. `overall` is null when only
  // the per-subject rule applies.
  // Voluntary duty leave allowance, per subject, per semester.
  const VDL_PER_SUBJECT = 10;
  // Bumped when the way pending leave is counted changes.
  const LEAVES_VERSION = 2;

  const GOALS = {
    standard: { id: "standard", subject: SUBJECT_MIN, overall: OVERALL_MIN, label: "75% each + 90% overall" },
    strict: { id: "strict", subject: 0.9, overall: null, label: "90% every subject" },
  };

  function goalOf(id) {
    return GOALS[id] || GOALS.standard;
  }

  function pct(ratio) {
    return Math.round(ratio * 100);
  }

  function subjectTone(percent, goal) {
    if (percent == null) return "none";
    const floor = goal.subject * 100;
    if (percent < floor) return "low";
    if (percent < floor + (goal.overall ? 5 : 3)) return "tight";
    if (percent >= Math.max(90, floor + 3)) return "high";
    return "ok";
  }

  function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : noun.endsWith("s") ? "es" : "s"}`;
  }

  function subjectLine(row, overall, goal) {
    if (!(row.delivered + row.pending > 0)) return "No classes yet";
    if (row.recover > 0) return `Attend next ${row.recover} to reach ${pct(goal.subject)}%`;
    if (row.skip > 0) return `Can skip ${row.skip}`;
    if (row.limitedByOverall) return overall.recover > 0 ? `No skips (overall under ${pct(goal.overall)}%)` : `No skips (overall at ${pct(goal.overall)}%)`;
    return "No skips left";
  }

  function overallLine(overall, goal, rows) {
    if (!(overall.effectiveDelivered > 0)) return "No classes yet";
    if (!goal.overall) {
      const below = rows.filter((row) => row.recover > 0).length;
      return below ? `${plural(below, "subject")} under ${pct(goal.subject)}%` : `Every subject at ${pct(goal.subject)}% or more`;
    }
    if (overall.recover > 0) return `Attend next ${plural(overall.recover, "class")} to reach ${pct(goal.overall)}%`;
    if (overall.skip === 0) return "No room to miss a class";
    return `${plural(overall.skip, "miss")} left, shared across subjects`;
  }

  // Leave that is applied for but not decided counts as absent today. If it
  // is approved, those classes leave both counts.
  function withLeave(attended, delivered, pendingLeave) {
    return pendingLeave > 0 && delivered - pendingLeave > 0 ? percentOf(attended, delivered - pendingLeave) : null;
  }

  function slotKey(code, start) {
    return `${normCode(code)}@${start}`;
  }

  // Skips assume every other class is attended. A class that ended without a
  // posted mark counts as missed, so a late mark can only raise the number.
  function buildAnalytics(snapshot, now = new Date(), options = {}) {
    const goal = goalOf(options.goal);
    const campus = campusParts(now);
    const subjects = Array.isArray(snapshot?.subjects) ? snapshot.subjects : [];
    const slots = todaysSlots(snapshot?.slots, campus);
    const marksDay = snapshot?.marksDay || "";
    // Leave counted by an older parser (which read "Not Recommend" as
    // pending) is ignored until the leave pages are read again.
    const leaves = snapshot?.leaves?.v === api.LEAVES_VERSION ? snapshot.leaves : null;
    const pendingLeave = leaves?.pending || {};

    const rows = subjects.map((subject) => {
      const mine = slots.filter((slot) => slotBelongsTo(slot, subject));
      const marks = marksDay === campus.key ? subject.marks : null;
      const today = pairMarks(mine, marks, campus.key).map(({ slot, mark }) => ({
        start: slot.start,
        end: slot.end,
        kind: slot.kind || "L",
        time: formatClock(slot.start),
        state: classState(slot, mark, campus.minutes),
      }));
      const attended = Number(subject.attended) || 0;
      const delivered = Number(subject.delivered) || 0;
      const waiting = pendingLeave[normCode(subject.code)] || {};
      // Older stored counts had one "dl" figure; it was all voluntary.
      const pendingVdl = (waiting.vdl || 0) + (waiting.dl || 0);
      const approvedVdl = subject.leave?.vdl || 0;
      const leave = {
        approved: { vdl: approvedVdl, idl: subject.leave?.idl || 0, adl: subject.leave?.adl || 0, ml: subject.leave?.ml || 0 },
        pending: { dl: pendingVdl + (waiting.idl || 0) + (waiting.adl || 0), vdl: pendingVdl, ml: waiting.ml || 0 },
        // Only the VDL column CUIMS reports counts against the allowance.
        vdlLeft: Math.max(0, VDL_PER_SUBJECT - approvedVdl),
      };
      return {
        code: subject.code || "",
        title: subject.title || "Subject",
        attended,
        delivered,
        pending: today.filter((item) => item.state === "pending").length,
        percent: percentOf(attended, delivered),
        leave,
        ifApproved: withLeave(attended, delivered, leave.pending.dl + leave.pending.ml),
        today,
      };
    });

    const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
    const attended = sum((row) => row.attended);
    const delivered = sum((row) => row.delivered);
    const pending = sum((row) => row.pending);
    const pendingLeaveTotal = { dl: sum((row) => row.leave.pending.dl), ml: sum((row) => row.leave.pending.ml) };
    const overall = {
      attended,
      delivered,
      effectiveDelivered: delivered + pending,
      percent: percentOf(attended, delivered),
      skip: goal.overall ? maxMisses(attended, delivered + pending, goal.overall) : 0,
      recover: goal.overall ? classesToRecover(attended, delivered + pending, goal.overall) : 0,
      left: sum((row) => row.today.filter((item) => item.state === "next" || item.state === "now").length),
      leave: {
        pending: pendingLeaveTotal,
        approved: { vdl: sum((row) => row.leave.approved.vdl), ml: sum((row) => row.leave.approved.ml), other: sum((row) => row.leave.approved.idl + row.leave.approved.adl) },
      },
      ifApproved: withLeave(attended, delivered, pendingLeaveTotal.dl + pendingLeaveTotal.ml),
    };
    const overallFloor = (goal.overall || goal.subject) * 100;
    overall.tone = overall.percent == null ? "none" : overall.percent < overallFloor ? "low" : overall.percent < overallFloor + 2 ? "tight" : "high";

    for (const row of rows) {
      const held = row.delivered + row.pending;
      const subjectSkip = maxMisses(row.attended, held, goal.subject);
      row.recover = classesToRecover(row.attended, held, goal.subject);
      const overallRoom = !goal.overall ? Infinity : overall.recover > 0 ? 0 : overall.skip;
      row.skip = row.recover > 0 ? 0 : Math.min(subjectSkip, overallRoom);
      row.limitedByOverall = Boolean(goal.overall) && row.recover === 0 && row.skip < subjectSkip;
      row.tone = subjectTone(row.percent, goal);
      row.line = subjectLine(row, overall, goal);
    }
    overall.line = overallLine(overall, goal, rows);
    rows.sort((left, right) => (left.percent ?? 101) - (right.percent ?? 101) || left.title.localeCompare(right.title));

    return {
      fetchedAt: snapshot?.fetchedAt || null,
      todayKey: campus.key,
      goal,
      timetableKnown: Array.isArray(snapshot?.slots) && snapshot.slots.length > 0,
      leavesCheckedAt: leaves?.checkedAt || null,
      overall,
      subjects: rows,
    };
  }

  api.SUBJECT_MIN = SUBJECT_MIN;
  api.OVERALL_MIN = OVERALL_MIN;
  api.maxMisses = maxMisses;
  api.classesToRecover = classesToRecover;
  api.formatPercent = formatPercent;
  api.formatClock = formatClock;
  api.campusParts = campusParts;
  api.parseDateKey = parseDateKey;
  api.parseRange = parseRange;
  api.todaysSlots = todaysSlots;
  api.slotBelongsTo = slotBelongsTo;
  api.buildAnalytics = buildAnalytics;
  api.GOALS = GOALS;
  api.VDL_PER_SUBJECT = VDL_PER_SUBJECT;
  api.LEAVES_VERSION = LEAVES_VERSION;
  api.slotKey = slotKey;
  api.normCode = normCode;
})(globalThis);
