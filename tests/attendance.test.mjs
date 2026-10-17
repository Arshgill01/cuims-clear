import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage, TIMETABLE_HTML, dutyLeavePage, medicalLeavePage, EMPTY_MENU_PAGE } from "./fake-cuims.mjs";
import { contentSource } from "./content-source.mjs";

const FILES = ["attendance-parse.js", "academic-calendar.js", "attendance-model.js", "attendance-client.js", "attendance-daemon.js", "attendance-view.js"];

function load() {
  const context = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, TextEncoder, Intl, Date, Math, JSON, console, setTimeout });
  for (const name of FILES) {
    vm.runInContext(readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8"), context, { filename: name });
  }
  return context.CuimsAttendance;
}

const A = load();
// Monday 28 Sep 2026, 11:00 IST.
const MONDAY_11 = Date.UTC(2026, 8, 28, 5, 30);
const at = (hours, minutes = 0, day = 28) => Date.UTC(2026, 8, day, hours - 5, minutes - 30);

function daemon(server, storage, { clock = MONDAY_11, captcha = "Ab12", solve = null, onSleep = null } = {}) {
  let time = clock;
  const sleeps = [];
  const instance = A.createDaemon({
    storage,
    fetchImpl: server.fetchImpl,
    solveCaptcha: solve || (async () => captcha),
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
      await onSleep?.(ms, time);
    },
  });
  return { ...instance, sleeps, advance: (ms) => (time += ms), setTime: (value) => (time = value) };
}

const saved = (extra = {}) => memoryStorage({ uid: "24BCS00000", password: "secret", ...extra });
const META = { reportId: "RID+/=", sessionId: "25262" };
const HOME = "https://students.cuchd.in/StudentHome.aspx";
// A timetable read this morning, and leave pages read today with nothing
// pending: a read then needs no page at all.
const freshTimetable = (at = MONDAY_11) => ({ slots: A.parseTimetable(TIMETABLE_HTML), savedAt: at, session: "25262" });
const leavesRead = (at = MONDAY_11) => ({ v: A.LEAVES_VERSION, apps: { dl: [], ml: [] }, pending: {}, dlAt: at, mlAt: at, checkedAt: at });
const pagesOf = (server) => server.state.requests.filter((line) => A.isInnerPage(`https://students.cuchd.in${line.split(" ")[1]}`));

// ---- parsing against the real page shapes ----

test("hidden login fields come back decoded, including the per-browser token", () => {
  const html = `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="a&amp;b" /><input type="hidden" name="hfdata" id="hfdata" /><input type="hidden" name="hfcurrentbackground" value="tok==" /><input name="txtUserId" type="text" />`;
  assert.deepEqual({ ...A.hiddenFields(html) }, { __VIEWSTATE: "a&b", hfdata: "", hfcurrentbackground: "tok==" });
  assert.equal(A.isUidStep(html), true);
  assert.equal(A.isPasswordStep(html), false);
});

test("report id and session come from the page's own getReport call", () => {
  const meta = A.extractReportMeta(`<option selected="selected" value="25262">CurrentSession (25262)</option><script>setTimeout(function () {getReport('p8tQ/laO=','25262');}, 200);</script>`);
  assert.equal(meta.reportId, "p8tQ/laO=");
  assert.equal(meta.sessionId, "25262");
});

test("GetReport and GetFullReport wrappers both unwrap, and No Data Found is an empty list", () => {
  assert.deepEqual([...A.unwrapReport({ d: '[{"Code":"X"}]' })].map((row) => row.Code), ["X"]);
  assert.deepEqual([...A.unwrapReport({ d: { Result: '[{"AttDate":"28/09/2026"}]' } })].map((row) => row.AttDate), ["28/09/2026"]);
  assert.equal(A.unwrapReport({ d: { Result: "No Data Found" } }).length, 0);
  assert.equal(A.unwrapReport("<html>"), null);
});

test("timetable parses weekday columns, times, and course names", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  assert.equal(slots.length, 3);
  assert.deepEqual({ ...slots[0] }, { weekday: "mon", start: 580, end: 620, shortCode: "24CSP-305", title: "Competitive Coding-II", kind: "P", room: "1-2-C", teacher: "Teacher", group: "A" });
  assert.equal(slots[1].start, 13 * 60);
  assert.equal(slots[2].weekday, "tue");
});

// ---- skip math and today ----

test("skip counts respect 75% per subject and cap at the 90% overall room", () => {
  assert.equal(A.maxMisses(26, 32, 0.75), 2);
  assert.equal(A.maxMisses(16, 16, 0.75), 5);
  assert.equal(A.classesToRecover(20, 30, 0.75), 10);
  const view = A.buildAnalytics({ subjects: [
    { code: "A", title: "A", attended: 16, delivered: 16 },
    { code: "B", title: "B", attended: 250, delivered: 278 },
  ] }, new Date(MONDAY_11));
  assert.equal(view.overall.skip, 1);
  const a = view.subjects.find((row) => row.code === "A");
  assert.equal(a.skip, 1);
  assert.equal(a.limitedByOverall, true);
  assert.equal(a.line, "Can skip 1");
});

test("course tone follows the attendance percentage", () => {
  const view = A.buildAnalytics({ subjects: [
    { code: "L", title: "Low", attended: 7, delivered: 10 },
    { code: "T", title: "Tight", attended: 77, delivered: 100 },
    { code: "O", title: "Ok", attended: 85, delivered: 100 },
    { code: "H", title: "High", attended: 19, delivered: 20 },
  ] }, new Date(MONDAY_11));
  assert.deepEqual(view.subjects.map((row) => row.tone), ["low", "tight", "ok", "high"]);
  assert.equal(view.subjects[0].line, "Attend next 2 to reach 75%");
});

test("an ended class with no posted mark shows as not marked and leaves the numbers to CUIMS", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const filler = { code: "24XX-100", title: "Filler", attended: 500, delivered: 505 };
  const subjects = [{ code: "24CSP-305", title: "Competitive Coding-II", attended: 26, delivered: 32, marks: [] }, filler];
  const unposted = A.buildAnalytics({ subjects, slots, marksDay: "2026-09-28" }, new Date(MONDAY_11));
  const row = unposted.subjects.find((item) => item.code === "24CSP-305");
  assert.equal(row.today[0].state, "pending");
  assert.equal(row.skip, 2, "26 of 32, as CUIMS has it");

  const posted = A.buildAnalytics({
    subjects: [{ ...subjects[0], attended: 27, delivered: 33, marks: [{ date: "28/09/2026", time: "09:40 - 10:20 AM", present: true }] }, filler],
    slots,
    marksDay: "2026-09-28",
  }, new Date(MONDAY_11));
  const after = posted.subjects.find((item) => item.code === "24CSP-305");
  assert.equal(after.today[0].state, "present");
  assert.equal(after.skip, 3);
});

test("unmarked classes never turn a posted 91.7% into a reach-90% warning", () => {
  // 2026-10-13: 310/338 posted and seven of the day's classes ended unmarked
  // (CUIMS had posted nothing since 9 Oct). Counting them as missed made
  // 310/345 and "Attend next 5 classes to reach 90%".
  const slot = (shortCode, hour) => ({ weekday: "mon", start: hour * 60, end: hour * 60 + 50, shortCode, title: "", kind: "L" });
  const slots = [slot("CSP-305", 9), slot("CSP-305", 10), ...[11, 12, 13, 14, 15].map((hour) => slot("XX-100", hour))];
  const subjects = [
    { code: "24CSP-305", title: "Competitive Coding-II", attended: 30, delivered: 36, marks: [] },
    { code: "24XX-100", title: "Filler", attended: 280, delivered: 302, marks: [] },
  ];
  const view = A.buildAnalytics({ subjects, slots, marksDay: "2026-09-28" }, new Date(Date.parse("2026-09-28T21:23:00+05:30")));
  assert.equal(A.formatPercent(view.overall.percent), "91.7%");
  assert.equal(view.overall.pending, 7);
  assert.equal(view.overall.recover, 0);
  assert.equal(view.overall.skip, A.maxMisses(310, 338, 0.9));
  assert.equal(view.overall.line, "6 misses left, shared across subjects");
  const cc = view.subjects.find((row) => row.code === "24CSP-305");
  assert.deepEqual(cc.today.map((item) => item.state), ["pending", "pending"]);
  assert.equal(cc.line, "Can skip 4");
  assert.doesNotMatch(A.renderAttendance(view, { now: new Date() }), /is-recover/);
});

test("today's later classes show as upcoming and count toward classes left", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const view = A.buildAnalytics({ subjects: [{ code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 }], slots }, new Date(MONDAY_11));
  assert.equal(view.subjects[0].today[0].state, "next");
  assert.equal(view.subjects[0].today[0].time, "1:00");
  assert.equal(view.overall.left, 1);
});

test("with a live session a refresh reads attendance without touching any login page", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.error, undefined);
  assert.equal(result.snapshot.subjects.length, 3);
  assert.equal(server.state.requests.some((line) => /\/$|login/i.test(line)), false, server.state.requests.join(", "));
  assert.ok(server.state.requests.length <= 6, server.state.requests.join(", "));
  assert.equal(storage.data.sessionAlive, true);
});

test("a dead session signs in once: one UID step, one password submit, no replays", async () => {
  const server = fakeCuims();
  const storage = saved();
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.equal(server.state.uidPosts, 1);
  assert.equal(server.state.loginPosts, 1);
  assert.equal(result.snapshot.subjects[0].title, "Competitive Coding-II");
  assert.equal(storage.data.bgSignInUntil, 0);
  assert.ok(storage.data.bgSignInOkAt > 0);
});

test("one refused background login stands the background down for the window, leaving the tab its three tries", async () => {
  const server = fakeCuims({ rejectAs: "captcha" });
  const storage = saved();
  const bg = daemon(server, storage);
  const first = await bg.refresh("manual");
  assert.equal(first.code, "bad-captcha");
  assert.equal(server.state.loginPosts, 1, "one submit per sign-in");
  bg.advance(60_000);
  assert.equal((await bg.refresh("manual")).code, "cooldown");
  bg.advance(10 * 60_000);
  assert.equal((await bg.refresh("manual")).code, "cooldown");
  assert.equal(server.state.loginPosts, 1, "no second background submit inside 20 minutes");
  bg.advance(11 * 60_000);
  await bg.refresh("manual");
  assert.equal(server.state.loginPosts, 2, "back once the window has passed");
});

test("a refusal on the CUIMS tab keeps the background from signing in too", async () => {
  const server = fakeCuims();
  const storage = saved({ loginGuard: { failures: [{ at: MONDAY_11 - 60_000, by: "page" }], lockoutUntil: 0 } });
  assert.equal((await daemon(server, storage).refresh("manual")).code, "cooldown");
  assert.equal(server.state.loginPosts, 0);
});

// ---- the background and a CUIMS tab share one session and one captcha ----

