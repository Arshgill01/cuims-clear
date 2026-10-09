import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { TIMETABLE_HTML, fakeCuims, memoryStorage } from "./fake-cuims.mjs";
import { semester, campusTime } from "./forecast-fixture.mjs";

const FILES = ["attendance-parse.js", "attendance-model.js", "attendance-client.js", "attendance-daemon.js", "attendance-view.js", "forecast-model.js", "forecast-view.js"];

function load(browser = "firefox") {
  const context = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, TextEncoder, Intl, Date, Math, JSON, console, setTimeout });
  for (const name of FILES) {
    vm.runInContext(readFileSync(new URL(`../outputs/cuims-clear-${browser}/${name}`, import.meta.url), "utf8"), context, { filename: name });
  }
  return context.CuimsAttendance;
}

const A = load();
const plain = (value) => JSON.parse(JSON.stringify(value));
// Friday 9 Oct 2026, 10:05 IST: Operating Systems (9:40) is in progress.
const NOW = campusTime("2026-10-09", 10, 5);
const END = "2026-11-20";

function forecast(options = {}, fixture = {}) {
  const { snapshot, history } = semester(fixture);
  return A.buildForecast(snapshot, options.noHistory ? null : history, options.now || NOW, { end: END, ...options });
}

// ---- the draw ----

