// Attendance totals, 75% subject room, and 90% overall room.
// Pure data in, view model out. "Today" follows the Mohali campus clock.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const SUBJECT_MIN = 0.75;
  const OVERALL_MIN = 0.9;
  const CAMPUS_TZ = "Asia/Kolkata";
  const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

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
    match = text.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3,})[\s/,-]+(\d{4})/);
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
    if (mark) return mark.present ? "present" : "absent";
    if (minutes < slot.start) return "next";
    if (minutes <= slot.end) return "now";
    return "pending";
  }

  function subjectTone(percent) {
    if (percent == null) return "none";
    if (percent < 75) return "low";
    if (percent < 80) return "tight";
    if (percent >= 90) return "high";
    return "ok";
  }

  function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "es"}`;
  }

  function subjectLine(row) {
    if (!(row.delivered + row.pending > 0)) return "No classes yet";
    if (row.recover > 0) return `Attend next ${row.recover} to reach 75%`;
    if (row.skip === 0) return row.cappedByOverall ? "No skips · overall at 90%" : "No skips left";
    return `Can skip ${row.skip}${row.cappedByOverall ? " · overall cap" : ""}`;
  }

  function overallLine(overall) {
    if (!(overall.effectiveDelivered > 0)) return "No classes yet";
    if (overall.recover > 0) return `Attend next ${plural(overall.recover, "class")} to reach 90%`;
    if (overall.skip === 0) return "No room to miss a class";
    return `Room to miss ${plural(overall.skip, "class")}`;
  }

  // Skips assume every other class is attended. A class that ended without a
  // posted mark counts as missed, so a late mark can only raise the number.
  function buildAnalytics(snapshot, now = new Date()) {
    const campus = campusParts(now);
    const subjects = Array.isArray(snapshot?.subjects) ? snapshot.subjects : [];
    const slots = todaysSlots(snapshot?.slots, campus);
    const marksDay = snapshot?.marksDay || "";

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
      return {
        code: subject.code || "",
        title: subject.title || "Subject",
        attended,
        delivered,
        pending: today.filter((item) => item.state === "pending").length,
        percent: percentOf(attended, delivered),
        today,
      };
    });

    const attended = rows.reduce((sum, row) => sum + row.attended, 0);
    const delivered = rows.reduce((sum, row) => sum + row.delivered, 0);
    const pending = rows.reduce((sum, row) => sum + row.pending, 0);
    const overall = {
      attended,
      delivered,
      effectiveDelivered: delivered + pending,
      percent: percentOf(attended, delivered),
      skip: maxMisses(attended, delivered + pending, OVERALL_MIN),
      recover: classesToRecover(attended, delivered + pending, OVERALL_MIN),
      left: rows.reduce((sum, row) => sum + row.today.filter((item) => item.state === "next" || item.state === "now").length, 0),
    };
    overall.tone = overall.percent == null ? "none" : overall.percent < 90 ? "low" : overall.percent < 92 ? "tight" : "high";
    overall.line = overallLine(overall);

    for (const row of rows) {
      const held = row.delivered + row.pending;
      const subjectSkip = maxMisses(row.attended, held, SUBJECT_MIN);
      row.recover = classesToRecover(row.attended, held, SUBJECT_MIN);
      const overallRoom = overall.recover > 0 ? 0 : overall.skip;
      row.skip = row.recover > 0 ? 0 : Math.min(subjectSkip, overallRoom);
      row.cappedByOverall = row.recover === 0 && row.skip < subjectSkip;
      row.tone = subjectTone(row.percent);
      row.line = subjectLine(row);
      row.mustAttendToday = row.skip === 0;
    }
    rows.sort((left, right) => (left.percent ?? 101) - (right.percent ?? 101) || left.title.localeCompare(right.title));

    return {
      fetchedAt: snapshot?.fetchedAt || null,
      todayKey: campus.key,
      timetableKnown: Array.isArray(snapshot?.slots) && snapshot.slots.length > 0,
      overall,
      subjects: rows,
    };
  }

  // Weekday class hours from the timetable, padded by half an hour each side.
  // Without a timetable, a plain 8:30–17:30 weekday window.
  function campusWindow(allSlots, now = new Date()) {
    const campus = campusParts(now);
    const closed = { open: false, campus, start: 0, end: 0 };
    if (!WEEKDAYS.includes(campus.weekday)) return closed;
    let start = 8 * 60 + 30;
    let end = 17 * 60 + 30;
    if (Array.isArray(allSlots) && allSlots.length) {
      const today = todaysSlots(allSlots, campus);
      if (!today.length) return closed;
      start = Math.min(...today.map((slot) => slot.start)) - 30;
      end = Math.max(...today.map((slot) => slot.end)) + 30;
    }
    return { open: campus.minutes >= start && campus.minutes <= end, campus, start, end };
  }

  // A class that ended at least `settleMinutes` ago, after the last fetch, is
  // the moment worth one scheduled refresh.
  function classEndedSince(allSlots, fetchedAt, now = new Date(), settleMinutes = 10) {
    const campus = campusParts(now);
    const fetched = fetchedAt ? campusParts(new Date(fetchedAt)) : null;
    const fetchedMinutes = fetched && fetched.key === campus.key ? fetched.minutes : -1;
    return todaysSlots(allSlots, campus).some((slot) => {
      const settled = slot.end + settleMinutes;
      return settled <= campus.minutes && settled > fetchedMinutes;
    });
  }

  api.SUBJECT_MIN = SUBJECT_MIN;
  api.OVERALL_MIN = OVERALL_MIN;
  api.maxMisses = maxMisses;
  api.classesToRecover = classesToRecover;
  api.formatPercent = formatPercent;
  api.campusParts = campusParts;
  api.parseDateKey = parseDateKey;
  api.parseRange = parseRange;
  api.todaysSlots = todaysSlots;
  api.slotBelongsTo = slotBelongsTo;
  api.buildAnalytics = buildAnalytics;
  api.campusWindow = campusWindow;
  api.classEndedSince = classEndedSince;
})(globalThis);