test("a CUIMS tab that starts the login while the background reads its captcha stops the background submit", async () => {
  const server = fakeCuims();
  const storage = saved();
  let bg;
  bg = daemon(server, storage, {
    solve: async () => {
      // The student opens CUIMS right now: the tab says so at document_start.
      await storage.set({ tabLoginTouchAt: MONDAY_11 + 1 });
      return { text: "Ab12", confident: true };
    },
  });
  const result = await bg.refresh("manual");
  assert.equal(result.code, "tab-login");
  assert.equal(server.state.loginPosts, 0, "a captcha the tab has replaced is never submitted");
  const { loginGuard } = await storage.get({ loginGuard: null });
  assert.equal(loginGuard?.failures?.length || 0, 0, "giving way to the tab is not a failure");
});

test("a tab that just started loading the login page keeps the background off the login flow", async () => {
  const server = fakeCuims();
  const storage = saved({ tabLoginTouchAt: MONDAY_11 - 5_000 });
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.code, "tab-login");
  assert.equal(server.state.loginPageLoads + server.state.captchaReads + server.state.loginPosts, 0);
});

test("an unsure captcha read is re-drawn, never submitted, and costs no attempt", async () => {
  const server = fakeCuims();
  const storage = saved();
  const bg = daemon(server, storage, { solve: async () => ({ text: "Ab12", confident: false }) });
  const result = await bg.refresh("manual");
  assert.equal(result.code, "bad-captcha");
  assert.equal(server.state.loginPosts, 0);
  assert.equal(server.state.captchaReads, 2, "one fresh captcha after the unsure one, then stop");
  const { loginGuard } = await storage.get({ loginGuard: null });
  assert.equal(loginGuard?.failures?.length || 0, 0);
});

test("only four-character reads are ever submitted from the background", async () => {
  for (const text of ["Ab1", "Ab12x", "Ab12xy", "Ab!2", ""]) {
    const server = fakeCuims();
    await daemon(server, saved(), { captcha: text }).refresh("manual");
    assert.equal(server.state.loginPosts, 0, JSON.stringify(text));
  }
});

test("a confident read from the solver signs in and reads attendance", async () => {
  const server = fakeCuims();
  const bg = daemon(server, saved(), { solve: async () => ({ text: "Ab12", confident: true, score: 0.95 }) });
  const result = await bg.refresh("manual");
  assert.equal(result.error, undefined);
  assert.equal(server.state.loginPosts, 1);
  assert.equal(result.snapshot.subjects.length, 3);
});

test("a rejected password stops after one submit and stays stopped for that UID", async () => {
  const server = fakeCuims({ password: "other" });
  const storage = saved();
  const bg = daemon(server, storage);
  assert.equal((await bg.refresh("manual")).code, "bad-password");
  bg.advance(60_000);
  assert.equal((await bg.refresh("manual")).code, "bad-password");
  assert.equal(server.state.loginPosts, 1);
});

test("a CUIMS lockout message blocks every later sign-in until it expires", async () => {
  const server = fakeCuims({ rejectAs: "lockout" });
  const storage = saved();
  const bg = daemon(server, storage);
  assert.equal((await bg.refresh("manual")).code, "lockout");
  bg.advance(5 * 60_000);
  assert.equal((await bg.refresh("manual")).code, "lockout");
  assert.equal(server.state.loginPosts, 1);
});

test("a lockout recorded by the CUIMS tab also stops the background", async () => {
  const server = fakeCuims();
  const storage = saved({ loginGuard: { failures: [], lockoutUntil: MONDAY_11 + 10 * 60_000 } });
  assert.equal((await daemon(server, storage).refresh("manual")).code, "lockout");
  assert.equal(server.state.uidPosts, 0);
});

test("refreshes closer than 60 seconds apart reuse the saved read", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  const count = server.state.requests.length;
  bg.advance(10_000);
  const again = await bg.refresh("manual");
  assert.equal(again.recent, true);
  assert.equal(server.state.requests.length, count);
});

test("two refresh presses at once share a single run", async () => {
  const server = fakeCuims();
  const bg = daemon(server, saved());
  const [left, right] = await Promise.all([bg.refresh("manual"), bg.refresh("manual")]);
  assert.equal(left, right);
  assert.equal(server.state.loginPosts, 1);
});

test("the report budget stops a read before it calls CUIMS", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceRequests: Array.from({ length: 60 }, (_, index) => MONDAY_11 - index * 1000) });
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.code, "busy");
  assert.equal(server.state.requests.length, 0);
});

test("a login in progress in a CUIMS tab is waited for, not raced", async () => {
  const server = fakeCuims();
  const storage = saved({ pageLoginAt: MONDAY_11 - 2000 });
  const bg = daemon(server, storage);
  const result = await bg.refresh("manual");
  assert.deepEqual(bg.sleeps, [4000, 2000]);
  assert.equal(result.code, "cooldown");
  assert.equal(server.state.uidPosts, 0);
});

test("CUIMS sending attendance to the home page is reported, not treated as signed out", async () => {
  const server = fakeCuims({ signedIn: true, homeInsteadOfAttendance: true });
  const result = await daemon(server, saved()).refresh("manual");
  assert.equal(result.code, "portal-redirect");
  assert.equal(server.state.uidPosts, 0);
});

test("day-by-day marks are only requested for subjects whose class today has started", async () => {
  const server = fakeCuims({ signedIn: true, marksToday: [{ course: "enc305", AttDate: "28/09/2026", Timing: "09:40 - 10:20 AM", AttendanceCode: "P" }] });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  const marksCalls = () => server.state.requests.filter((line) => /getfullreport/i.test(line)).length;
  // One for today's started class; the other two only for the Forecast
  // tab's history, once.
  assert.equal(marksCalls(), 3);
  // The timetable waits five minutes after the attendance page.
  bg.advance(5 * 60_000);
  const result = await bg.refresh("manual");
  assert.equal(marksCalls(), 3, "nothing moved, nothing re-read");
  const view = A.buildAnalytics(result.snapshot, new Date(MONDAY_11));
  const cc = view.subjects.find((row) => row.code === "24CSP-305");
  assert.equal(cc.today[0].state, "present");
});

test("the timetable is fetched at most once a day", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  bg.advance(60 * 60_000);
  await bg.refresh("manual");
  assert.equal(server.state.requests.filter((line) => /frmmytimetable/i.test(line)).length, 1);
});

test("the popup view escapes CUIMS text and keeps each prediction to one short line", () => {
  const view = A.buildAnalytics({
    fetchedAt: new Date(MONDAY_11).toISOString(),
    subjects: [{ code: "X", title: "<b>Networks</b>", attended: 26, delivered: 32 }],
  }, new Date(MONDAY_11));
  const html = A.renderAttendance(view, {});
  assert.match(html, /&lt;b&gt;Networks/);
  assert.doesNotMatch(html, /<b>Networks/);
  assert.match(html, /tone-ok/);
  for (const row of view.subjects) assert.ok(row.line.length <= 30, row.line);
});

test("after the first read, a refresh is one GetReport: no inner page until one is due", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  for (let run = 0; run < 3; run += 1) {
    bg.advance(5 * 60_000);
    await bg.refresh("manual"); // timetable, then duty leave, then medical leave
  }
  const before = server.state.requests.length;
  bg.advance(60_000);
  const result = await bg.refresh("manual");
  assert.equal(result.error, undefined);
  assert.deepEqual(server.state.requests.slice(before), ["POST /frmStudentCourseWiseAttendanceSummary.aspx/GetReport"]);
  assert.equal(server.state.attendanceLoads, 1);
});

test("report ids that stop working fall back to the attendance page once", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  server.state.reportId = "NEW-ID=";
  bg.advance(60_000);
  const result = await bg.refresh("manual");
  assert.equal(result.error, undefined);
  assert.equal(server.state.attendanceLoads, 2);
  assert.equal(storage.data.attendanceMeta.reportId, "NEW-ID=");
});

test("a failed attempt also waits 30 seconds, so repeated presses send nothing", async () => {
  const server = fakeCuims({ signedIn: true, refuseAttendanceAfter: 0 });
  const storage = saved();
  const bg = daemon(server, storage);
  const first = await bg.refresh("manual");
  assert.equal(first.code, "report-shape");
  const count = server.state.requests.length;
  for (let press = 0; press < 5; press += 1) {
    bg.advance(3000);
    const again = await bg.refresh("manual");
    assert.ok(again.error);
  }
  assert.equal(server.state.requests.length, count);
});

test("a refused read backs off 1, 2, then 5 minutes and saves what CUIMS sent", async () => {
  const server = fakeCuims({ signedIn: true, refuseAttendanceAfter: 0 });
  const storage = saved();
  const bg = daemon(server, storage);
  const first = await bg.refresh("manual");
  assert.match(first.error, /Next try in 1 min/);
  assert.match(first.error, /CUIMS said “Please wait”/);
  assert.equal(storage.data.attendanceLastBad.title, "Please wait");
  assert.match(storage.data.attendanceLastBad.text, /Too many requests/);
  bg.advance(45_000);
  assert.equal((await bg.refresh("manual")).code, "backoff");
  assert.equal(server.state.attendanceLoads, 1);
  bg.advance(20_000);
  assert.match((await bg.refresh("manual")).error, /Next try in 2 min/);
  bg.advance(2 * 60_000 + 1000);
  assert.match((await bg.refresh("manual")).error, /Next try in 5 min/);
  assert.equal(server.state.attendanceLoads, 3);
});

test("a success clears the backoff", async () => {
  const server = fakeCuims({ signedIn: true, refuseAttendanceAfter: 0 });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  bg.advance(61_000);
  server.state.attendanceLoads = -10;
  const result = await bg.refresh("manual");
  assert.equal(result.error, undefined);
  assert.equal(storage.data.attendanceFailStreak, 0);
  assert.equal(storage.data.attendanceBackoffUntil, 0);
});

test("a successful duty-leave read establishes that the CUIMS session is alive", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  await daemon(server, storage).refresh("manual");
  assert.equal(server.state.leavePageLoads, 2, "duty and medical leave, both due");
  assert.equal(storage.data.sessionAlive, true);
  assert.equal(storage.data.sessionCheckedAt, MONDAY_11 + 6_000, "the medical leave page, six seconds on");
});

// ---- the CUIMS tab defers to the background ----

function contentRuntime(pathname = "/Login.aspx") {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  const writes = [];
  const context = vm.createContext({
    document: { documentElement: null, body: null, addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    location: { pathname },
    localStorage: storage,
    sessionStorage: storage,
    chrome: { storage: { onChanged: { addListener() {} }, local: { set: (values) => writes.push(values) } }, runtime: { sendMessage() {} } },
    Event: class {},
    console,
  });
  vm.runInContext(contentSource("firefox"), context);
  return { call: (code) => vm.runInContext(code, context), writes };
}

test("the login page holds its submit while the background is signing in", () => {
  const page = contentRuntime();
  page.call(`sharedLogin.bgSignInUntil = Date.now() + 30000`);
  assert.equal(page.call("canAutoSubmit().reason"), "background");
  page.call(`sharedLogin.bgSignInUntil = 0`);
  assert.equal(page.call("canAutoSubmit().ok"), true);
});

test("a background refusal leaves the login page its three tries, but a lockout stops it", () => {
  const page = contentRuntime();
  page.call(`sharedLogin.loginGuard = { failures: [{ at: Date.now(), by: "bg" }] }`);
  assert.equal(page.call("canAutoSubmit().ok"), true);
  page.call(`sharedLogin.loginGuard = { failures: [], lockoutUntil: Date.now() + 60000 }`);
  assert.equal(page.call("canAutoSubmit().reason"), "lockout");
});

test("a page auto-submit tells the background a tab login is in flight", () => {
  const page = contentRuntime();
  page.call("recordAutoSubmit(1234)");
  assert.equal(JSON.stringify(page.writes.at(-1)), JSON.stringify({ pageLoginAt: 1234 }));
});

test("landing on StudentHome tells the background the session is alive, once", () => {
  const page = contentRuntime("/StudentHome.aspx");
  page.call("requestAnimationFrame = () => {}; getComputedStyle = () => ({ display: 'block' }); NodeFilter = { SHOW_TEXT: 4 };");
  page.call("document.createTreeWalker = () => ({ nextNode: () => false }); scanPage(); scanPage();");
  const marks = page.writes.filter((values) => "sessionAlive" in values);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].sessionAlive, true);
});

