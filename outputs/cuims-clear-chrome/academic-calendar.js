// CU's published academic calendar: which days have no classes (gazetted
// holidays, in-semester test weeks, breaks) and each semester's last teaching
// day. The Attendance and Forecast tabs count classes only on teaching days.
//
// Copied from cuchd.in/academics (academic-calendar.php, academic-calendar-
// odd.php, academic-calendar-uic.php, list-of-holidays.php), read 13 Oct 2026.
// A new academic year needs a new entry here. Days past the last semester
// listed fall back to the timetable alone.
//
// The student's own CUIMS date sheet beats the calendar for test weeks: a
// week with one of their MST papers in it is a test week, whichever calendar
// their institute follows.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const DAY_MS = 86_400_000;

  // Gazetted holidays (list-of-holidays.php). 2027's list is not out yet.
  const HOLIDAYS = {
    "2026-01-26": "Republic Day",
    "2026-03-04": "Holi",
    "2026-03-21": "Eid-ul-Fitr",
    "2026-04-14": "Ambedkar Jayanti",
    "2026-08-15": "Independence Day",
    "2026-09-04": "Janmashtami",
    "2026-10-02": "Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-10-26": "Valmiki Jayanti",
    "2026-11-08": "Diwali",
    "2026-11-24": "Gurupurab",
    "2026-12-25": "Christmas",
  };

  // Practical IST and VAC weeks are left out on purpose: classes ran through
  // both in 2026 (seen in students' marks). Theory IST weeks had none.
  const ODD_2026 = {
    id: "2026-odd",
    starts: "2026-07-08",
    lastDay: "2026-11-13",
    tests: [
      { from: "2026-08-24", to: "2026-08-29", label: "IST-1", n: 1 },
      { from: "2026-10-12", to: "2026-10-17", label: "IST-2", n: 2 },
    ],
    breaks: [{ from: "2026-11-09", to: "2026-11-11", label: "Diwali break" }],
  };
  const EVEN_2027 = {
    id: "2027-even",
    starts: "2027-01-04",
    lastDay: "2027-04-23",
    tests: [
      { from: "2027-02-08", to: "2027-02-13", label: "IST-1", n: 1 },
      { from: "2027-03-22", to: "2027-03-27", label: "IST-2", n: 2 },
    ],
    breaks: [],
  };

  // "Start of Academic Session [AY 2027-28]": where these semesters stop.
  const NEXT_YEAR_STARTS = "2027-07-14";

  const CALENDARS = {
    // Every program except UIC's and UID's own dates.
    cu: { label: "Most programs", semesters: [ODD_2026, EVEN_2027] },
    // University Institute of Design: same weeks, a week more of teaching.
    uid: {
      label: "UID (design)",
      semesters: [
        { ...ODD_2026, lastDay: "2026-11-20" },
        { ...EVEN_2027, lastDay: "2027-04-30" },
      ],
    },
    // University Institute of Computing runs its own calendar.
    uic: {
      label: "UIC (computing)",
      semesters: [
        {
          ...ODD_2026,
          starts: "2026-07-14",
          tests: [
            { from: "2026-08-31", to: "2026-09-05", label: "IST-1", n: 1 },
            { from: "2026-10-22", to: "2026-10-28", label: "IST-2", n: 2 },
          ],
        },
        {
          ...EVEN_2027,
          tests: [
            { from: "2027-02-15", to: "2027-02-20", label: "IST-1", n: 1 },
            { from: "2027-04-05", to: "2027-04-10", label: "IST-2", n: 2 },
          ],
        },
      ],
    },
  };

  function dayNumber(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
  }

  function dayKey(number) {
    return new Date(number * DAY_MS).toISOString().slice(0, 10);
  }

  // UIC's programs (BCA, MCA) carry their own code in the UID: 24BCA…, 25MCA….
  function calendarFor(choice, uid) {
    if (CALENDARS[choice]) return choice;
    return /^\d{2}(BCA|MCA)/i.test(String(uid || "").trim()) ? "uic" : "cu";
  }

  // The week (Monday to Saturday) around a day.
  function weekOf(number) {
    const weekday = new Date(number * DAY_MS).getUTCDay();
    const monday = number - ((weekday + 6) % 7);
    return { from: monday, to: monday + 5 };
  }

  // Test weeks from the student's date sheet: every week holding one of
  // their MST-n papers, labelled IST-n. Null when the sheet has none.
  function sheetTests(exams) {
    const weeks = new Map();
    for (const exam of exams || []) {
      const n = Number(String(exam?.type || "").match(/^MST-?(\d)/i)?.[1] || 0);
      const day = dayNumber(exam?.day);
      if (!n || day == null) continue;
      const week = weekOf(day);
      weeks.set(week.from, { from: week.from, to: week.to, label: `IST-${n}`, n });
    }
    return weeks.size ? [...weeks.values()] : null;
  }

  // The semester a day belongs to: the one it falls in (start to the day
  // before the next one starts). Null before the first and after the last.
  function semesterOf(calendar, number) {
    const list = CALENDARS[calendar]?.semesters || [];
    for (let i = 0; i < list.length; i += 1) {
      const starts = dayNumber(list[i].starts);
      const next = dayNumber(list[i + 1] ? list[i + 1].starts : NEXT_YEAR_STARTS);
      if (number >= starts && number < next) return list[i];
    }
    return null;
  }

  // Why a day has no classes, or null when it is a teaching day (as far as
  // the calendar knows; the timetable still decides which classes run).
  // `context`: { calendar: "cu" | "uic" | "uid", exams: date sheet rows }.
  function noClassReason(key, context = {}) {
    const number = typeof key === "number" ? key : dayNumber(key);
    if (number == null) return null;
    const text = dayKey(number);
    if (HOLIDAYS[text]) return { kind: "holiday", label: HOLIDAYS[text] };
    const semester = semesterOf(calendarFor(context.calendar), number);
    if (!semester) return null;
    if (number > dayNumber(semester.lastDay)) return { kind: "over", label: "Classes are over for the semester" };
    for (const item of semester.breaks) {
      if (number >= dayNumber(item.from) && number <= dayNumber(item.to)) return { kind: "break", label: item.label };
    }
    const fromSheet = (sheetTests(context.exams) || []).filter((week) => week.from >= dayNumber(semester.starts));
    const sheetNumbers = new Set(fromSheet.map((week) => week.n));
    const tests = [
      ...fromSheet,
      // The calendar's weeks stand for any test the date sheet has not shown yet.
      ...semester.tests.filter((week) => !sheetNumbers.has(week.n)).map((week) => ({ ...week, from: dayNumber(week.from), to: dayNumber(week.to) })),
    ];
    for (const week of tests) {
      if (number >= week.from && number <= week.to) return { kind: "tests", label: `${week.label} (mid-semester tests)` };
    }
    return null;
  }

  // The last teaching day of the semester a day falls in, as a day number,
  // or null when the calendar does not cover it.
  function lastTeachingDay(key, context = {}) {
    const number = typeof key === "number" ? key : dayNumber(key);
    const semester = number == null ? null : semesterOf(calendarFor(context.calendar), number);
    return semester ? dayNumber(semester.lastDay) : null;
  }

  // When the semester a day falls in started, as a day number.
  function semesterStart(key, context = {}) {
    const number = typeof key === "number" ? key : dayNumber(key);
    const semester = number == null ? null : semesterOf(calendarFor(context.calendar), number);
    return semester ? dayNumber(semester.starts) : null;
  }

  // The calendar's test weeks in the semester a day falls in, as day numbers.
  function testWeeks(key, context = {}) {
    const number = typeof key === "number" ? key : dayNumber(key);
    const semester = number == null ? null : semesterOf(calendarFor(context.calendar), number);
    return (semester?.tests || []).map((week) => ({ ...week, from: dayNumber(week.from), to: dayNumber(week.to) }));
  }

  api.testWeeks = testWeeks;
  api.dayNumberOf = dayNumber;
  api.ACADEMIC_CALENDARS = Object.fromEntries(Object.entries(CALENDARS).map(([id, value]) => [id, value.label]));
  api.HOLIDAYS = HOLIDAYS;
  api.calendarFor = calendarFor;
  api.noClassReason = noClassReason;
  api.lastTeachingDay = lastTeachingDay;
  api.semesterStart = semesterStart;
})(globalThis);
