import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { semester } from "./forecast-fixture.mjs";

const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

function load(names) {
  const context = vm.createContext({ console, Date, Math, JSON, Promise, Intl, Number, String, Array, Object, Set, Map, TextEncoder, setTimeout });
  context.globalThis = context;
  for (const name of names) vm.runInContext(read(name), context, { filename: name });
  return context;
}

const unfold = (text) => text.replace(/\r\n /g, "");

test("classes repeat weekly to the last teaching day, skipping holidays and breaks", () => {
  const { CuimsCalendarExport: X } = load(["attendance-model.js", "academic-calendar.js", "calendar-export.js"]);
  const result = X.classesIcs(
    [{ day: "mon", start: 570, end: 670, title: "Soft Skills-III", code: "24TDP-311", kind: "P", room: "C1-208-A", teacher: "S Kaur" }],
    { todayKey: "2026-10-17", calendar: "cu", exams: [] },
    new Date("2026-10-17T10:00:00Z"),
  );
  const text = unfold(result.text);
  assert.equal(result.count, 1);
  assert.equal(result.until, "2026-11-13");
  assert.match(text, /DTSTART;TZID=Asia\/Kolkata:20261019T093000/);
  assert.match(text, /DTEND;TZID=Asia\/Kolkata:20261019T111000/);
  // 13 Nov, 23:59 in Chandigarh is 18:29 UTC.
  assert.match(text, /RRULE:FREQ=WEEKLY;UNTIL=20261113T182900Z/);
  // Valmiki Jayanti (26 Oct) and the Diwali break (9 Nov) are left out.
  assert.match(text, /EXDATE;TZID=Asia\/Kolkata:20261026T093000,20261109T093000/);
  assert.match(text, /SUMMARY:Soft Skills-III \(Lab\)/);
  assert.match(text, /LOCATION:C1-208-A/);
  assert.ok(result.text.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75), "lines fold at 75 octets");
});

test("a class whose first day is a holiday starts the week after", () => {
  const { CuimsCalendarExport: X } = load(["attendance-model.js", "academic-calendar.js", "calendar-export.js"]);
  // Tue 20 Oct is Dussehra.
  const text = unfold(X.classesIcs([{ day: "tue", start: 600, end: 650, code: "24CST-302", kind: "L" }], { todayKey: "2026-10-19", calendar: "cu" }).text);
  assert.match(text, /DTSTART;TZID=Asia\/Kolkata:20261027T100000/);
  // The Diwali break still takes 10 Nov.
  assert.match(text, /EXDATE;TZID=Asia\/Kolkata:20261110T100000\r\n/);
});

test("exams get a time, a guessed end, two reminders and their link; text is escaped", () => {
  const { CuimsCalendarExport: X } = load(["calendar-export.js"]);
  const result = X.examsIcs([
    { day: "2026-10-19", start: 900, name: "Probability, Statistics; and more", code: "24SMT-341", type: "MST-2", venue: "B1", mode: "Offline" },
    { day: "2026-10-13", start: null, name: "Aptitude-III", type: "MST-2", link: "https://example.test/exam" },
  ]);
  const text = unfold(result.text);
  assert.equal(result.count, 2);
  assert.match(text, /DTSTART;TZID=Asia\/Kolkata:20261019T150000\r\nDTEND;TZID=Asia\/Kolkata:20261019T163000/);
  assert.match(text, /SUMMARY:MST-2: Probability\\, Statistics\\; and more/);
  assert.equal((text.match(/BEGIN:VALARM/g) || []).length, 3, "two for a timed exam, the day before for an untimed one");
  assert.match(text, /DTSTART;VALUE=DATE:20261013\r\nDTEND;VALUE=DATE:20261014/);
  assert.match(text, /URL:https:\/\/example.test\/exam/);
  assert.equal(X.examsIcs([]), null);
});