test("an open leave page shares its list once, and again only when the list itself changes", () => {
  const grid = { textContent: "11 Pending", outerHTML: "<table id=\"gvHistory\"><tr><td>11</td><td>Pending</td></tr></table>" };
  const sent = [];
  const context = vm.createContext({
    document: { documentElement: null, body: null, addEventListener() {}, getElementById: (id) => (id === "gvHistory" ? grid : null), querySelector() { return null; }, querySelectorAll() { return []; } },
    location: { pathname: "/frmStudentApplyDutyLeave.aspx" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: { storage: { onChanged: { addListener() {} }, local: { set() {} } }, runtime: { sendMessage: (message) => sent.push(message) } },
    Event: class {},
    console,
  });
  vm.runInContext(contentSource("firefox"), context);
  vm.runInContext("shareLeavePage(); shareLeavePage();", context);
  grid.outerHTML = grid.outerHTML.replace("<table", "<table style=\"color:red\""); // a theme repaint
  vm.runInContext("shareLeavePage();", context);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].which, "dl");
  grid.textContent = "11 Pending 12 Pending";
  vm.runInContext("shareLeavePage();", context);
  assert.equal(sent.length, 2);
});

// ---- the CUIMS tab owns the session while it shows a login form ----

const loginTabOpen = (extra = {}) => saved({ loginTabAt: MONDAY_11 - 5_000, ...extra });
const loginRequests = (server) => server.state.requests.filter((line) => /^(GET|POST) \/(login\.aspx|generatecaptcha\.aspx)?$/i.test(line));

test("while a CUIMS tab is on the login page, a signed-out refresh gives way instead of signing in", async () => {
  const server = fakeCuims();
  const storage = loginTabOpen();
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.code, "tab-login");
  assert.equal(server.state.loginPageLoads, 0);
  assert.equal(server.state.uidPosts + server.state.loginPosts + server.state.captchaReads, 0);
  assert.deepEqual(loginRequests(server), []);
  assert.equal(storage.data.bgSignInUntil, undefined);
  assert.ok(storage.data.attendanceAfterTab);
});

test("a login tab does not stop a read that needs no sign-in", async () => {
  const server = fakeCuims({ signedIn: true });
  const result = await daemon(server, loginTabOpen()).refresh("manual");
  assert.equal(result.error, undefined);
  assert.equal(result.snapshot.subjects.length, 3);
});

test("a login tab that opens mid sign-in stops the background before its next login request", async () => {
  const server = fakeCuims();
  const storage = saved();
  const base = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    const answer = await base(target, options);
    if (/\/$/.test(new URL(target).pathname) && (options.method || "GET") === "GET") storage.data.loginTabAt = MONDAY_11;
    return answer;
  };
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.code, "tab-login");
  assert.equal(server.state.uidPosts, 0);
  assert.equal(server.state.loginPosts, 0);
  assert.equal(storage.data.bgSignInUntil, 0);
});

test("every background visit to the login flow is stamped for the tab", async () => {
  const server = fakeCuims();
  const storage = saved();
  await daemon(server, storage).refresh("manual");
  assert.equal(storage.data.bgLoginTouchAt, MONDAY_11);
});

test("a refresh that gave way runs again once the tab lands on StudentHome", async () => {
  const server = fakeCuims();
  const storage = loginTabOpen();
  const bg = daemon(server, storage);
  assert.equal((await bg.refresh("manual")).code, "tab-login");
  server.state.signedIn = true;
  storage.data.loginTabAt = 0;
  const after = await bg.afterTabSignIn();
  assert.equal(after.refreshed.snapshot.subjects.length, 3);
  assert.equal((await bg.afterTabSignIn()).skipped, true);
});

// ---- Open CUIMS / Open LMS reuse or create the browser's session ----

test("a network failure never holds Refresh back beyond the 30-second gap", async () => {
  const server = fakeCuims({ signedIn: true });
  let offline = true;
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), attendanceLeaves: leavesRead() });
  const bg = daemon({ fetchImpl: async (url, options) => {
    if (offline) throw new TypeError("Failed to fetch");
    return server.fetchImpl(url, options);
  } }, storage);
  for (let press = 0; press < 5; press += 1) {
    const result = await bg.refresh();
    assert.equal(result.code, "network");
    assert.equal(result.nextRefreshAt, MONDAY_11 + press * 30_000 + 30_000);
    bg.advance(30_000);
  }
  assert.equal(storage.data.attendanceBackoffUntil || 0, 0);
  offline = false;
  assert.equal((await bg.refresh()).error, undefined);
});

// ---- the login tab recovers from a captcha the background replaced ----

function loginPage({ issuedAt = 1_000, touchAt = 0, restarts = [] } = {}) {
  const store = new Map(restarts.length ? [["cuimsClear.loginRestarts", JSON.stringify(restarts)]] : []);
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  const assigned = [];
  const writes = [];
  const context = vm.createContext({
    document: { documentElement: null, body: null, addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    location: { pathname: "/Login.aspx", assign: (url) => assigned.push(url) },
    performance: { timeOrigin: issuedAt },
    localStorage: storage,
    sessionStorage: storage,
    chrome: { storage: { onChanged: { addListener() {} }, local: { set: (values) => writes.push(values) } }, runtime: { sendMessage() {} } },
    Event: class {},
    console,
  });
  vm.runInContext(contentSource("firefox"), context);
  vm.runInContext(`sharedLogin.bgLoginTouchAt = ${touchAt}`, context);
  return { call: (code) => vm.runInContext(code, context), assigned, store, writes };
}

test("a captcha drawn before the background touched the login flow is dead, so the tab starts over", () => {
  const page = loginPage({ issuedAt: 1_000, touchAt: 2_000 });
  assert.equal(page.call("backgroundTouchedSince(captchaIssuedAt(null))"), true);
  assert.equal(page.call("restartLogin(5000)"), true);
  assert.deepEqual(page.assigned, ["https://students.cuchd.in/"]);
});

test("a captcha drawn after the background's last touch is trusted", () => {
  const page = loginPage({ issuedAt: 3_000, touchAt: 2_000 });
  assert.equal(page.call("backgroundTouchedSince(captchaIssuedAt(null))"), false);
  assert.equal(loginPage({ issuedAt: 3_000, touchAt: 0 }).call("backgroundTouchedSince(captchaIssuedAt(null))"), false);
});

test("the tab restarts its login at most twice in two minutes", () => {
  const now = 200_000;
  const page = loginPage({ restarts: [now - 10_000, now - 5_000] });
  assert.equal(page.call(`restartLogin(${now})`), false);
  assert.deepEqual(page.assigned, []);
  assert.equal(loginPage({ restarts: [now - 130_000, now - 5_000] }).call(`restartLogin(${now})`), true);
});

test("a refusal of a captcha the background replaced does not count against auto-login", () => {
  const page = loginPage({ issuedAt: 1_000, touchAt: 2_000 });
  page.call("recordAutoSubmit()");
  page.call(`sessionStorage.setItem("cuimsClear.submitCaptchaAt", "1000")`);
  assert.equal(page.call("submittedCaptchaWasReplaced()"), true);
  page.call("releaseRecentAutoSubmit()");
  assert.equal(page.call("readFailureState().failures"), 0);
});

// ---- CUIMS's landing step ----

test("a background sign-in finishes CUIMS's landing step, so attendance opens instead of error.html", async () => {
  const server = fakeCuims();
  const result = await daemon(server, saved()).refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.equal(server.state.landingCalls, 1);
  assert.equal(result.snapshot.subjects.length, 3);
});

test("CUIMS's page limit on the attendance page is waited out: no sign-in, last read kept, fifteen minutes, then thirty", async () => {
  const server = fakeCuims({ signedIn: true, limited: true });
  const storage = saved({ attendanceSnapshot: { fetchedAt: new Date(MONDAY_11 - 3_600_000).toISOString(), subjects: [{ code: "X", title: "X", attended: 1, delivered: 1 }] } });
  const bg = daemon(server, storage);
  const result = await bg.refresh("manual");
  assert.equal(result.code, "page-limit");
  assert.match(result.error, /limiting page loads.*Showing your last read.*15 min/);
  assert.equal(result.nextRefreshAt, MONDAY_11 + 15 * 60_000);
  assert.equal(result.snapshot.subjects.length, 1);
  assert.equal(server.state.loginPosts + server.state.uidPosts + server.state.landingCalls, 0);
  assert.equal(storage.data.attendanceBackoffUntil || 0, 0, "only pages wait");
  const sent = server.state.requests.length;
  bg.advance(60_000);
  const again = await bg.refresh("manual");
  assert.equal(again.code, "page-limit");
  assert.match(again.error, /Next try in 14 min\.$/);
  assert.equal(server.state.requests.length, sent, "no page and no sign-in while it lasts");
  bg.advance(14 * 60_000);
  assert.equal((await bg.refresh("manual")).code, "page-limit");
  assert.equal(storage.data.pagesPausedUntil, MONDAY_11 + 45 * 60_000, "limited again soon after: thirty minutes");
  server.state.limited = false;
  bg.advance(30 * 60_000);
  const ok = await bg.refresh("manual");
  assert.equal(ok.error, undefined, ok.error);
  assert.equal(ok.snapshot.subjects.length, 3);
  assert.equal(storage.data.pagesPauseStreak, 0);
});

// The screenshot behind 0.10.3: 0.9.7 took the limited duty leave page's
// redirect for a signed-out session, signed in, met the redirect again and
// said "CUIMS accepted the login but did not keep the session", dropping
// the attendance it had just read.
test("a duty-leave page CUIMS refuses (error.html) is never a reason to sign in or to probe Home: attendance stays fresh, pages pause", async () => {
  const server = fakeCuims({ signedIn: true, limited: true });
  const old = { fetchedAt: new Date(MONDAY_11 - 3_600_000).toISOString(), subjects: [{ code: "X", title: "X", attended: 1, delivered: 1 }] };
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), attendanceSnapshot: old });
  const bg = daemon(server, storage);
  const result = await bg.refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.snapshot.subjects.length, 3, "the report calls answered, so the read is fresh");
  assert.deepEqual(pagesOf(server), [`GET ${A.LEAVE_PAGES.dl}`], "no Home check, no sign-in, no second page");
  assert.equal(server.state.uidPosts + server.state.loginPosts + server.state.captchaReads + server.state.loginPageLoads, 0);
  assert.equal(storage.data.pagesPausedUntil, MONDAY_11 + 15 * 60_000, "a refusal, not a sign-out");
  assert.equal(storage.data.attendanceBackoffUntil || 0, 0);
  bg.advance(10 * 60_000);
  assert.equal((await bg.refresh("manual")).error, undefined);
  assert.equal(pagesOf(server).length, 1, "no page while paused");
  // The student opens CUIMS and its menu loads.
  server.state.limited = false;
  const seen = MONDAY_11 + 10 * 60_000;
  Object.assign(storage.data, { tabPageAt: seen, tabMenuOkAt: seen, sessionAlive: true, sessionCheckedAt: seen });
  bg.advance(5 * 60_000);
  await bg.refresh("manual");
  assert.equal(server.state.leavePageLoads, 2, "duty and medical leave, six seconds apart");
  assert.equal(server.state.loginPosts, 0);
});