test("the beta-binomial sums to one and centres on the pace", () => {
  const pmf = A.betaBinomial(40, 17, 3);
  const total = pmf.reduce((sum, value) => sum + value, 0);
  const mean = pmf.reduce((sum, value, k) => sum + value * k, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(Math.abs(mean - (40 * 17) / 20) < 1e-6);
  assert.deepEqual(plain(A.betaBinomial(0, 2, 2)), [1]);
});

test("the last day of classes is the student's, else late November or late April", () => {
  const today = A.dayNumber("2026-10-09");
  assert.equal(A.dayKeyOf(A.semesterEnd("2026-12-04", today).day), "2026-12-04");
  assert.equal(A.semesterEnd("2026-12-04", today).estimated, false);
  const estimate = A.semesterEnd("", today);
  assert.equal(A.dayKeyOf(estimate.day), "2026-11-20");
  assert.equal(estimate.estimated, true);
  assert.equal(A.dayKeyOf(A.semesterEnd("", A.dayNumber("2027-02-10")).day), "2027-04-30");
  // Past the estimate, classes are over.
  assert.equal(A.dayKeyOf(A.semesterEnd("", A.dayNumber("2026-12-02")).day), "2026-12-02");
});

test("mark lists are kept small and come back in the marks shape", () => {
  const compact = A.compactMarks([
    { date: "/Date(1790533800000)/", time: "1:00 - 1:40 PM", present: true, kind: "present" },
    { date: "Monday, 28 Sep 2026", time: "09:40 - 10:20 AM", present: false, kind: "absent" },
    { date: "25/09/2026", time: "", present: false, kind: "dl" },
    { date: "nonsense", time: "", present: false, kind: "absent" },
  ]);
  assert.deepEqual(plain(compact), [["2026-09-25", -1, "d"], ["2026-09-28", 580, "a"], ["2026-09-28", 780, "p"]]);
  const back = A.expandMarks(compact);
  assert.equal(A.parseRange(back[2].time).start, 780);
  assert.equal(back[2].present, true);
  assert.equal(back[0].kind, "dl");
});

// ---- the forecast ----

test("each subject's finish is consistent: range inside attend-all, budget is what is left to miss", () => {
  const view = forecast();
  for (const subject of view.subjects) {
    const result = subject.result;
    assert.ok(result.low <= result.mid + 1e-9 && result.mid <= result.high + 1e-9, subject.title);
    assert.ok(result.high <= result.best + 1e-9, subject.title);
    assert.ok(Math.abs(result.best - ((subject.attended + result.left) / (subject.held + result.left)) * 100) < 1e-9);
    assert.equal(result.budget, result.free - result.need);
    assert.ok(result.chance >= 0 && result.chance <= 1);
    // The budget is exact: one more miss would leave the subject under 75%.
    if (result.budget >= 0) {
      const attended = subject.attended + result.free - result.budget;
      assert.ok(attended / (subject.held + result.left) >= 0.75 - 1e-12);
      assert.ok((attended - 1) / (subject.held + result.left) < 0.75);
    }
  }
});

test("classes left are counted from the timetable up to the last day", () => {
  const view = forecast();
  const aptitude = view.subjects.find((subject) => subject.title === "Aptitude-III");
  // Wed and Sat slots from Sat 10 Oct to Fri 20 Nov: 6 Wednesdays and 6 Saturdays.
  assert.equal(aptitude.result.left, 12);
  const os = view.subjects.find((subject) => subject.title === "Operating Systems");
  // Today's 9:40 is in progress and still counts; Mon, Wed, Thu, Fri after.
  assert.equal(os.classes[0].day, A.dayNumber("2026-10-09"));
  assert.equal(os.result.left, 1 + 6 * 4);
  const later = forecast({ end: "2026-11-27" });
  assert.equal(later.subjects.find((subject) => subject.title === "Aptitude-III").result.left, 14);
});

test("subjects are ordered by their chance, most at risk first", () => {
  const view = forecast({}, { rates: { "24UCT-310": 0.6 } });
  const chances = view.subjects.map((subject) => subject.result.chance);
  assert.deepEqual(chances, [...chances].sort((a, b) => a - b));
  assert.equal(view.subjects[0].title, "Universal Human Values");
});

test("pace follows the recent record, not only the semester total", () => {
  // Same totals, opposite recent habits: the one slipping lately has the lower pace.
  const steady = forecast({}, { seed: 3 });
  const { snapshot, history } = semester({ seed: 3 });
  const code = "24CST302";
  const marks = history.subjects[code].marks;
  const half = Math.floor(marks.length / 2);
  // Move every absence into the last weeks.
  const absent = marks.filter((mark) => mark[2] === "a").length;
  history.subjects[code].marks = marks.map((mark, index) => [mark[0], mark[1], index >= marks.length - absent ? "a" : "p"]);
  const slipping = A.buildForecast(snapshot, history, NOW, { end: END });
  const pace = (view) => view.subjects.find((subject) => subject.code === "24CST-302").pace;
  assert.ok(half > absent);
  assert.ok(pace(slipping) < pace(steady) - 0.05, `${pace(slipping)} vs ${pace(steady)}`);
});

test("without a mark list the forecast still works from the semester totals", () => {
  const view = forecast({ noHistory: true });
  assert.ok(view.subjects.every((subject) => subject.evidence === "total"));
  assert.equal(view.patterns, null);
  assert.equal(view.historyFrom, null);
  assert.ok(view.overall.result.left > 0);
  const html = A.renderForecast(view, { now: NOW });
  assert.match(html, /read a few subjects at a time/);
});

test("the history line ends exactly on today's official figure", () => {
  const view = forecast();
  const past = view.overall.series.past;
  const last = past[past.length - 1];
  assert.ok(Math.abs(last.value - view.overall.now) < 1e-9);
  assert.ok(Math.abs(last.x - view.nowX) < 1e-9);
  assert.ok(past.every((point, index) => !index || point.x >= past[index - 1].x));
  const future = view.overall.series.future.points;
  assert.equal(future[future.length - 1].x, A.dayNumber(END) + 1);
});

test("an overall goal out of reach says so, with the shortfall", () => {
  const view = forecast({}, { rates: { "24CST-301": 0.5, "24UCT-310": 0.5, "24CSP-305": 0.6 } });
  const result = view.overall.result;
  assert.equal(result.reachable, false);
  assert.equal(result.chance, 0);
  assert.ok(result.need > result.free);
  const html = A.renderForecast(view, { now: NOW });
  assert.match(html, /Out of reach/);
  assert.match(html, /Short by/);
});

// ---- the planner ----

function timetableSnapshot(subjects) {
  return { fetchedAt: campusTime("2026-09-28", 12, 30).toISOString(), marksDay: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML), subjects };
}

test("the planner gives each class a verdict: safe, can make up, or attend", () => {
  const now = campusTime("2026-09-28", 12, 30);
  const healthy = timetableSnapshot([
    { code: "24CSP-305", title: "Competitive Coding-II", attended: 30, delivered: 32 },
    { code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 },
    { code: "24TDT-312", title: "Aptitude-III", attended: 100, delivered: 100 },
  ]);
  const safe = A.buildForecast(healthy, null, now, { end: "2026-11-20" });
  assert.deepEqual(plain(safe.plan.classes.map((item) => [item.time, item.title, item.verdict])), [["1:00", "Computer Networks", "can-skip"]]);
  assert.equal(safe.plan.maxSkips, 1);

  // Under 90% overall now, but weeks of classes left to make it up.
  const under = timetableSnapshot([
    { code: "24CSP-305", title: "Competitive Coding-II", attended: 26, delivered: 32 },
    { code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 },
  ]);
  const makeUp = A.buildForecast(under, null, now, { end: "2026-11-20" });
  assert.equal(makeUp.plan.classes[0].verdict, "make-up");
  assert.equal(makeUp.plan.maxSkips, 0);
  assert.equal(makeUp.plan.maxMakeUp, 1);

  // The semester ends today: nothing left to make it up with.
  const over = A.buildForecast(under, null, now, { end: "2026-09-28", goal: "strict" });
  assert.equal(over.plan.classes[0].verdict, "attend");
});

