// CU's academic calendar and the student's date sheet: which days have no
// classes, what the Attendance and Forecast tabs make of them, and how the
// background keeps the date sheet without extra page loads.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage, TIMETABLE_HTML, dateSheetPage } from "./fake-cuims.mjs";

const FILES = ["attendance-parse.js", "academic-calendar.js", "attendance-model.js", "attendance-client.js", "attendance-daemon.js", "attendance-view.js", "forecast-model.js"];

function load() {
  const context = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, TextEncoder, Intl, Date, Math, JSON, console, setTimeout });
  for (const name of FILES) {
    vm.runInContext(readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8"), context, { filename: name });
  }
  return context.CuimsAttendance;
}

const A = load();
const plain = (value) => JSON.parse(JSON.stringify(value));
// 11:00 in Mohali on a given day.
const at11 = (key) => Date.parse(`${key}T11:00:00+05:30`);
const META = { reportId: "RID+/=", sessionId: "25262" };
const MST2 = [
  { type: "MST-2", code: "24CST-302", date: "13 Oct 2026", time: "12:30" },
  { type: "MST-2", code: "24SMT-341", date: "15 Oct 2026", time: "15:00" },
];
const MST1 = [{ type: "MST-1", code: "24CST-302", date: "25 Aug 2026", time: "12:30" }];

function daemon(server, storage, clock) {
  let time = clock;
  const instance = A.createDaemon({
    storage,
    fetchImpl: server.fetchImpl,
    solveCaptcha: async () => "Ab12",
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  return { ...instance, advance: (ms) => (time += ms) };
}

const saved = (extra = {}) => memoryStorage({ uid: "24BCS00000", password: "secret", ...extra });
const freshTimetable = (savedAt) => ({ slots: A.parseTimetable(TIMETABLE_HTML), savedAt, session: "25262" });
const leavesRead = (when) => ({ v: A.LEAVES_VERSION, apps: { dl: [], ml: [] }, pending: {}, dlAt: when, mlAt: when, checkedAt: when });

// ---- the date sheet page ----

test("the date sheet is read from each row's hidden fields, every type in one page", () => {
  const exams = A.parseDateSheet(dateSheetPage([...MST2, ...MST1]));
  assert.deepEqual(plain(exams), [
    { type: "MST-1", code: "24CST-302", day: "2026-08-25", time: "12:30" },
    { type: "MST-2", code: "24CST-302", day: "2026-10-13", time: "12:30" },
    { type: "MST-2", code: "24SMT-341", day: "2026-10-15", time: "15:00" },
  ]);
  assert.deepEqual(plain(A.parseDateSheet("<html>no grid</html>")), []);
});

// ---- the calendar ----

test("holidays, test weeks, breaks and the days after the last teaching day have no classes", () => {
  const reason = (key, context) => A.noClassReason(key, context)?.kind || null;
  assert.equal(reason("2026-10-20"), "holiday");
  assert.equal(A.noClassReason("2026-10-20").label, "Dussehra");
  assert.equal(reason("2026-10-13"), "tests");
  assert.equal(reason("2026-10-19"), null);
  assert.equal(reason("2026-11-10"), "break");
  assert.equal(reason("2026-11-13"), null, "the last teaching day itself");
  assert.equal(reason("2026-11-16"), "over");
  // Practical IST and VAC weeks had classes.
  assert.equal(reason("2026-09-29"), null);
  assert.equal(reason("2026-10-06"), null);
  // UIC runs its own test weeks.
  assert.equal(reason("2026-10-13", { calendar: "uic" }), null);
  assert.equal(reason("2026-10-22", { calendar: "uic" }), "tests");
  assert.equal(A.calendarFor("auto", "24BCA10001"), "uic");
  assert.equal(A.calendarFor("auto", "24BCS10184"), "cu");
  assert.equal(A.calendarFor("uid", "24BCS10184"), "uid");
});

test("the student's own date sheet decides their test weeks, whatever the calendar says", () => {
  // A UIC student whose sheet puts MST-2 in CU's general week.
  const exams = A.parseDateSheet(dateSheetPage(MST2));
  const context = { calendar: "uic", exams };
  assert.equal(A.noClassReason("2026-10-12", context)?.kind, "tests", "the Monday of the week with their papers");
  assert.equal(A.noClassReason("2026-10-17", context)?.kind, "tests", "through Saturday");
  assert.equal(A.noClassReason("2026-10-22", context), null, "the calendar's IST-2 week gives way to the sheet");
  // IST-1 is not on the sheet: the calendar's week stands.
  assert.equal(A.noClassReason("2026-09-01", context)?.kind, "tests");
});

// ---- Attendance ----

test("on a day without classes, today's timetable shows no classes and says why", () => {
  const snapshot = {
    subjects: [{ code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12, marks: [] }],
    slots: A.parseTimetable(TIMETABLE_HTML).map((slot) => ({ ...slot, weekday: "tue" })),
    marksDay: "2026-10-13",
  };
  // Tue 13 Oct, 21:00: IST-2. Earlier builds showed the day's classes as
  // ended without a mark.
  const view = A.buildAnalytics(snapshot, new Date(Date.parse("2026-10-13T21:00:00+05:30")));
  assert.equal(view.dayOff.kind, "tests");
  assert.deepEqual(plain(view.subjects[0].today), []);
  assert.equal(view.overall.pending, 0);
  assert.match(A.renderAttendance(view, { now: new Date() }), /No classes today: IST-2 \(mid-semester tests\)/);
  // The next Monday is a teaching day again.
  const monday = A.buildAnalytics({ ...snapshot, slots: A.parseTimetable(TIMETABLE_HTML) }, new Date(at11("2026-10-19")));
  assert.equal(monday.dayOff, null);
  assert.equal(monday.subjects[0].today.length, 1);
});

// ---- Forecast ----

test("the Forecast counts no classes on days the calendar or the date sheet rules out", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML); // Mon 1:00 Computer Networks
  const snapshot = { subjects: [{ code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 }], slots };
  const left = (extra = {}) => A.buildForecast({ ...snapshot, ...extra }, null, new Date(at11("2026-10-05")), { end: "2026-11-13" }).subjects[0].result.left;
  // Today's 1:00 (it is 11:00), then Mondays to 13 Nov: 12, 19, 26 Oct,
  // 2, 9 Nov. IST-2 takes the 12th, Valmiki Jayanti the 26th, the Diwali
  // break the 9th.
  assert.equal(left(), 1 + 2);
});