test("a CUIMS tab sent to error.html holds the background's pages and sign-ins for fifteen minutes", async () => {
  const server = fakeCuims({ signedIn: false });
  const storage = saved({ tabLimitedAt: MONDAY_11 - 60_000 });
  const bg = daemon(server, storage);
  const result = await bg.refresh("manual");
  assert.equal(result.code, "page-limit");
  assert.match(result.error, /Next try in 14 min\.$/);
  assert.equal(server.state.requests.length, 0);
  assert.equal(storage.data.pagesPausedUntil || 0, 0, "a local pause does not manufacture another server refusal");
  bg.advance(14 * 60_000);
  const ok = await bg.refresh("manual");
  assert.equal(ok.error, undefined, ok.error);
  assert.equal(server.state.loginPosts, 1);
});

test("the first read loads the timetable right after the attendance page, six seconds apart, and no leave page beside it", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  const first = await bg.refresh("manual");
  assert.equal(first.error, undefined, first.error);
  assert.deepEqual(pagesOf(server), ["GET /frmStudentCourseWiseAttendanceSummary.aspx", "GET /frmMyTimeTable.aspx"]);
  assert.deepEqual(bg.sleeps, [6_000]);
  assert.ok(first.snapshot.slots.length > 0);
  assert.equal(first.snapshot.timetableDueAt, undefined);
  assert.equal(storage.data.attendanceTimetable.session, "25262");
});

test("the timetable is kept for a week, then read again five minutes clear of the last page", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceLeaves: leavesRead(MONDAY_11 + 8 * 24 * 60 * 60_000), attendanceTimetable: freshTimetable(MONDAY_11 - 6 * 24 * 60 * 60_000), tabPageAt: MONDAY_11 - 60_000 });
  const bg = daemon(server, storage);
  const timetableLoads = () => server.state.requests.filter((line) => /frmmytimetable/i.test(line)).length;
  await bg.refresh();
  assert.equal(timetableLoads(), 0, "six days old is still this week's");
  bg.advance(24 * 60 * 60_000);
  storage.data.tabPageAt = MONDAY_11 + 24 * 60 * 60_000 - 60_000;
  await bg.refresh();
  assert.equal(timetableLoads(), 0, "a CUIMS tab was in use a minute ago");
  bg.advance(4 * 60_000);
  await bg.refresh();
  assert.equal(timetableLoads(), 1);
  bg.advance(60 * 60_000);
  await bg.refresh();
  assert.equal(timetableLoads(), 1, "kept for another week");
});

test("a new semester's report session reads the timetable again", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceLeaves: leavesRead(), attendanceTimetable: { ...freshTimetable(), session: "25261" } });
  await daemon(server, storage).refresh();
  assert.equal(server.state.requests.filter((line) => /frmmytimetable/i.test(line)).length, 1);
  assert.equal(storage.data.attendanceTimetable.session, "25262");
});

test("a first timetable that CUIMS refuses is due again once the pause and the hourly retry are over", async () => {
  const server = fakeCuims({ signedIn: true, limited: "menu" });
  const storage = saved({ attendanceMeta: META, attendanceLeaves: leavesRead() });
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.equal(storage.data.pagesPausedUntil, MONDAY_11 + 15 * 60_000);
  assert.equal(result.snapshot.timetableDueAt, MONDAY_11 + 60 * 60_000, "the hourly retry is the later");
});

test("a refused timetable keeps the read, holds pages for fifteen minutes and is retried after an hour", async () => {
  const server = fakeCuims({ signedIn: true, limited: "menu" });
  const storage = saved({ attendanceMeta: META, attendanceLeaves: leavesRead() });
  const bg = daemon(server, storage);
  const first = await bg.refresh();
  assert.equal(first.error, undefined, first.error);
  assert.equal(first.snapshot.subjects.length, 3);
  assert.equal(storage.data.attendanceBackoffUntil || 0, 0);
  assert.equal(storage.data.pagesPausedUntil, MONDAY_11 + 15 * 60_000);
  const timetableLoads = () => server.state.requests.filter((line) => /frmmytimetable/i.test(line)).length;
  assert.equal(timetableLoads(), 1);
  bg.advance(10 * 60_000);
  assert.equal((await bg.refresh()).error, undefined);
  assert.equal(timetableLoads(), 1);
  assert.equal(server.state.limitedHits, 1, "no page while paused");
  server.state.limited = false;
  bg.advance(60 * 60_000);
  await bg.refresh();
  assert.equal(timetableLoads(), 2);
  assert.ok(storage.data.attendanceTimetable.slots.length > 0);
});

test("an expired session signs in once for due leave: attendance reads first, then the leave page in a fresh session", async () => {
  const server = fakeCuims({ signedIn: false });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  const bg = daemon(server, storage);
  const dutyLeaveLoads = () => server.state.requests.filter((line) => line === `GET ${A.LEAVE_PAGES.dl}`).length;
  const result = await bg.refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.snapshot.subjects.length, 3);
  assert.equal(server.state.cookiedReports, 0, "report calls remain anonymous");
  // The leave page met the login page, so the read signed in (one submit)
  // and loaded it again.
  assert.equal(server.state.loginPosts, 1);
  assert.equal(dutyLeaveLoads(), 2);
  assert.ok(result.snapshot.leaves.checkedAt);
  assert.equal(storage.data.sessionAlive, true, "the browser now holds a live session for Open CUIMS");
  // Every page six seconds or more after the one before.
  const pages = server.state.requests.filter((line) => A.isInnerPage(`https://students.cuchd.in${line.split(" ")[1]}`));
  assert.ok(pages.length <= 4, pages.join(", "));
  // Known signed out (a sign-out seen since): the next due page signs in
  // first, without spending a request to find out.
  Object.assign(storage.data, { sessionAlive: false, sessionCheckedAt: MONDAY_11 + 60_000 });
  server.state.signedIn = false;
  bg.advance(25 * 60 * 60_000);
  const before = dutyLeaveLoads();
  await bg.refresh("manual");
  assert.equal(dutyLeaveLoads(), before + 1, "one leave load, after the sign-in");
  assert.equal(server.state.loginPosts, 2);
});

// ---- nothing runs on a timer ----