test("a planned skip moves the end-of-day figures and the semester forecast", () => {
  const view = forecast();
  const day = view.plan.days.find((entry) => entry.label === "Sat");
  const pick = A.buildForecast(semester().snapshot, semester().history, NOW, { end: END, day: day.key });
  const key = pick.plan.classes[0].key;
  const planned = A.buildForecast(semester().snapshot, semester().history, NOW, { end: END, day: day.key, plan: [key] });
  const item = planned.plan.classes.find((entry) => entry.key === key);
  assert.ok(item.skipping);
  assert.ok(["planned", "planned-make-up"].includes(item.verdict));
  const impact = planned.plan.impact;
  assert.equal(impact.skipped, 1);
  assert.ok(impact.subjects[0].to < impact.subjects[0].from);
  assert.equal(planned.overall.result.budget, view.overall.result.budget - 1);
  assert.ok(planned.overall.result.chance <= view.overall.result.chance + 1e-12);
  assert.ok(planned.overall.result.mid < view.overall.result.mid);
  assert.equal(planned.overall.unplanned.budget, view.overall.result.budget);
  assert.equal(planned.plan.days.find((entry) => entry.key === day.key).planned, 1);
});

test("skips planned for a day that has passed, or beyond the planner's week, are ignored", () => {
  const view = forecast({ plan: ["2026-10-02|24CST301@580", "2026-11-13|24CST301@580", "garbage"] });
  assert.equal(view.plan.planned, 0);
  assert.equal(view.overall.result.planned, 0);
});

test("the planner covers today and the next six days with classes", () => {
  const view = forecast();
  assert.equal(view.plan.days.length, 7);
  assert.equal(view.plan.days[0].label, "Today");
  assert.ok(view.plan.days.every((entry) => entry.label !== "Sun"));
  const after = forecast({ now: campusTime("2026-10-09", 18, 0) });
  assert.notEqual(after.plan.days[0].label, "Today", "no classes left today");
});

test("a whole day off is judged together", () => {
  const view = forecast();
  const monday = forecast({ day: view.plan.days.find((entry) => entry.label === "Mon").key });
  const all = A.buildForecast(semester().snapshot, semester().history, NOW, { end: END, day: monday.plan.day, plan: monday.plan.wholeDay.keys });
  assert.equal(all.plan.impact.skipped, monday.plan.classes.length);
  assert.equal(all.plan.impact.state, monday.plan.wholeDay.state);
});

// ---- habits ----

test("habits find the weak weekday and the recent trend", () => {
  const view = forecast({}, { mondaySlump: 0.6, rates: { "24CST-301": 0.95 } });
  const habits = view.patterns;
  assert.ok(habits.counted >= 20);
  assert.equal(habits.worst?.id, "mon");
  assert.ok(habits.recent > 0 && habits.recent <= 1);
  const html = A.renderForecast(view, { now: NOW });
  assert.match(html, /Mondays<\/strong> are your weak spot/);
});

// ---- the view ----

test("the Forecast tab escapes CUIMS text and never shows NaN, undefined or Infinity", () => {
  const { snapshot, history } = semester();
  snapshot.subjects[0].title = "<img src=x onerror=alert(1)>";
  snapshot.slots.filter((slot) => slot.shortCode === snapshot.subjects[0].code).forEach((slot) => (slot.title = snapshot.subjects[0].title));
  const view = A.buildForecast(snapshot, history, NOW, { end: END });
  for (const subject of view.subjects) {
    const html = A.renderForecast(view, { now: NOW, expanded: subject.code });
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/);
    assert.match(html, new RegExp(`aria-expanded="true"`));
  }
  const html = A.renderForecast(view, { now: NOW });
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /class="fc-hero/);
  assert.match(html, /data-plan-key=/);
  assert.match(html, /data-end-step="7"/);
  assert.match(html, /How the forecast works/);
});

