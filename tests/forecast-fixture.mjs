// A synthetic semester for the Forecast tab: seven subjects on a Mon–Sat
// timetable, marks from 20 Jul 2026 with each subject's own attendance habit.
// Deterministic, so tests and screenshots see the same student.

const SUBJECTS = [
  { code: "24CST-301", short: "24CST-301", title: "Operating Systems", rate: 0.86, slots: [["mon", 9 * 60 + 40], ["wed", 11 * 60 + 20], ["fri", 9 * 60 + 40], ["thu", 13 * 60]] },
  { code: "24CST-302", short: "24CST-302", title: "Computer Networks", rate: 0.93, slots: [["mon", 11 * 60 + 20], ["tue", 9 * 60 + 40], ["thu", 10 * 60 + 30]] },
  { code: "24CSP-305", short: "24CSP-305", title: "Competitive Coding-II", rate: 0.9, kind: "P", slots: [["tue", 13 * 60], ["tue", 13 * 60 + 50], ["fri", 14 * 60 + 40]] },
  { code: "24CST-304", short: "24CST-304", title: "Design and Analysis of Algorithms", rate: 0.95, slots: [["mon", 13 * 60], ["wed", 9 * 60 + 40], ["sat", 10 * 60 + 30]] },
  { code: "24TDT-312", short: "24TDT-312", title: "Aptitude-III", rate: 0.97, slots: [["wed", 14 * 60 + 40], ["sat", 9 * 60 + 40]] },
  { code: "24CSH-306", short: "24CSH-306", title: "Software Engineering", rate: 0.94, slots: [["tue", 11 * 60 + 20], ["thu", 9 * 60 + 40], ["fri", 11 * 60 + 20]] },
  { code: "24UCT-310", short: "24UCT-310", title: "Universal Human Values", rate: 0.84, slots: [["thu", 14 * 60 + 40], ["sat", 11 * 60 + 20]] },
];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// A tiny seeded generator, so every run is the same semester.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const pad = (value) => String(value).padStart(2, "0");
const keyOf = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const clock = (minutes) => `${pad(Math.floor(minutes / 60) % 12 || 12)}:${pad(minutes % 60)}`;

// `until` is the last day with marks (a campus date key); `rates` overrides habits.
export function semester({ until = "2026-10-08", rates = {}, seed = 7, mondaySlump = 0.3 } = {}) {
  const next = random(seed);
  const end = new Date(`${until}T00:00:00Z`);
  const subjects = [];
  const history = { v: 1, subjects: {} };
  const slots = [];
  for (const subject of SUBJECTS) {
    for (const [weekday, start] of subject.slots) slots.push({ weekday, start, end: start + 50, shortCode: subject.short, title: subject.title, kind: subject.kind || "L" });
    const rate = rates[subject.code] ?? subject.rate;
    const marks = [];
    let attended = 0;
    let delivered = 0;
    for (const cursor = new Date("2026-07-20T00:00:00Z"); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const weekday = WEEKDAYS[cursor.getUTCDay()];
      for (const [day, start] of subject.slots) {
        if (day !== weekday) continue;
        // Mondays' first periods are this student's weak spot.
        const slump = weekday === "mon" && start < 10 * 60 ? mondaySlump : 0;
        const present = next() < rate - slump;
        marks.push([keyOf(cursor), start, present ? "p" : "a"]);
        delivered += 1;
        if (present) attended += 1;
      }
    }
    subjects.push({ code: subject.code, title: subject.title, attended, delivered, leave: { vdl: 0, idl: 0, adl: 0, ml: 0 } });
    history.subjects[subject.code.toUpperCase().replace(/[^A-Z0-9]/g, "")] = { attended, delivered, at: 0, marks };
  }
  const snapshot = { fetchedAt: `${until}T05:00:00.000Z`, marksDay: until, slots, subjects, leaves: null };
  return { snapshot, history };
}

// Campus time on a date key: hours and minutes in IST.
export function campusTime(key, hours, minutes = 0) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hours - 5, minutes - 30));
}