test("the background has no timer: no alarms permission, no alarm, no scheduled work", () => {
  for (const build of ["firefox", "chrome"]) {
    const root = new URL(`../outputs/cuims-clear-${build}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
    assert.equal(manifest.permissions.includes("alarms"), false, build);
    for (const name of ["attendance-bg.js", "attendance-daemon.js", "lms-open.js", "captcha-solver.js"]) {
      assert.doesNotMatch(readFileSync(new URL(name, root), "utf8"), /chrome\.alarms|setInterval/, `${build}/${name}`);
    }
  }
  const bg = daemon(fakeCuims({ signedIn: true }), saved());
  assert.equal(typeof bg.tick, "undefined");
});

// ---- goals, wording, relative time ----

test("the 90%-every-subject goal counts skips per subject only, with no overall rule", () => {
  const snapshot = { subjects: [
    { code: "A", title: "A", attended: 19, delivered: 20 },
    { code: "B", title: "B", attended: 17, delivered: 20 },
  ] };
  const view = A.buildAnalytics(snapshot, new Date(MONDAY_11), { goal: "strict" });
  const a = view.subjects.find((row) => row.code === "A");
  const b = view.subjects.find((row) => row.code === "B");
  assert.equal(a.skip, A.maxMisses(19, 20, 0.9));
  assert.equal(a.limitedByOverall, false);
  assert.equal(b.recover, A.classesToRecover(17, 20, 0.9));
  assert.equal(b.line, `Attend next ${b.recover} to reach 90%`);
  assert.equal(b.tone, "low");
  assert.equal(view.overall.line, "1 subject under 90%");
  assert.doesNotMatch(JSON.stringify(view.subjects.map((row) => row.line)), /cap/);
});

test("a subject held back by the overall rule says so in plain words", () => {
  const view = A.buildAnalytics({ subjects: [
    { code: "A", title: "A", attended: 20, delivered: 20 },
    { code: "B", title: "B", attended: 80, delivered: 100 },
  ] }, new Date(MONDAY_11));
  assert.equal(view.subjects.find((row) => row.code === "A").line, "No skips (overall under 90%)");
});

test("the last update also reads as time ago", () => {
  const now = new Date(MONDAY_11);
  const iso = (minutes) => new Date(MONDAY_11 - minutes * 60_000).toISOString();
  assert.equal(A.ago(iso(0), now), "just now");
  assert.equal(A.ago(iso(8), now), "8 min ago");
  assert.equal(A.ago(iso(130), now), "2 h ago");
  assert.equal(A.ago(iso(26 * 60), now), "yesterday");
  const html = A.renderAttendance(A.buildAnalytics({ fetchedAt: iso(130), subjects: [{ code: "A", title: "A", attended: 9, delivered: 10 }] }, now), { now });
  assert.match(html, /Updated [^<]+\(2 h ago\)/);
});

// ---- real CUIMS mark and leave shapes ----

test("marks read the real CUIMS codes and dates, including leave", () => {
  const marks = A.normalizeMarks([
    { AttDate: "Monday, 28 Sep 2026", AttendanceDate: "/Date(1790533800000)/", Timing: "10:20 - 11:10 AM", AttendanceCode: "P" },
    { AttDate: "Monday, 28 Sep 2026", Timing: "12:00 - 12:50 PM", AttendanceCode: "A" },
    { AttDate: "Thursday, 24 Sep 2026", AttendanceCode: "Absent (VDL -Departmental Society Activities)" },
    { AttDate: "Friday, 18 Sep 2026", AttendanceCode: "Absent (Medical Leave)" },
  ]);
  assert.deepEqual(marks.map((mark) => mark.kind), ["present", "absent", "dl", "ml"]);
  assert.equal(A.parseDateKey(marks[0].date), "2026-09-28");
  assert.equal(A.parseDateKey(marks[1].date), "2026-09-28");
});

test("leave history grids parse into days, class times, and state", () => {
  const dl = A.parseDutyLeaves(dutyLeavePage([
    { id: 11, timing: "2:30 - 3:20 PM,3:20 - 4:10 PM", dated: "25 Sep 2026", status: "Pending" },
    { id: 12, type: "Day Bases", dated: "From 03 Sep 2026 To 04 Sep 2026", status: "Recommend and Approved" },
    { id: 13, timing: "9:40 - 10:20 AM", dated: "01 Sep 2026", status: "Rejected" },
  ]));
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(dl.map((leave) => leave.state)), ["pending", "approved", "rejected"]);
  assert.deepEqual(plain(dl[0].days), ["2026-09-25"]);
  assert.deepEqual(plain(dl[0].timings), ["2:30 - 3:20 PM", "3:20 - 4:10 PM"]);
  assert.deepEqual(plain(dl[1].days), ["2026-09-03", "2026-09-04"]);
  const ml = A.parseMedicalLeaves(medicalLeavePage([{ from: "14 Sep 2026", to: "16 Sep 2026", status: "Medical Leave is Approved" }, { from: "28 Sep 2026", to: "28 Sep 2026", status: "Pending at HOD" }]));
  assert.deepEqual(plain(ml.map((leave) => [leave.state, leave.days.length])), [["approved", 3], ["pending", 1]]);
});

// ---- pending leave, end to end ----

const LEAVE_DAY_MARK = { course: "enc305", AttDate: "Friday, 25 Sep 2026", Timing: "2:30 - 3:20 PM", AttendanceCode: "A" };

test("a pending duty leave is matched to the absent class it covers, and shows what approval would do", async () => {
  const server = fakeCuims({ signedIn: true, marksToday: [LEAVE_DAY_MARK], dutyLeaves: [{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }] });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual({ ...result.snapshot.leaves.pending["24CSP305"] }, { vdl: 1, idl: 0, adl: 0, ml: 0 });
  const view = A.buildAnalytics(result.snapshot, new Date(MONDAY_11));
  const cc = view.subjects.find((row) => row.code === "24CSP-305");
  assert.equal(cc.leave.pending.dl, 1);
  assert.equal(Math.round(cc.ifApproved * 10), Math.round((26 / 31) * 1000));
  assert.equal(view.overall.leave.pending.dl, 1);
  assert.ok(view.overall.ifApproved > view.overall.percent);
});

test("a read loads at most two optional pages (one beside the attendance page), five minutes clear of the last; each leave page once, then daily", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  const count = (path) => server.state.requests.filter((line) => line === `GET ${path}`).length;
  const pageTimes = [];
  // A press every minute for four hours.
  for (let minute = 0; minute < 4 * 60; minute += 1) {
    const before = pagesOf(server).length;
    assert.equal((await bg.refresh("manual")).error, undefined);
    const loaded = pagesOf(server).length - before;
    // The very first read: the attendance page, then the first timetable.
    // Five minutes on: duty and medical leave, six seconds apart.
    assert.ok(loaded <= 2, `minute ${minute}: ${pagesOf(server).slice(before).join(", ")}`);
    if (loaded) pageTimes.push(minute);
    bg.advance(60_000);
  }
  assert.deepEqual(pageTimes, [0, 5]);
  assert.equal(server.state.attendanceLoads, 1);
  assert.equal(count(A.LEAVE_PAGES.dl), 1);
  assert.equal(count(A.LEAVE_PAGES.ml), 1);
  assert.equal(pagesOf(server).length, 4);
});

test("a pending duty leave is checked every three hours; without one, daily", async () => {
  const server = fakeCuims({ signedIn: true, dutyLeaves: [{ id: 11, dated: "25 Sep 2026", status: "Pending" }] });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), attendanceLeaves: { ...leavesRead(MONDAY_11 - 25 * 60 * 60_000), mlAt: MONDAY_11 } });
  const bg = daemon(server, storage);
  const dl = () => server.state.requests.filter((line) => line === `GET ${A.LEAVE_PAGES.dl}`).length;
  await bg.refresh();
  assert.equal(dl(), 1, "a day since the last look");
  bg.advance(2 * 60 * 60_000);
  await bg.refresh();
  assert.equal(dl(), 1);
  bg.advance(60 * 60_000);
  await bg.refresh();
  assert.equal(dl(), 2, "pending: three hours on");
  server.state.summary[0].Total_Attd = String(Number(server.state.summary[0].Total_Attd) + 1);
  bg.advance(3 * 60 * 60_000);
  await bg.refresh();
  assert.equal(dl(), 3);
});

test("a duty-leave approval shows on the next Refresh from the free calls, without the leave page", async () => {
  const dutyLeaves = [{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }];
  const leaveMark = { ...LEAVE_DAY_MARK };
  const server = fakeCuims({ signedIn: true, marksToday: [leaveMark], dutyLeaves });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  const bg = daemon(server, storage);
  const marksCalls = () => server.state.requests.filter((line) => /getfullreport/i.test(line)).length;
  const first = await bg.refresh("manual");
  assert.equal(first.snapshot.leaves.pending["24CSP305"].vdl, 1);
  // Nothing moved: the recount uses the stored class record, no request.
  const calls = marksCalls();
  bg.advance(60_000);
  assert.equal((await bg.refresh("manual")).snapshot.leaves.pending["24CSP305"].vdl, 1);
  assert.equal(marksCalls(), calls);
  // Approved: the absent mark becomes a leave mark and the counts move.
  dutyLeaves[0].status = "Recommend and Approved";
  leaveMark.AttendanceCode = "Absent (VDL -Departmental Society Activities)";
  Object.assign(server.state.summary[0], { Total_Delv: "31", EligibilityDelivered: "31" });
  bg.advance(60_000);
  const next = await bg.refresh("manual");
  assert.deepEqual({ ...next.snapshot.leaves.pending }, {});
  assert.equal(server.state.leavePageLoads, 2, "the first read's duty and medical leave; neither reloaded");
  const view = A.buildAnalytics(next.snapshot, new Date(MONDAY_11 + 2 * 60_000));
  assert.equal(view.overall.leave.pending.dl, 0);
  assert.doesNotMatch(A.renderAttendance(view), /open Duty Leave/);
});

test("an approval on a subject with no class today is found by re-reading only that subject", async () => {
  const dutyLeaves = [{ id: 12, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }];
  const leaveMark = { ...LEAVE_DAY_MARK, course: "enc312" };
  const server = fakeCuims({ signedIn: true, marksToday: [leaveMark], dutyLeaves });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  const bg = daemon(server, storage);
  const first = await bg.refresh("manual");
  assert.equal(first.snapshot.leaves.pending["24TDT312"].vdl, 1);
  leaveMark.AttendanceCode = "Absent (VDL -Departmental Society Activities)";
  Object.assign(server.state.summary[2], { Total_Delv: "15", EligibilityDelivered: "15" });
  // Our own budget leaves the Forecast tab no history reads this time.
  storage.data.attendanceRequests = Array(12).fill(MONDAY_11 + 30_000);
  const before = server.state.requests.length;
  bg.advance(60_000);
  const next = await bg.refresh("manual");
  assert.deepEqual({ ...next.snapshot.leaves.pending }, {});
  assert.deepEqual(server.state.requests.slice(before), ["POST /frmStudentCourseWiseAttendanceSummary.aspx/GetReport", "POST /frmStudentCourseWiseAttendanceSummary.aspx/GetFullReport"]);
});

test("a refused duty leave stays pending until the leave page is read again, three hours on", async () => {
  const dutyLeaves = [{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }];
  const server = fakeCuims({ signedIn: true, marksToday: [LEAVE_DAY_MARK], dutyLeaves });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  dutyLeaves[0].status = "Not Recommend";
  bg.advance(60 * 60_000);
  assert.equal((await bg.refresh("manual")).snapshot.leaves.pending["24CSP305"].vdl, 1);
  bg.advance(2 * 60 * 60_000);
  const later = await bg.refresh("manual");
  assert.deepEqual({ ...later.snapshot.leaves.pending }, {});
  assert.equal(server.state.requests.filter((line) => line === `GET ${A.LEAVE_PAGES.dl}`).length, 2);
});

test("opening a leave page on CUIMS keeps it with no request of ours; the next Refresh counts it", async () => {
  const pendingLeave = [{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }];
  const server = fakeCuims({ signedIn: true, marksToday: [LEAVE_DAY_MARK], dutyLeaves: pendingLeave });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceCourses: { "24CSP305": "enc305" }, attendanceSnapshot: { fetchedAt: new Date(MONDAY_11).toISOString(), subjects: [] } });
  const bg = daemon(server, storage);
  await bg.ingestLeavePage("dl", dutyLeavePage(pendingLeave));
  assert.equal(server.state.requests.length, 0, "reads happen only on Refresh");
  assert.equal(storage.data.attendanceLeaves.apps.dl.length, 1);
  await bg.refresh("manual");
  assert.deepEqual({ ...storage.data.attendanceSnapshot.leaves.pending["24CSP305"] }, { vdl: 1, idl: 0, adl: 0, ml: 0 });
});

// ---- the attendance tab ----

test("the attendance tab shows the goal switch and subjects, and leaves skip planning to Forecast", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const snapshot = { fetchedAt: new Date(at(12, 30)).toISOString(), marksDay: "2026-09-28", slots, subjects: [
    { code: "24CSP-305", title: "Competitive Coding-II", attended: 26, delivered: 32 },
    { code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 },
  ] };
  const view = A.buildAnalytics(snapshot, new Date(at(12, 30)));
  const html = A.renderAttendance(view, { now: new Date(at(12, 30)) });
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /data-goal="strict"/);
  assert.doesNotMatch(html, /data-plan-key=/);
  assert.doesNotMatch(html, /Today · Mon/);
  assert.doesNotMatch(html, /overall cap/);
  assert.equal(view.today, undefined);
});

// ---- VDL allowance per subject ----

test("\"Not Recommend\" and cancelled duty leave are refused, not pending (real CUIMS statuses)", () => {
  const states = ["Recommend and Approved", "Not Recommend", "Cancel By You on 25 Sep 2026", "Not Approved", "Recommended", "Pending"].map(A.leaveState);
  assert.deepEqual(states, ["approved", "rejected", "rejected", "rejected", "pending", "pending"]);
});

test("pending leave counted by 0.8.0's parser is ignored until the leave pages are read again", () => {
  const snapshot = {
    subjects: [{ code: "A-1", title: "Alpha", attended: 30, delivered: 32, leave: { vdl: 6, idl: 0, adl: 0, ml: 0 } }],
    leaves: { checkedAt: new Date(MONDAY_11).toISOString(), pending: { A1: { vdl: 4, idl: 0, adl: 0, ml: 0 } } },
  };
  const view = A.buildAnalytics(snapshot, new Date(MONDAY_11));
  assert.equal(view.subjects[0].leave.pending.dl, 0);
  assert.equal(view.subjects[0].leave.vdlLeft, 4);
  assert.equal(view.overall.ifApproved, null);
  assert.equal(view.leavesCheckedAt, null);
});

test("each subject shows its VDL left as 10 minus CUIMS's VDL column; pending applications do not take a slot", () => {
  const snapshot = {
    subjects: [
      { code: "A-1", title: "Alpha", attended: 30, delivered: 32, leave: { vdl: 6, idl: 0, adl: 0, ml: 2 } },
      { code: "B-1", title: "Beta", attended: 30, delivered: 32, leave: { vdl: 9, idl: 0, adl: 0, ml: 0 } },
      { code: "C-1", title: "Gamma", attended: 30, delivered: 32, leave: { vdl: 10, idl: 0, adl: 0, ml: 0 } },
    ],
    leaves: { v: A.LEAVES_VERSION, checkedAt: new Date(MONDAY_11).toISOString(), pending: { A1: { vdl: 1, idl: 0, adl: 0, ml: 1 } } },
  };
  const view = A.buildAnalytics(snapshot, new Date(MONDAY_11));
  const left = Object.fromEntries(view.subjects.map((row) => [row.code, row.leave.vdlLeft]));
  assert.deepEqual(left, { "A-1": 4, "B-1": 1, "C-1": 0 });
  const html = A.renderAttendance(view, { now: new Date(MONDAY_11) });
  assert.match(html, /VDL 4 left · 1 pending/);
  assert.match(html, /ML 1 pending/);
  assert.match(html, /tag-vdl is-low[^>]*>VDL 1 left/);
  assert.match(html, /tag-vdl is-out[^>]*>VDL 0 left/);
  assert.match(html, /fewest left: Gamma \(0\)/);
});

test("pending duty leave is sorted into VDL, IDL, or ADL by its category", () => {
  const page = `<table id="gvHistory"><tr><th>DL_No</th><th>Timing</th><th>Category</th><th>File Name</th><th>Leave_Type</th><th>Dated</th><th>Status</th><th>Remarks</th></tr>
    <tr><td>1</td><td>9:40 - 10:20 AM</td><td>Departmental Society Activities</td><td></td><td>Lecture Bases</td><td>25 Sep 2026</td><td>Pending</td><td></td></tr>
    <tr><td>2</td><td>9:40 - 10:20 AM</td><td>Industrial Visit</td><td></td><td>Lecture Bases</td><td>25 Sep 2026</td><td>Pending</td><td></td></tr>
    <tr><td>3</td><td>9:40 - 10:20 AM</td><td>Assigned Duty</td><td></td><td>Lecture Bases</td><td>25 Sep 2026</td><td>Pending</td><td></td></tr></table>`;
  assert.deepEqual(JSON.parse(JSON.stringify(A.parseDutyLeaves(page).map((leave) => leave.dlType))), ["vdl", "idl", "adl"]);
});

// ---- conservative traffic policy ----

test("a refresh at 29 seconds reuses cache, including after a background restart; 30 seconds may fetch", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh();
  const count = server.state.requests.length;
  const restarted = daemon(server, storage, { clock: MONDAY_11 + 29_000 });
  assert.equal((await restarted.refresh()).recent, true);
  assert.equal(server.state.requests.length, count);
  restarted.advance(1000);
  assert.equal((await restarted.refresh()).recent, undefined);
  assert.ok(server.state.requests.length > count);
});

test("HTTP 429 is a portal throttle and holds refreshes for five minutes", async () => {
  let requests = 0;
  const storage = saved();
  const server = { fetchImpl: async (url) => {
    requests += 1;
    return { status: 429, url, text: async () => "Too many requests" };
  } };
  const bg = daemon(server, storage);
  assert.equal((await bg.refresh()).code, "portal-busy");
  assert.equal(storage.data.attendanceBackoffUntil, MONDAY_11 + 5 * 60_000);
  bg.advance(60_000);
  assert.equal((await bg.refresh()).code, "backoff");
  assert.equal(requests, 1);
});

test("a known page refusal holds background pages while reports still refresh", async () => {
  const server = fakeCuims({ signedIn: true, limited: "menu" });
  const storage = saved({ attendanceMeta: META });
  const bg = daemon(server, storage);
  assert.equal((await bg.refresh()).error, undefined);
  assert.deepEqual(pagesOf(server), ["GET /frmMyTimeTable.aspx"], "one refused page, and no Home check to tell why");
  bg.advance(6 * 60_000);
  const until = storage.data.pagesPausedUntil;
  const sent = server.state.requests.length;
  assert.equal((await bg.refresh()).error, undefined);
  assert.deepEqual(server.state.requests.slice(sent), ["POST /frmStudentCourseWiseAttendanceSummary.aspx/GetReport"], "duty leave is due but waits out the pause");
  assert.equal(storage.data.pagesPausedUntil, until, "a held page does not extend the pause");
  assert.equal(server.state.uidPosts + server.state.loginPosts + server.state.captchaReads, 0);
});

test("Retry-After extends the portal cooldown and survives a background restart", async () => {
  let requests = 0;
  const storage = saved();
  const server = { fetchImpl: async (url) => {
    requests += 1;
    return { status: 429, url, headers: new Headers({ "retry-after": "600" }) };
  } };
  await daemon(server, storage).refresh();
  assert.equal(storage.data.attendanceBackoffUntil, MONDAY_11 + 10 * 60_000);
  const restarted = daemon(server, storage, { clock: MONDAY_11 + 5 * 60_000 });
  assert.equal((await restarted.refresh()).code, "backoff");
  assert.equal(requests, 1);
});

test("report calls and CUIMS session requests have separate local budgets that survive a restart", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), attendanceSessionRequests: Array(10).fill(MONDAY_11) });
  const read = await daemon(server, storage).refresh();
  assert.equal(read.error, undefined, "attendance is report calls, outside the session budget");
  assert.equal(server.state.leavePageLoads, 0, "the optional page waits for room");
  storage.data.attendanceRequests = Array(60).fill(MONDAY_11);
  storage.data.attendanceLastAttemptAt = 0;
  assert.equal((await daemon(server, storage).refresh()).code, "busy");
  const later = daemon(server, storage, { clock: MONDAY_11 + 10 * 60_000 + 1 });
  assert.equal((await later.refresh()).error, undefined);
  assert.ok(storage.data.attendanceRequests.length < 60);
  assert.equal(server.state.leavePageLoads, 2, "the session budget has room again too");
});

test("leave ingestion waits for a read in progress and cannot overwrite its budget", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), attendanceLeaves: leavesRead() });
  let release;
  let entered;
  const ready = new Promise((resolve) => (entered = resolve));
  const gate = new Promise((resolve) => (release = resolve));
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    if (target.endsWith("/GetReport")) {
      entered();
      await gate;
    }
    return original(target, options);
  };
  const bg = daemon(server, storage);
  const reading = bg.refresh();
  await ready;
  const ingest = bg.ingestLeavePage("dl", dutyLeavePage([{ id: 11, dated: "25 Sep 2026", status: "Pending" }]));
  await Promise.resolve();
  assert.equal(storage.data.attendanceLeaves.apps.dl.length, 0, "the ingest waits its turn");
  release();
  await Promise.all([reading, ingest]);
  assert.equal(storage.data.attendanceLeaves.apps.dl.length, 1);
  // Ingesting makes no request; the read's report calls are all kept.
  assert.equal(storage.data.attendanceRequests.length, server.state.requests.filter((line) => /\/Get(Full)?Report$/.test(line)).length);
});

test("a marks throttle keeps the totals just read and stops the rest of the read", async () => {
  const server = fakeCuims({ signedIn: true });
  const base = server.fetchImpl;
  server.fetchImpl = async (url, options) => {
    if (url.endsWith("/GetFullReport")) {
      server.state.requests.push("POST /GetFullReport");
      return { status: 429, url };
    }
    return base(url, options);
  };
  const snapshot = { fetchedAt: new Date(MONDAY_11 - 60_000).toISOString(), subjects: [{ code: "X", title: "X", attended: 1, delivered: 1 }] };
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), attendanceLeaves: leavesRead(), attendanceSnapshot: snapshot });
  const result = await daemon(server, storage).refresh();
  assert.equal(result.code, "portal-busy");
  assert.equal(result.snapshot.subjects.length, 3, "the fresh totals stand");
  assert.equal(result.snapshot.fetchedAt, new Date(MONDAY_11).toISOString());
  assert.equal(server.state.leavePageLoads, 0);
  assert.equal(server.state.requests.length, 2);
});

test("refresh is visibly paused for cached and empty states, then becomes available", () => {
  const now = new Date(MONDAY_11);
  const view = A.buildAnalytics({ fetchedAt: now.toISOString(), subjects: [{ code: "X", title: "X", attended: 1, delivered: 1 }] }, now);
  for (const analytics of [view, null]) {
    assert.match(A.renderAttendance(analytics, { now, nextRefreshAt: MONDAY_11 + 60_000 }), /id="fetch-attendance"[^>]* disabled>Refresh in 1 min/);
    assert.doesNotMatch(A.renderAttendance(analytics, { now, nextRefreshAt: MONDAY_11 }), /id="fetch-attendance"[^>]* disabled/);
  }
});

test("a throttled cached summary does not fall back to opening the heavy attendance page", async () => {
  let requests = 0;
  const server = { fetchImpl: async (url) => { requests += 1; return { status: 429, url }; } };
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" } });
  const result = await daemon(server, storage).refresh();
  assert.equal(result.code, "portal-busy");
  assert.equal(requests, 1);
});


test("the pause message counts down and stops telling users to wait after it expires", () => {
  const state = { code: "portal-busy", error: "CUIMS is limiting requests right now. Next try in 5 min.", nextRefreshAt: MONDAY_11 + 5 * 60_000 };
  assert.match(A.renderAttendance(null, { ...state, now: new Date(MONDAY_11 + 3 * 60_000) }), /Next try in 2 min/);
  const ready = A.renderAttendance(null, { ...state, now: new Date(MONDAY_11 + 5 * 60_000) });
  assert.match(ready, /You can refresh now/);
  assert.doesNotMatch(ready, /Next try in/);
});


test("a duty-leave throttle keeps the fresh totals and blocks all further work", async () => {
  const server = fakeCuims({ signedIn: true });
  const base = server.fetchImpl;
  server.fetchImpl = async (url, options) => {
    if (url.endsWith(A.LEAVE_PAGES.dl)) {
      server.state.requests.push(`GET ${A.LEAVE_PAGES.dl}`);
      return { status: 429, url };
    }
    return base(url, options);
  };
  const snapshot = { fetchedAt: new Date(MONDAY_11 - 60_000).toISOString(), subjects: [] };
  const storage = saved({ attendanceMeta: META, attendanceTimetable: { day: "2026-09-28", slots: [], triedAt: MONDAY_11 }, attendanceSnapshot: snapshot });
  const bg = daemon(server, storage);
  const result = await bg.refresh();
  assert.equal(result.code, "portal-busy");
  assert.equal(result.snapshot.subjects.length, 3);
  assert.deepEqual(server.state.requests, ["POST /frmStudentCourseWiseAttendanceSummary.aspx/GetReport", `GET ${A.LEAVE_PAGES.dl}`]);
  const sent = server.state.requests.length;
  bg.advance(60_000);
  assert.equal((await bg.refresh()).code, "backoff");
  assert.equal(server.state.requests.length, sent);
});

test("a spent session budget skips the optional page and still reads attendance", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceSessionRequests: Array(10).fill(MONDAY_11), attendanceMeta: META, attendanceTimetable: freshTimetable() });
  const result = await daemon(server, storage).refresh();
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.snapshot.subjects.length, 3);
  assert.equal(server.state.leavePageLoads, 0);
  assert.equal(storage.data.attendanceSessionRequests.length, 10);
  assert.equal(storage.data.attendanceLeaves ?? null, null, "not marked as a failed try");
});

test("an expired session signs in for an optional page only when signing in is allowed", async () => {
  // Captcha solving off, a recent refused login, or no saved password: no sign-in.
  const refused = { failures: [{ at: MONDAY_11 - 60_000, by: "tab" }], lockoutUntil: 0, rejectedUid: "" };
  for (const extra of [{ autoSolveCaptcha: false }, { loginGuard: refused }, { password: "" }]) {
    const server = fakeCuims({ signedIn: false });
    const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, ...extra });
    const result = await daemon(server, storage).refresh();
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.snapshot.subjects.length, 3, "attendance still reads");
    assert.equal(server.state.uidPosts + server.state.loginPosts, 0, JSON.stringify(extra));
  }
  // A CUIMS tab on the login page: the background keeps off the login flow.
  const server = fakeCuims({ signedIn: false });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, loginTabAt: MONDAY_11 - 5_000 });
  assert.equal((await daemon(server, storage).refresh()).snapshot.subjects.length, 3);
  assert.equal(server.state.uidPosts + server.state.loginPosts + server.state.captchaReads, 0);
});

test("an unchecked leave card asks for an attendance refresh instead of opening CUIMS", () => {
  const view = A.buildAnalytics({ subjects: [{ code: "A", title: "A", attended: 9, delivered: 10, leave: { vdl: 1 } }] }, new Date(MONDAY_11));
  const html = A.renderAttendance(view);
  assert.match(html, /Refresh attendance to try again/);
  assert.doesNotMatch(html, /open Duty Leave/);
});


test("a failed medical-leave read waits three hours, and a successful retry starts its daily cadence", async () => {
  const server = fakeCuims({ signedIn: true });
  const base = server.fetchImpl;
  let medicalReads = 0;
  server.fetchImpl = async (url, options) => {
    if (url.endsWith(A.LEAVE_PAGES.ml) && ++medicalReads === 1) return { status: 500, url };
    return base(url, options);
  };
  const dl = () => server.state.requests.filter((line) => line === `GET ${A.LEAVE_PAGES.dl}`).length;
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable() });
  const bg = daemon(server, storage);
  // Duty leave, then medical leave six seconds on, which fails.
  assert.equal((await bg.refresh()).error, undefined);
  assert.equal(dl(), 1);
  assert.equal(medicalReads, 1);
  bg.advance(5 * 60_000);
  await bg.refresh();
  assert.equal(medicalReads, 1);
  bg.advance(3 * 60 * 60_000);
  await bg.refresh(); // medical leave again; duty leave is not due for a day
  assert.equal(medicalReads, 2);
  assert.equal(dl(), 1);
  bg.advance(5 * 60_000);
  await bg.refresh();
  assert.equal(medicalReads, 2);
  bg.advance(24 * 60 * 60_000);
  await bg.refresh(); // both due again: duty leave, the more overdue, then medical
  assert.equal(dl(), 2);
  assert.equal(medicalReads, 3);
});

// ---- portal pages: the local pacing policy ----

test("portal page pacing includes Home and the landing step, excluding login and reports", () => {
  const page = (path) => A.isInnerPage(`https://students.cuchd.in${path}`);
  for (const path of ["/StudentHome.aspx", "/frmStudentCourseWiseAttendanceSummary.aspx?type=x", "/frmMyTimeTable.aspx", A.LEAVE_PAGES.dl, A.LEAVE_PAGES.ml, "/LandingPage.aspx/ShowLandingPage"]) assert.equal(page(path), true, path);
  for (const path of ["/", "/Login.aspx", "/GenerateCaptcha.aspx?1", "/frmStudentCourseWiseAttendanceSummary.aspx/GetReport", "/frmStudentCourseWiseAttendanceSummary.aspx/GetFullReport"]) assert.equal(page(path), false, path);
});

test("the inner-page clock survives a background restart", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" } });
  await daemon(server, storage).refresh("manual"); // timetable, then duty leave
  assert.equal(storage.data.attendancePageAt, MONDAY_11 + 6_000);
  const restarted = daemon(server, storage, { clock: MONDAY_11 + 2 * 60_000 });
  const sent = server.state.requests.length;
  await restarted.refresh("manual");
  assert.equal(server.state.requests.slice(sent).some((line) => /DutyLeave|Medical/i.test(line)), false);
});

const EMPTY_PORTAL_MENU = '<div id="uims_sidebar"><ul class="nav" id="menu-content">\n</ul></div>';

test("individual inner-page requests are paced through a cold login and attendance read", async () => {
  const server = fakeCuims();
  let time = MONDAY_11;
  const pages = [];
  const bg = A.createDaemon({
    storage: saved(), solveCaptcha: async () => "Ab12", now: () => time,
    sleep: async (ms) => { time += ms; },
    fetchImpl: async (target, options) => {
      if (A.isInnerPage(target)) {
        pages.push(time);
        if (pages.filter((at) => time - at < 5_000).length >= 3) return { url: target, status: 200, text: async () => EMPTY_PORTAL_MENU };
      }
      return server.fetchImpl(target, options);
    },
  });
  const result = await bg.refresh();
  assert.equal(result.error, undefined);
  assert.equal(result.snapshot.subjects.length, 3);
  // Attendance (signed out), the landing step, attendance, the first timetable.
  assert.equal(pages.length, 4);
  assert.ok(pages.slice(1).every((at, i) => at - pages[i] >= 6_000));
});

test("individual inner-page requests pace the legacy timetable GET and postback", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" } });
  let time = MONDAY_11;
  const pages = [];
  const bg = A.createDaemon({
    storage, solveCaptcha: async () => "Ab12", now: () => time,
    sleep: async (ms) => { time += ms; },
    fetchImpl: async (target, options) => {
      if (A.isInnerPage(target)) pages.push(time);
      if (/frmMyTimeTable/.test(target) && options.method === "GET") return { url: target, status: 200, text: async () => '<form><input type="hidden" name="__VIEWSTATE" value="tt" /></form>' };
      return server.fetchImpl(target, options);
    },
  });
  assert.equal((await bg.refresh()).error, undefined);
  // The GET, its postback, then duty leave; the three-page ceiling holds
  // medical leave back.
  assert.deepEqual(pages, [MONDAY_11, MONDAY_11 + 6_000, MONDAY_11 + 12_000]);
});