test("chances are rounded and never claim certainty", () => {
  assert.equal(A.chanceText(0.999), "over 95%");
  assert.equal(A.chanceText(0.001), "under 5%");
  assert.equal(A.chanceText(0.62), "60%");
  assert.equal(A.chanceText(0.98), "over 95%");
});

test("no attendance yet: the tab explains itself and points to Attendance", () => {
  assert.equal(A.buildForecast({ subjects: [] }, null, NOW), null);
  const html = A.renderForecast(null, {});
  assert.match(html, /data-goto="attendance"/);
});

test("the strict goal reports subjects on track instead of an overall chance", () => {
  const view = forecast({ goal: "strict" });
  const html = A.renderForecast(view, { now: NOW });
  assert.match(html, new RegExp(`${view.onTrack} of ${view.subjects.length} subjects`));
});

test("Chrome ships the same Forecast files as Firefox", () => {
  for (const name of ["forecast-model.js", "forecast-view.js", "popup.html", "popup.js", "popup.css", "attendance-model.js", "attendance-parse.js", "attendance-daemon.js"]) {
    const firefox = readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8");
    const chrome = readFileSync(new URL(`../outputs/cuims-clear-chrome/${name}`, import.meta.url), "utf8");
    assert.equal(chrome, firefox, name);
  }
  const html = readFileSync(new URL("../outputs/cuims-clear-chrome/popup.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="forecast-model.js"') < html.indexOf('src="forecast-view.js"'));
  assert.ok(html.indexOf('src="forecast-view.js"') < html.indexOf('src="popup.js"'));
  assert.match(html, /id="tab-forecast"/);
});

// ---- history reads ----

test("history is read again only when a subject's counts move", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret" });
  let time = Date.UTC(2026, 8, 28, 5, 30);
  const bg = A.createDaemon({ storage, fetchImpl: server.fetchImpl, solveCaptcha: async () => "Ab12", now: () => time, sleep: async (ms) => (time += ms) });
  const calls = () => server.state.requests.filter((line) => /getfullreport/i.test(line)).length;
  await bg.refresh("manual");
  assert.equal(calls(), 3);
  assert.deepEqual(Object.keys(storage.data.attendanceHistory.subjects).sort(), ["24CSP305", "24CST302", "24TDT312"]);
  time += 60_000;
  await bg.refresh("manual");
  assert.equal(calls(), 3);
  // A new class for one subject: only that one is read again.
  storage.data.attendanceHistory.subjects["24CST302"].delivered = 11;
  time += 60_000;
  await bg.refresh("manual");
  assert.equal(calls(), 4);
  // A subject that has left the report leaves the stored history too.
  storage.data.attendanceHistory.subjects.GONE = { attended: 1, delivered: 1, at: 0, marks: [] };
  storage.data.attendanceHistory.subjects["24CSP305"].delivered = 0;
  time += 60_000;
  await bg.refresh("manual");
  assert.equal(storage.data.attendanceHistory.subjects.GONE, undefined);
});

test("a long report fills its history four subjects a refresh", async () => {
  const server = fakeCuims({ signedIn: true });
  const many = Array.from({ length: 9 }, (_, index) => ({ Code: `24CST-3${index}0`, Title: `Subject ${index}`, EligibilityDelivered: "20", EligibilityAttended: "18", EncryptCode: `enc${index}` }));
  const fetchImpl = async (target, options = {}) => {
    if (/getreport$/i.test(new URL(target).pathname)) {
      return { url: target, status: 200, text: async () => JSON.stringify({ d: JSON.stringify(many) }), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return server.fetchImpl(target, options);
  };
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret" });
  let time = Date.UTC(2026, 8, 28, 5, 30);
  const bg = A.createDaemon({ storage, fetchImpl, solveCaptcha: async () => "Ab12", now: () => time, sleep: async (ms) => (time += ms) });
  const calls = () => server.state.requests.filter((line) => /getfullreport/i.test(line)).length;
  const kept = () => Object.keys(storage.data.attendanceHistory?.subjects || {}).length;
  await bg.refresh("manual");
  assert.equal(calls(), 4);
  assert.equal(kept(), 4);
  time += 60_000;
  await bg.refresh("manual");
  assert.equal(calls(), 8);
  time += 60_000;
  await bg.refresh("manual");
  assert.equal(kept(), 9);
  time += 60_000;
  await bg.refresh("manual");
  assert.equal(calls(), 9, "all in, nothing more to read");
});
