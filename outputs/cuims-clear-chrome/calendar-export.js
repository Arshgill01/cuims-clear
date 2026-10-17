// Classes and exams as an .ics file for Google Calendar, Apple Calendar or
// Outlook. Built on this device from what CUIMS already showed the student;
// the file is handed to the browser's own download, never sent anywhere.
//
// Classes repeat weekly until the semester's last teaching day
// (academic-calendar.js), skipping gazetted holidays, breaks and theory test
// weeks. Exams get two reminders: the day before and an hour before.
(function (root) {
  const DAY_MS = 86_400_000;
  const IST_MIN = 330;
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  // CUIMS lists when an exam starts, not how long it runs.
  const EXAM_MINUTES = 90;

  const pad = (n) => String(n).padStart(2, "0");

  function dayNumber(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
  }

  function dayKey(number) {
    return new Date(number * DAY_MS).toISOString().slice(0, 10);
  }

  // "2026-10-19", 570 -> "20261019T093000" (campus time)
  function local(key, minutes) {
    return `${key.replace(/-/g, "")}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
  }

  // A campus day and minute in UTC, for UNTIL and DTSTAMP.
  function utc(key, minutes) {
    const at = new Date((dayNumber(key) * 1440 + minutes - IST_MIN) * 60_000);
    return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
  }

  function stamp(now) {
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  }

  function escapeText(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  // Lines over 75 octets continue on the next line after a space (RFC 5545).
  function fold(line) {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return line;
    const out = [];
    let chunk = "";
    let size = 0;
    for (const ch of line) {
      const n = new TextEncoder().encode(ch).length;
      if (size + n > (out.length ? 74 : 75)) {
        out.push(chunk);
        chunk = "";
        size = 0;
      }
      chunk += ch;
      size += n;
    }
    out.push(chunk);
    return out.join("\r\n ");
  }

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36);
  }

  const TIMEZONE = ["BEGIN:VTIMEZONE", "TZID:Asia/Kolkata", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0530", "TZOFFSETTO:+0530", "TZNAME:IST", "END:STANDARD", "END:VTIMEZONE"];

  function wrap(name, events) {
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CUIMS Clear//Calendar export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeText(name)}`,
      "X-WR-TIMEZONE:Asia/Kolkata",
      ...TIMEZONE,
      ...events.flat(),
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n";
  }

  // `classes`: [{ day: "mon", start: 570, end: 670, title, code, kind, room, teacher, group }]
  // `context`: { todayKey, calendar, exams } (exams: the date sheet, for its test weeks).
  // Returns { text, count, until } or null when there is nothing to export.
  function classesIcs(classes, context = {}, now = new Date()) {
    const A = root.CuimsAttendance || {};
    const today = dayNumber(context.todayKey) ?? Math.floor((now.getTime() + IST_MIN * 60_000) / DAY_MS);
    const last = A.lastTeachingDay?.(today, { calendar: context.calendar, exams: context.exams });
    const until = last != null && last >= today ? last : today + 16 * 7;
    const events = [];
    for (const item of classes || []) {
      // A credit CUIMS lists as a weekly class nobody attends.
      if (/\b(summer|industrial)\s+training\b|\binternship\b/i.test(item.title || "")) continue;
      const weekday = WEEKDAYS.indexOf(item.day);
      if (weekday < 0 || !(item.end > item.start)) continue;
      // The first time this class meets from today on.
      let first = today + ((weekday - new Date(today * DAY_MS).getUTCDay() + 7) % 7);
      const skipped = [];
      for (let day = first; day <= until; day += 7) {
        const reason = A.noClassReason?.(day, { calendar: context.calendar, exams: context.exams });
        if (reason && reason.kind !== "over") skipped.push(day);
      }
      while (skipped[0] === first) {
        skipped.shift();
        first += 7;
      }
      if (first > until) continue;
      const kind = { L: "Lecture", P: "Lab", T: "Tutorial" }[item.kind] || "";
      const title = item.title || item.code || "Class";
      const firstKey = dayKey(first);
      events.push([
        "BEGIN:VEVENT",
        `UID:class-${hash([item.code, item.day, item.start, item.group].join("|"))}@cuims-clear`,
        `DTSTAMP:${stamp(now)}`,
        `DTSTART;TZID=Asia/Kolkata:${local(firstKey, item.start)}`,
        `DTEND;TZID=Asia/Kolkata:${local(firstKey, item.end)}`,
        `RRULE:FREQ=WEEKLY;UNTIL=${utc(dayKey(until), 1439)}`,
        ...(skipped.length ? [`EXDATE;TZID=Asia/Kolkata:${skipped.map((day) => local(dayKey(day), item.start)).join(",")}`] : []),
        `SUMMARY:${escapeText(kind ? `${title} (${kind})` : title)}`,
        ...(item.room ? [`LOCATION:${escapeText(item.room)}`] : []),
        `DESCRIPTION:${escapeText([item.code, item.teacher, item.group ? `Group ${item.group}` : ""].filter(Boolean).join(" · "))}`,
        "CATEGORIES:Class",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      ]);
    }
    if (!events.length) return null;
    return { text: wrap("Classes · CUIMS Clear", events), count: events.length, until: dayKey(until) };
  }

  // `exams`: [{ day: "2026-10-19", start: 900 | null, name, code, type, venue, mode, link }]
  function examsIcs(exams, now = new Date()) {
    const events = [];
    for (const exam of exams || []) {
      if (dayNumber(exam.day) == null) continue;
      const timed = Number.isFinite(exam.start);
      const name = exam.name || exam.code || "Exam";
      const where = exam.link ? "Online" : exam.venue || "";
      const lines = [
        "BEGIN:VEVENT",
        `UID:exam-${hash([exam.code, exam.day, exam.type].join("|"))}@cuims-clear`,
        `DTSTAMP:${stamp(now)}`,
        ...(timed
          ? [`DTSTART;TZID=Asia/Kolkata:${local(exam.day, exam.start)}`, `DTEND;TZID=Asia/Kolkata:${local(exam.day, exam.start + EXAM_MINUTES)}`]
          : [`DTSTART;VALUE=DATE:${exam.day.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${dayKey(dayNumber(exam.day) + 1).replace(/-/g, "")}`]),
        `SUMMARY:${escapeText(`${exam.type ? `${exam.type}: ` : ""}${name}`)}`,
        ...(where ? [`LOCATION:${escapeText(where)}`] : []),
        `DESCRIPTION:${escapeText([exam.code, exam.mode, exam.link ? `Exam link: ${exam.link}` : "", timed ? "End time is a guess: CUIMS lists only the start." : ""].filter(Boolean).join("\n"))}`,
        ...(exam.link ? [`URL:${exam.link}`] : []),
        "CATEGORIES:Exam",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(`Tomorrow: ${name}`)}`,
        "TRIGGER:-P1D",
        "END:VALARM",
        ...(timed ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(`In an hour: ${name}`)}`, "TRIGGER:-PT1H", "END:VALARM"] : []),
        "END:VEVENT",
      ];
      events.push(lines);
    }
    if (!events.length) return null;
    return { text: wrap("Exams · CUIMS Clear", events), count: events.length };
  }

  // Hands the file to the browser's download. Works from a page, a content
  // script and the popup.
  function download(text, filename) {
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    (document.body || document.documentElement).append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  root.CuimsCalendarExport = { classesIcs, examsIcs, download, fold, escapeText, EXAM_MINUTES };
})(globalThis);