test("Wrapped counts every posted class and finds the day, the subject and the low point", () => {
  const { CuimsWrapped: W } = load(["attendance-model.js", "ledger.js", "wrapped.js"]);
  const { snapshot, history } = semester({ until: "2026-10-16" });
  const s = W.stats({ snapshot, history, ledger: { captchas: 3 }, best: 12 });
  const marks = Object.values(history.subjects).flatMap((subject) => subject.marks).filter(([, , kind]) => kind === "p" || kind === "a");
  assert.equal(s.delivered, marks.length);
  assert.equal(s.attended, marks.filter(([, , kind]) => kind === "p").length);
  assert.ok(Math.abs(s.percent - (s.attended / s.delivered) * 100) < 1e-9);
  assert.match(s.bestDay.name, /day$/);
  assert.ok(s.topSubject.rate >= Math.max(...s.subjects.filter((row) => row.n >= 10).map((row) => row.rate)) - 1e-9);
  assert.notEqual(s.comeback?.code, s.topSubject.code, "the comeback is another subject");
  assert.ok(s.lowest.value <= s.percent + 1e-9);
  assert.ok(s.streak > 1 && s.hours > 0);
  assert.equal(s.ledger.captchas, 3);
  assert.equal(W.stats({ snapshot, history: { subjects: {} } }), null, "too little to tell");
});

test("the heatmap has a square per class day, Monday to Saturday, and counts days without a miss", () => {
  const { CuimsClub: C } = load(["attendance-model.js", "academic-calendar.js", "attendance-view.js", "ledger.js", "celebrate.js"]);
  const { history } = semester({ until: "2026-10-16" });
  const model = C.heatmapModel(history, "cu", "2026-10-17");
  const days = new Set(Object.values(history.subjects).flatMap((subject) => subject.marks.filter(([, , kind]) => kind === "p" || kind === "a").map(([day]) => day)));
  assert.equal(model.days, days.size);
  assert.equal(model.cells.length, model.weeks * 6);
  assert.equal(model.cells.filter((cell) => cell.entry).length, days.size);
  // Runs to the last teaching day, which is still ahead.
  assert.ok(model.cells.some((cell) => cell.future && cell.key === "2026-11-13"));
  assert.ok(model.perfect > 0 && model.perfect <= model.days);
  assert.equal(C.heatmapModel({ subjects: {} }, "cu", "2026-10-17"), null);
});

test("the receipt wraps a long subject at a word, two lines at most", () => {
  const { CuimsClub: C } = load(["attendance-model.js", "academic-calendar.js", "attendance-view.js", "ledger.js", "celebrate.js"]);
  assert.deepEqual([...C.fitLines("DESIGN AND ANALYSIS OF ALGORITHMS", 30, 2)], ["DESIGN AND ANALYSIS OF", "ALGORITHMS"]);
  const long = [...C.fitLines("A VERY LONG COURSE NAME THAT GOES ON AND ON PAST TWO LINES OF THE RECEIPT", 30, 2)];
  assert.equal(long.length, 2);
  assert.ok(long.every((line) => line.length <= 30));
  assert.match(long[1], /…$/);
});

test("past the last day of classes the Forecast shows the result, not a forecast", () => {
  const c = load(["attendance-model.js", "academic-calendar.js", "attendance-view.js", "forecast-model.js", "forecast-view.js"]);
  const A = c.CuimsAttendance;
  const { snapshot, history } = semester({ until: "2026-11-13" });
  const forecast = A.buildForecast(snapshot, history, new Date("2026-11-16T04:30:00Z"), { goal: "standard", calendar: "cu" });
  const html = A.renderForecast(forecast, {});
  assert.match(html, /is-ended/);
  assert.match(html, /Final · classes ended Fri 13 Nov/);
  assert.doesNotMatch(html, /Out of reach|classes over|likely \d/);
  assert.match(html, /data-goto="club"/);
  // Still a forecast before then.
  const before = A.renderForecast(A.buildForecast(semester({ until: "2026-10-16" }).snapshot, semester({ until: "2026-10-16" }).history, new Date("2026-10-17T04:30:00Z"), { goal: "standard", calendar: "cu" }), {});
  assert.doesNotMatch(before, /is-ended/);
});

test("credits CUIMS lists as a weekly class (summer training) stay out of the calendar file", () => {
  const { CuimsCalendarExport: X } = load(["attendance-model.js", "academic-calendar.js", "calendar-export.js"]);
  const result = X.classesIcs([
    { day: "sun", start: 570, end: 620, title: "Institute/Industrial Summer Training", code: "24CSI-305", kind: "P" },
    { day: "mon", start: 570, end: 620, title: "Computer Networks", code: "24CST-302", kind: "L" },
  ], { todayKey: "2026-10-17", calendar: "cu" });
  assert.equal(result.count, 1);
  assert.doesNotMatch(result.text, /Summer Training/);
});