// ---- the background ----

test("the date sheet is read in the run-up to a test week, at most daily, until it lists that test", async () => {
  // Mon 5 Oct: IST-2 starts on the 12th. Leave and timetable are current.
  const clock = at11("2026-10-05");
  const server = fakeCuims({ signedIn: true, dateSheet: [] });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(clock), attendanceLeaves: leavesRead(clock) });
  const bg = daemon(server, storage, clock);
  await bg.refresh();
  assert.equal(server.state.dateSheetLoads, 1);
  // Not out yet: tried again a day later, not sooner.
  bg.advance(6 * 60 * 60_000);
  await bg.refresh();
  assert.equal(server.state.dateSheetLoads, 1);
  server.state.dateSheet = MST2;
  bg.advance(18 * 60 * 60_000);
  storage.data.attendanceLeaves = leavesRead(clock + 24 * 60 * 60_000);
  const read = await bg.refresh();
  assert.equal(server.state.dateSheetLoads, 2);
  assert.equal(read.snapshot.exams.length, 2);
  // Listed: no more loads this test.
  bg.advance(26 * 60 * 60_000);
  storage.data.attendanceLeaves = leavesRead(clock + 50 * 60 * 60_000);
  await bg.refresh();
  assert.equal(server.state.dateSheetLoads, 2);
});

test("far from any test week the date sheet costs no request", async () => {
  const clock = at11("2026-09-21");
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(clock), attendanceLeaves: leavesRead(clock) });
  await daemon(server, storage, clock).refresh();
  assert.equal(server.state.dateSheetLoads, 0);
});

