import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage, TIMETABLE_HTML } from "./fake-cuims.mjs";
import { contentSource } from "./content-source.mjs";

const FILES = ["attendance-parse.js", "attendance-model.js", "attendance-client.js", "attendance-daemon.js", "attendance-view.js"];

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

function daemon(server, storage, { clock = MONDAY_11, captcha = "Ab12" } = {}) {
  let time = clock;
  const sleeps = [];
  const instance = A.createDaemon({
    storage,
    fetchImpl: server.fetchImpl,
    solveCaptcha: async () => captcha,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
  });
  return { ...instance, sleeps, advance: (ms) => (time += ms), setTime: (value) => (time = value) };
}

const saved = (extra = {}) => memoryStorage({ uid: "24BCS10184", password: "secret", ...extra });

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
  assert.deepEqual({ ...slots[0] }, { weekday: "mon", start: 580, end: 620, shortCode: "24CSP-305", title: "Competitive Coding-II", kind: "P" });
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
  assert.equal(a.cappedByOverall, true);
  assert.equal(a.line, "Can skip 1 · overall cap");
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

test("an ended class with no posted mark counts as missed until CUIMS posts it", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const filler = { code: "24XX-100", title: "Filler", attended: 500, delivered: 505 };
  const subjects = [{ code: "24CSP-305", title: "Competitive Coding-II", attended: 26, delivered: 32, marks: [] }, filler];
  const unposted = A.buildAnalytics({ subjects, slots, marksDay: "2026-09-28" }, new Date(MONDAY_11));
  const row = unposted.subjects.find((item) => item.code === "24CSP-305");
  assert.equal(row.today[0].state, "pending");
  assert.equal(row.skip, 1, "26 of 33 leaves one skip, not two");

  const posted = A.buildAnalytics({
    subjects: [{ ...subjects[0], attended: 27, delivered: 33, marks: [{ date: "28/09/2026", time: "09:40 - 10:20 AM", present: true }] }, filler],
    slots,
    marksDay: "2026-09-28",
  }, new Date(MONDAY_11));
  const after = posted.subjects.find((item) => item.code === "24CSP-305");
  assert.equal(after.today[0].state, "present");
  assert.equal(after.skip, 3);
});

test("today's later classes show as upcoming and count toward classes left", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const view = A.buildAnalytics({ subjects: [{ code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 }], slots }, new Date(MONDAY_11));
  assert.equal(view.subjects[0].today[0].state, "next");
  assert.equal(view.subjects[0].today[0].time, "1:00");
  assert.equal(view.overall.left, 1);
});

test("automatic work only runs inside weekday class hours", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  assert.equal(A.campusWindow(slots, new Date(MONDAY_11)).open, true);
  assert.equal(A.campusWindow(slots, new Date(at(8, 0))).open, false);
  assert.equal(A.campusWindow(slots, new Date(at(14, 30))).open, false, "last class ends 1:40, window closes 2:10");
  assert.equal(A.campusWindow(slots, new Date(at(11, 0, 27))).open, false, "Sunday");
  assert.equal(A.campusWindow([], new Date(at(12, 0, 26))).open, false, "Saturday without a timetable");
});

test("one scheduled refresh is due ten minutes after a class ends", () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const before = new Date(at(10, 25)).toISOString();
  assert.equal(A.classEndedSince(slots, before, new Date(at(10, 29))), false);
  assert.equal(A.classEndedSince(slots, before, new Date(at(10, 31))), true);
  assert.equal(A.classEndedSince(slots, new Date(at(10, 31)).toISOString(), new Date(at(11, 0))), false);
});

// ---- the daemon against a fake CUIMS ----

test("with a live session a refresh reads attendance without touching any login page", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.error, undefined);
  assert.equal(result.snapshot.subjects.length, 3);
  assert.equal(server.state.requests.some((line) => /\/$|login/i.test(line)), false, server.state.requests.join(", "));
  assert.ok(server.state.requests.length <= 6, server.state.requests.join(", "));
  assert.equal(storage.data.sessionAlive, true);
  assert.equal(storage.data.attendanceAuto, true);
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