test("a login tab that appears during page pacing keeps its captcha", async () => {
  const server = fakeCuims();
  const storage = saved({ attendancePageAt: MONDAY_11 - 1_000 });
  const bg = daemon(server, storage, { onSleep: async (_ms, time) => storage.set({ tabLoginTouchAt: time }) });
  const result = await bg.refresh();
  assert.equal(result.code, "tab-login");
  assert.equal(server.state.loginPageLoads + server.state.loginPosts + server.state.captchaReads, 0);
  assert.deepEqual(bg.sleeps, [5_000]);
});

test("a tab refusal during page pacing cancels the pending page request", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendancePageAt: MONDAY_11 - 1_000 });
  const bg = daemon(server, storage, { onSleep: async (_ms, time) => storage.set({ tabLimitedAt: time }) });
  const result = await bg.refresh();
  assert.equal(result.code, "page-limit");
  assert.equal(server.state.requests.length, 0);
  assert.equal(result.nextRefreshAt, MONDAY_11 + 5_000 + 15 * 60_000);
});

test("page pacing follows tab activity that arrives during its wait", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendancePageAt: MONDAY_11 - 1_000 });
  let waits = 0;
  const bg = daemon(server, storage, { onSleep: async (_ms, time) => {
    if (++waits === 1) await storage.set({ tabPageAt: time });
  } });
  const result = await bg.refresh();
  assert.equal(result.error, undefined);
  assert.deepEqual(bg.sleeps, [5_000, 6_000]);
  assert.equal(result.snapshot.fetchedAt, new Date(MONDAY_11 + 11_000).toISOString());
});