test("opening the Date Sheet on CUIMS hands it over, and one filtered type never drops the others", async () => {
  const clock = at11("2026-10-05");
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceSnapshot: { fetchedAt: new Date(clock).toISOString(), subjects: [], slots: [] } });
  const bg = daemon(server, storage, clock);
  await bg.ingestDateSheetPage(dateSheetPage([...MST1, ...MST2]));
  assert.equal(storage.data.attendanceDateSheet.exams.length, 3);
  assert.equal(storage.data.attendanceSnapshot.exams.length, 3);
  // The student picks MST-1 in the dropdown: its rows replace MST-1's only.
  await bg.ingestDateSheetPage(dateSheetPage([{ ...MST1[0], date: "26 Aug 2026" }]));
  const exams = storage.data.attendanceDateSheet.exams;
  assert.deepEqual(plain(exams.map((exam) => [exam.type, exam.day])), [["MST-1", "2026-08-26"], ["MST-2", "2026-10-13"], ["MST-2", "2026-10-15"]]);
  assert.equal(server.state.requests.length, 0, "no request of its own");
});

test("report ids from before the semester began are read again from the attendance page, once", async () => {
  // Read in the odd semester; it is now the even one.
  const clock = at11("2027-01-06");
  const server = fakeCuims({ signedIn: true });
  const old = { ...META, at: at11("2026-11-20") };
  const storage = saved({ attendanceMeta: old, attendanceTimetable: freshTimetable(clock), attendanceLeaves: leavesRead(clock) });
  const bg = daemon(server, storage, clock);
  const result = await bg.refresh();
  assert.equal(result.error, undefined, result.error);
  assert.equal(server.state.attendanceLoads, 1);
  assert.equal(storage.data.attendanceMeta.at, clock);
  // Fresh: not again until the semester's first week is over.
  bg.advance(60_000);
  await bg.refresh();
  assert.equal(server.state.attendanceLoads, 1);
  bg.advance(6 * 24 * 60 * 60_000);
  storage.data.attendanceLeaves = leavesRead(clock + 6 * 24 * 60 * 60_000);
  await bg.refresh();
  assert.equal(server.state.attendanceLoads, 2, "once more a week in, in case CUIMS switched late");
});

test("a semester check that cannot load the page keeps reading with the saved ids", async () => {
  const clock = at11("2027-01-06");
  const server = fakeCuims({ signedIn: true, limited: "menu" });
  const storage = saved({ attendanceMeta: { ...META, at: at11("2026-11-20") }, attendanceTimetable: freshTimetable(clock) });
  const result = await daemon(server, storage, clock).refresh();
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.snapshot.subjects.length, 3);
});

// Live, 13 Oct 2026: a first read's sign-in used nine of the ten session
// requests, so a later sign-in for duty leave stopped after its first step.
test("a sign-in's login steps never use up the page budget, and background sign-ins stay rare", async () => {
  const clock = at11("2026-09-28");
  const server = fakeCuims({ signedIn: false });
  // With nine of the ten page requests used, a sign-in could not afford
  // its landing step: it does not start at all, rather than leave the
  // session half signed in.
  const full = fakeCuims({ signedIn: false });
  const busy = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(clock), attendanceSessionRequests: Array(9).fill(clock - 5 * 60_000) });
  assert.equal((await daemon(full, busy, clock).refresh()).error, undefined);
  assert.equal(full.state.uidPosts + full.state.loginPosts, 0);
  // Seven used (a cold first read's pages and sign-in steps took nine): the
  // login steps cost nothing, the landing step and the page fit.
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(clock), attendanceSessionRequests: Array(7).fill(clock - 5 * 60_000) });
  const bg = daemon(server, storage, clock);
  const read = await bg.refresh();
  assert.equal(read.error, undefined, read.error);
  assert.equal(server.state.loginPosts, 1, "the sign-in completed");
  assert.ok(read.snapshot.leaves?.checkedAt, "and the duty leave page was read after it");
  // Signed out again ten minutes on: no second sign-in for optional pages
  // within half an hour of the last good one.
  server.state.signedIn = false;
  Object.assign(storage.data, { sessionAlive: false, sessionCheckedAt: clock + 60_000 });
  bg.advance(10 * 60_000);
  storage.data.attendanceLeaves = { ...storage.data.attendanceLeaves, dlAt: 1, mlAt: 1 };
  await bg.refresh();
  assert.equal(server.state.loginPosts, 1);
  // Three background sign-ins an hour at most, whatever they are for.
  Object.assign(storage.data, { bgSignIns: [clock, clock + 1, clock + 2], bgSignInOkAt: 0 });
  bg.advance(30 * 60_000);
  await bg.refresh();
  assert.equal(server.state.loginPosts, 1);
});