test("a wrong captcha is retried once on a manual refresh, then the shared limit stops it", async () => {
  const server = fakeCuims({ rejectAs: "captcha" });
  const storage = saved();
  const bg = daemon(server, storage);
  const first = await bg.refresh("manual");
  assert.equal(first.code, "bad-captcha");
  assert.equal(server.state.loginPosts, 2);
  bg.advance(60_000);
  const second = await bg.refresh("manual");
  assert.equal(server.state.loginPosts, 3, "only the one submit left under the limit of three");
  bg.advance(60_000);
  const third = await bg.refresh("manual");
  assert.equal(third.code, "cooldown");
  assert.equal(server.state.loginPosts, 3);
  assert.equal(second.code, "bad-captcha");
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

test("refreshes closer than 30 seconds apart reuse the saved read", async () => {
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

test("the request budget pauses fetching instead of hammering CUIMS", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceRequests: Array.from({ length: 40 }, (_, index) => MONDAY_11 - index * 1000) });
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.code, "busy");
  assert.equal(server.state.requests.length, 0);
});

test("a login in progress in a CUIMS tab is waited for, not raced", async () => {
  const server = fakeCuims();
  const storage = saved({ pageLoginAt: MONDAY_11 - 2000 });
  const bg = daemon(server, storage);
  const result = await bg.refresh("manual");
  assert.equal(bg.sleeps.length, 1);
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
  const result = await daemon(server, saved()).refresh("manual");
  assert.equal(server.state.requests.filter((line) => /getfullreport/i.test(line)).length, 1);
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

test("the alarm does nothing outside class hours, and keep-alive never signs in", async () => {
  const server = fakeCuims();
  const storage = saved({ attendanceAuto: true, sessionAlive: true, sessionCheckedAt: 0, attendanceTimetable: { day: "2026-09-28", slots: A.parseTimetable(TIMETABLE_HTML) } });
  const bg = daemon(server, storage, { clock: at(19, 0) });
  assert.equal((await bg.tick()).skipped, true);
  assert.equal(server.state.requests.length, 0);

  bg.setTime(at(9, 30));
  const ping = await bg.tick();
  assert.equal(ping.pinged, true);
  assert.equal(ping.alive, false);
  assert.deepEqual(server.state.requests, ["GET /StudentHome.aspx"]);
  assert.equal(storage.data.sessionAlive, false);
  assert.equal((await bg.tick()).skipped, true, "a dead session is left alone until the next class ends");
  assert.equal(server.state.uidPosts, 0);
});

test("a scheduled refresh after class signs in at most once an hour, and never after a failure", async () => {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const server = fakeCuims();
  const storage = saved({ attendanceAuto: true, attendanceTimetable: { day: "2026-09-28", slots } });
  const bg = daemon(server, storage, { clock: at(10, 35) });
  const first = await bg.tick();
  assert.equal(first.refreshed.error, undefined);
  assert.equal(server.state.loginPosts, 1);

  server.state.signedIn = false;
  bg.setTime(at(13, 55));
  storage.data.lastAutoSignInAt = at(13, 20);
  const second = await bg.tick();
  assert.equal(second.refreshed.code, "cooldown", "within the hour since the last automatic sign-in");
  assert.equal(server.state.loginPosts, 1);

  storage.data.lastAutoSignInAt = 0;
  storage.data.loginGuard = { failures: [{ at: at(13, 50), by: "page" }] };
  bg.setTime(at(14, 5));
  storage.data.attendanceSnapshot.fetchedAt = new Date(at(13, 45)).toISOString();
  const third = await bg.tick();
  assert.equal(third.refreshed.code, "cooldown", "a recent failed login blocks automatic sign-in");
  assert.equal(server.state.loginPosts, 1);
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

// ---- the CUIMS tab defers to the background ----

function contentRuntime() {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  const writes = [];
  const context = vm.createContext({
    document: { documentElement: null, body: null, addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    location: { pathname: "/Login.aspx" },
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

test("background failures and lockouts count against the login page's auto-submit", () => {
  const page = contentRuntime();
  page.call(`sharedLogin.loginGuard = { failures: [{ at: Date.now(), by: "bg" }, { at: Date.now(), by: "bg" }, { at: Date.now(), by: "bg" }] }`);
  assert.equal(page.call("canAutoSubmit().reason"), "budget");
  page.call(`sharedLogin.loginGuard = { failures: [], lockoutUntil: Date.now() + 60000 }`);
  assert.equal(page.call("canAutoSubmit().reason"), "lockout");
});

test("a page auto-submit tells the background a tab login is in flight", () => {
  const page = contentRuntime();
  page.call("recordAutoSubmit(1234)");
  assert.equal(JSON.stringify(page.writes.at(-1)), JSON.stringify({ pageLoginAt: 1234 }));
});