test("an initial login landing may have no menu before ShowLandingPage initializes it", async () => {
  const server = fakeCuims();
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    const response = await original(target, options);
    if (new URL(target).pathname === "/Login.aspx" && options.method === "POST") return { ...response, text: async () => EMPTY_PORTAL_MENU };
    return response;
  };
  const result = await daemon(server, saved()).refresh();
  assert.equal(result.error, undefined);
  assert.equal(server.state.landingCalls, 1);
  assert.equal(result.snapshot.subjects.length, 3);
});

test("an HTTP 200 empty portal menu pauses pages and preserves leave data and fresh attendance", async () => {
  const server = fakeCuims({ signedIn: true });
  const applications = A.parseDutyLeaves(dutyLeavePage([{ id: 11, dated: "25 Sep 2026", status: "Recommend and Approved" }]));
  assert.equal(applications.length, 1);
  const leaves = { v: A.LEAVES_VERSION, apps: { dl: applications, ml: [] }, pending: {}, mlAt: MONDAY_11 };
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) }, attendanceLeaves: leaves });
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => target.endsWith(A.LEAVE_PAGES.dl)
    ? { url: target, status: 200, text: async () => EMPTY_PORTAL_MENU }
    : original(target, options);
  const bg = daemon(server, storage);
  const result = await bg.refresh();
  assert.equal(result.error, undefined);
  assert.equal(result.snapshot.subjects.length, 3);
  assert.deepEqual(storage.data.attendanceLeaves.apps, structuredClone(leaves.apps));
  assert.equal(storage.data.pagesPausedUntil, MONDAY_11 + 15 * 60_000);
  assert.equal(server.state.loginPosts + server.state.landingCalls, 0);
  bg.advance(60_000);
  assert.equal((await bg.refresh()).error, undefined, "cached report ids still read attendance during the page pause");
});

test("an HTTP 200 empty timetable menu stops before its postback", async () => {
  const requests = [];
  const request = A.createRequest({ fetchImpl: async (target, options) => {
    requests.push(options.method);
    return { url: target, status: 200, text: async () => EMPTY_PORTAL_MENU };
  } });
  await assert.rejects(A.readTimetable(request), { code: "page-limit" });
  assert.equal(requests.length, 1);
});

test("a populated portal menu still allows a genuinely empty leave list", async () => {
  const html = EMPTY_PORTAL_MENU.replace("\n", '<li><a href="frmMyTimeTable.aspx">Timetable</a></li>') + medicalLeavePage();
  const request = A.createRequest({ fetchImpl: async (target) => ({ url: target, status: 200, text: async () => html }) });
  assert.equal((await A.readLeavePage(request, "ml")).length, 0);
});

test("a CUIMS tab's own page holds the background's optional pages back for five minutes", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable(), tabPageAt: MONDAY_11 - 60_000 });
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  assert.deepEqual(pagesOf(server), []);
  bg.advance(4 * 60_000);
  await bg.refresh("manual");
  assert.deepEqual(pagesOf(server), [`GET ${A.LEAVE_PAGES.dl}`, `GET ${A.LEAVE_PAGES.ml}`]);
});

test("a tab page loaded during a summary read holds back optional leave pages", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({
    attendanceMeta: { reportId: "RID+/=", sessionId: "25262" },
    attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) },
  });
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    if (target.endsWith("/GetReport")) await storage.set({ tabPageAt: MONDAY_11 });
    return original(target, options);
  };
  const result = await daemon(server, storage).refresh();
  assert.equal(result.error, undefined);
  assert.equal(server.state.leavePageLoads, 0, "the tab's current page clock wins over the run's initial state");
});

test("a tab refusal recorded during a summary read holds back timetable and leave pages", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" } });
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    if (target.endsWith("/GetReport")) await storage.set({ tabLimitedAt: MONDAY_11 });
    return original(target, options);
  };
  const result = await daemon(server, storage).refresh();
  assert.equal(result.error, undefined);
  assert.equal(server.state.leavePageLoads, 0);
  assert.equal(server.state.requests.some((line) => /frmMyTimeTable/.test(line)), false);
  assert.equal(result.snapshot.timetableDueAt, MONDAY_11 + 15 * 60_000);
});

test("a tab refusal during an invalid summary stops the attendance-page fallback", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: { reportId: "invalid", sessionId: "25262" } });
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    if (target.endsWith("/GetReport")) await storage.set({ tabLimitedAt: MONDAY_11 });
    return original(target, options);
  };
  const result = await daemon(server, storage).refresh();
  assert.equal(result.code, "page-limit");
  assert.equal(server.state.attendanceLoads + server.state.loginPosts, 0);
  assert.equal(result.nextRefreshAt, MONDAY_11 + 15 * 60_000);
});

test("a CUIMS tab reports its menu once the document has loaded: empty is a refusal, loaded is CUIMS serving pages", () => {
  const empty = `document.getElementById = (id) => id === "uims_sidebar" ? {} : id === "menu-content" ? { querySelector: () => null } : null`;
  const full = `document.getElementById = (id) => id === "uims_sidebar" ? {} : id === "menu-content" ? { querySelector: () => ({}) } : null`;
  const page = contentRuntime("/StudentHome.aspx");
  page.call(`globalThis.sent = []; chrome.runtime.sendMessage = (message) => sent.push(message)`);
  page.call(`document.readyState = "loading"; ${empty}`);
  page.call("reportTabPage()");
  assert.equal(page.writes.length, 0, "an unfinished document is not a refusal");
  page.call(`document.readyState = "interactive"`);
  page.call("reportTabPage()");
  assert.ok(page.writes[0].tabLimitedAt > 0);
  assert.deepEqual(JSON.parse(page.call("JSON.stringify(sent)")), [{ type: "cuims-clear:tab-page", path: "/StudentHome.aspx", result: "empty-menu" }]);
  page.call("reportTabPage()");
  assert.equal(page.writes.length, 1, "once per page");
  page.writes.length = 0;
  page.call("scanPage()");
  assert.equal(page.writes.length, 0, "an empty home menu does not announce a successful session");
  for (const pathname of ["/LandingPage.aspx", "/Login.aspx", "/"]) {
    page.call(`tabPageReported = false; location.pathname = ${JSON.stringify(pathname)}`);
    page.call("reportTabPage()");
    assert.equal(page.writes.length, 0, "the login flow initializes its menu later");
  }
  page.call(`tabPageReported = false; location.pathname = "/frmStudentCourseWiseAttendanceSummary.aspx"; ${full}`);
  page.call("reportTabPage()");
  assert.ok(page.writes[0].tabMenuOkAt > 0, "a loaded menu says CUIMS is serving pages");
  assert.equal(page.writes[0].sessionAlive, true);
});

test("a CUIMS tab stamps portal pages including Home, excluding login and landing, and reports refusal", () => {
  for (const [pathname, stamped] of [["/frmStudentCourseWiseAttendanceSummary.aspx", true], ["/frmStudentApplyDutyLeave.aspx", true], ["/StudentHome.aspx", true], ["/Login.aspx", false], ["/", false], ["/error.html", false]]) {
    const page = contentRuntime(pathname);
    page.call("stampTabPage()");
    assert.equal(page.writes.some((values) => "tabPageAt" in values), stamped, pathname);
    assert.equal(page.writes.some((values) => "tabLimitedAt" in values), pathname === "/error.html", pathname);
  }
});

// ---- 0.10.4: one student's data, free hand-overs, the local log ----

test("a different saved UID drops the last student's reads before the next read", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({
    uid: "24BCS99999",
    attendanceOwner: "24BCS00000",
    attendanceMeta: { reportId: "OTHER", sessionId: "25262" },
    attendanceSnapshot: { fetchedAt: new Date(MONDAY_11 - 60_000).toISOString(), subjects: [{ code: "X", title: "Someone else's", attended: 1, delivered: 1 }] },
    attendanceTimetable: freshTimetable(),
    attendanceLeaves: leavesRead(),
  });
  const bg = daemon(server, storage);
  const result = await bg.refresh();
  assert.equal(result.error, undefined, result.error);
  assert.equal(server.state.requests[0], "GET /frmStudentCourseWiseAttendanceSummary.aspx", "the old report ids are never sent");
  assert.equal(storage.data.attendanceOwner, "24BCS99999");
  assert.ok(result.snapshot.subjects.every((subject) => subject.title !== "Someone else's"));
  // Saving a UID clears at once, before any read.
  storage.data.uid = "24BCS11111";
  await bg.checkStudent();
  assert.equal(storage.data.attendanceSnapshot, null);
  assert.equal(storage.data.attendanceMeta, null);
});

test("after an update from 0.10.3, the first read is the report calls alone: timetable, leave and ids carry over", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({
    attendanceMeta: META,
    attendanceTimetable: { day: "2026-09-27", slots: A.parseTimetable(TIMETABLE_HTML), triedAt: MONDAY_11 - 20 * 60 * 60_000 },
    attendanceLeaves: { v: A.LEAVES_VERSION, apps: { dl: [], ml: [] }, pending: {}, dlAt: MONDAY_11 - 2 * 60 * 60_000, mlAt: MONDAY_11 - 60 * 60_000, checkedAt: MONDAY_11 - 60 * 60_000, triedAt: MONDAY_11 - 60 * 60_000 },
    attendanceRequests: [MONDAY_11 - 60 * 60_000],
    attendancePageAt: MONDAY_11 - 60 * 60_000,
  });
  const result = await daemon(server, storage).refresh();
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(pagesOf(server), []);
  assert.equal(storage.data.attendanceOwner, "24BCS00000");
  assert.ok(result.snapshot.slots.length > 0);
});

test("fresh totals are saved before any optional page, so a slow or refused page never hides them", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable() });
  let seenAtPage = null;
  const original = server.fetchImpl;
  server.fetchImpl = async (target, options) => {
    if (target.includes(A.LEAVE_PAGES.dl)) seenAtPage = structuredClone(storage.data.attendanceSnapshot);
    return original(target, options);
  };
  await daemon(server, storage).refresh();
  assert.equal(seenAtPage?.subjects?.length, 3);
  assert.equal(seenAtPage.fetchedAt, new Date(MONDAY_11).toISOString());
});

test("a CUIMS tab that loads its menu again ends the background's page pause early", async () => {
  const server = fakeCuims({ signedIn: true, limited: "menu" });
  const storage = saved({ attendanceMeta: META, attendanceTimetable: freshTimetable() });
  const bg = daemon(server, storage);
  await bg.refresh(); // duty leave, refused
  assert.equal(storage.data.pagesPausedUntil, MONDAY_11 + 15 * 60_000);
  server.state.limited = false;
  // Four minutes on, the student's own CUIMS tab loads with its menu.
  Object.assign(storage.data, { tabPageAt: MONDAY_11 + 4 * 60_000, tabMenuOkAt: MONDAY_11 + 4 * 60_000 });
  bg.advance(10 * 60_000);
  await bg.refresh();
  assert.equal(server.state.leavePageLoads, 2, "read at ten minutes, five after the tab, not at fifteen");
});

test("opening My Time Table on CUIMS hands the timetable over with no request", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: META, attendanceLeaves: leavesRead(), attendanceSnapshot: { fetchedAt: new Date(MONDAY_11 - 60_000).toISOString(), slots: [], timetableDueAt: MONDAY_11 + 60_000, subjects: [] } });
  const bg = daemon(server, storage);
  const slots = await bg.ingestTimetablePage(TIMETABLE_HTML);
  assert.ok(slots.length > 0);
  assert.equal(server.state.requests.length, 0);
  assert.equal(storage.data.attendanceTimetable.savedAt, MONDAY_11);
  assert.equal(storage.data.attendanceSnapshot.timetableDueAt, undefined);
  assert.equal(storage.data.attendanceSnapshot.slots.length, slots.length);
  await bg.refresh();
  assert.deepEqual(pagesOf(server), [], "nothing left to load");
  assert.equal(await bg.ingestTimetablePage("<html>no grid</html>"), null);
});

test("an open My Time Table page hands its grid to the background once", () => {
  const page = contentRuntime("/frmMyTimeTable.aspx");
  page.call(`globalThis.sent = []; chrome.runtime.sendMessage = (message) => sent.push(message)`);
  page.call(`document.getElementById = (id) => id === "ContentPlaceHolder1_gvMyTimeTable" ? { textContent: "Mon 9:40", outerHTML: "<table id='ContentPlaceHolder1_gvMyTimeTable'></table>" } : id === "ContentPlaceHolder1_gvMyTimeTableDetails" ? { outerHTML: "<table id='details'></table>" } : null`);
  page.call("shareTimetablePage()");
  page.call("shareTimetablePage()");
  const sent = JSON.parse(page.call("JSON.stringify(sent)"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "cuims-clear:timetable-page");
  assert.match(sent[0].html, /gvMyTimeTable.*<table id='details'>/);
});

test("the local request log keeps paths, statuses and results only, newest 150", async () => {
  const server = fakeCuims({ signedIn: false, limited: "menu" });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh();
  const log = storage.data.cuimsJournal;
  assert.ok(log.some((entry) => entry.by === "bg" && entry.path === "/frmStudentCourseWiseAttendanceSummary.aspx" && entry.to === "/Login.aspx"), "the signed-out redirect");
  assert.ok(log.some((entry) => entry.path === "/LandingPage.aspx/ShowLandingPage" && entry.result === "ok"));
  assert.ok(log.some((entry) => entry.result === "empty-menu"), "the refusal");
  const text = JSON.stringify(log);
  for (const secret of ["secret", "24BCS00000", "etgkYfqBdH1fSfc255iYGw", "RID", "Ab12"]) assert.ok(!text.includes(secret), secret);
  await bg.noteTabPage({ path: "/StudentHome.aspx?x=1", result: "empty-menu" });
  assert.deepEqual({ ...storage.data.cuimsJournal.at(-1), at: 0 }, { at: 0, by: "tab", path: "/StudentHome.aspx", result: "empty-menu" });
  for (let index = 0; index < 200; index += 1) await bg.noteTabPage({ path: "/frmMyTimeTable.aspx", result: "ok" });
  assert.equal(storage.data.cuimsJournal.length, 150);
});
