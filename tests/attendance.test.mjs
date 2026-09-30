import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage, TIMETABLE_HTML, dutyLeavePage, medicalLeavePage } from "./fake-cuims.mjs";
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

const saved = (extra = {}) => memoryStorage({ uid: "24BCS00000", password: "secret", ...extra });

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
  const bg = daemon(server, saved());
  await bg.refresh("manual");
  bg.advance(60_000);
  const result = await bg.refresh("manual");
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

test("after the first read, a refresh is one GetReport call without the heavy attendance page", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  bg.advance(60_000);
  await bg.refresh("manual"); // picks up the deferred timetable
  bg.advance(60_000);
  await bg.refresh("manual"); // first leave check
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

test("a GetReport-only refresh does not claim the CUIMS session is alive", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  storage.data.sessionAlive = false;
  bg.advance(60_000);
  await bg.refresh("manual");
  assert.equal(storage.data.sessionAlive, false);
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

test("landing on StudentHome tells the background the session is alive, once", () => {
  const page = contentRuntime("/StudentHome.aspx");
  page.call("requestAnimationFrame = () => {}; getComputedStyle = () => ({ display: 'block' }); NodeFilter = { SHOW_TEXT: 4 };");
  page.call("document.createTreeWalker = () => ({ nextNode: () => false }); scanPage(); scanPage();");
  const marks = page.writes.filter((values) => "sessionAlive" in values);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].sessionAlive, true);
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

test("opening CUIMS with a live session only pings StudentHome", async () => {
  const server = fakeCuims({ signedIn: true });
  const result = await daemon(server, saved()).ensureSession();
  assert.deepEqual({ ...result }, { alive: true });
  assert.deepEqual(server.state.requests, ["GET /StudentHome.aspx"]);
});

test("opening CUIMS with a dead session signs in once in the background", async () => {
  const server = fakeCuims();
  const storage = saved();
  const result = await daemon(server, storage).ensureSession();
  assert.equal(result.signedIn, true);
  assert.equal(server.state.loginPosts, 1);
  assert.equal(server.state.signedIn, true);
  assert.equal(storage.data.sessionAlive, true);
});

test("opening CUIMS never signs in while a tab is on the login page, or when auto-login is off", async () => {
  for (const storage of [loginTabOpen(), saved({ autoSubmitLogin: false })]) {
    const server = fakeCuims();
    const result = await daemon(server, storage).ensureSession();
    assert.equal(result.alive, false);
    assert.equal(server.state.loginPosts + server.state.uidPosts, 0);
  }
});

test("opening CUIMS respects the shared lockout", async () => {
  const server = fakeCuims();
  const result = await daemon(server, saved({ loginGuard: { failures: [], lockoutUntil: MONDAY_11 + 60_000 } })).ensureSession();
  assert.equal(result.reason, "lockout");
  assert.equal(server.state.uidPosts, 0);
});

test("an open waits for a refresh that is already talking to CUIMS", async () => {
  const server = fakeCuims();
  const bg = daemon(server, saved());
  const [refresh, session] = await Promise.all([bg.refresh("manual"), bg.ensureSession()]);
  assert.equal(refresh.snapshot.subjects.length, 3);
  assert.deepEqual({ ...session }, { alive: true });
  assert.equal(server.state.loginPosts, 1);
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

test("CUIMS's throttle page is waited out: no sign-in, no retries, last read kept, five minutes first", async () => {
  const server = fakeCuims({ signedIn: true, landed: false });
  const storage = saved({ attendanceSnapshot: { fetchedAt: new Date(MONDAY_11 - 3_600_000).toISOString(), subjects: [{ code: "X", title: "X", attended: 1, delivered: 1 }] } });
  const bg = daemon(server, storage);
  const result = await bg.refresh("manual");
  assert.equal(result.code, "portal-busy");
  assert.match(result.error, /limiting requests.*Showing your last read.*5 min/);
  assert.equal(result.snapshot.subjects.length, 1);
  assert.equal(server.state.loginPosts + server.state.uidPosts + server.state.landingCalls, 0);
  const sent = server.state.requests.length;
  bg.advance(60_000);
  const again = await bg.refresh("manual");
  assert.equal(again.code, "backoff");
  assert.equal(server.state.requests.length, sent, "nothing is sent while waiting");
  assert.doesNotMatch(again.error, /Next try in \d+ min\. Next try/);
});

test("the first read skips the timetable, and the next one fetches it", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  await bg.refresh("manual");
  assert.equal(server.state.requests.filter((line) => /frmmytimetable/i.test(line)).length, 0);
  bg.advance(60_000);
  await bg.refresh("manual");
  assert.ok(storage.data.attendanceTimetable.slots.length > 0);
});

test("a throttled timetable never fails the read and is retried after an hour, not sooner", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" } });
  const bg = daemon(server, storage);
  server.state.landed = false; // inner pages answer error.html
  const first = await bg.refresh("manual");
  assert.equal(first.error, undefined);
  assert.equal(first.snapshot.subjects.length, 3);
  const timetableLoads = () => server.state.requests.filter((line) => /frmmytimetable/i.test(line)).length;
  assert.equal(timetableLoads(), 1);
  bg.advance(10 * 60_000);
  await bg.refresh("manual");
  assert.equal(timetableLoads(), 1);
  server.state.landed = true;
  bg.advance(60 * 60_000);
  await bg.refresh("manual");
  assert.equal(timetableLoads(), 2);
  assert.ok(storage.data.attendanceTimetable.slots.length > 0);
});

test("opening CUIMS after a background sign-in hands the tab a finished session", async () => {
  const server = fakeCuims();
  await daemon(server, saved()).ensureSession();
  assert.equal(server.state.landed, true);
});

test("with cached report ids, a refresh needs no CUIMS session: no sign-in, no cookies sent", async () => {
  const server = fakeCuims({ signedIn: false });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-09-28", slots: [] } });
  const result = await daemon(server, storage).refresh("manual");
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.snapshot.subjects.length, 3);
  assert.equal(server.state.uidPosts + server.state.loginPosts + server.state.loginPageLoads, 0);
  assert.equal(server.state.cookiedReports, 0);
});

// ---- nothing runs on a timer ----

test("the background has no timer: no alarms permission, no alarm, no scheduled work", () => {
  for (const build of ["firefox", "chrome"]) {
    const root = new URL(`../outputs/cuims-clear-${build}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
    assert.equal(manifest.permissions.includes("alarms"), false, build);
    for (const name of ["attendance-bg.js", "attendance-daemon.js", "background.js", "lms-open.js"]) {
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

test("leave pages are read at most every three hours, alternating, and never with another heavy page", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = saved();
  const bg = daemon(server, storage);
  const heavy = () => server.state.attendanceLoads + server.state.requests.filter((line) => /frmmytimetable/i.test(line) && line.startsWith("GET")).length + server.state.leavePageLoads;
  let last = heavy();
  for (let run = 0; run < 4; run += 1) {
    await bg.refresh("manual");
    assert.ok(heavy() - last <= 1, `run ${run} loaded ${heavy() - last} heavy pages`);
    last = heavy();
    bg.advance(60_000);
  }
  assert.equal(server.state.leavePageLoads, 1);
  bg.advance(3 * 60 * 60_000);
  await bg.refresh("manual");
  assert.equal(server.state.leavePageLoads, 2);
  assert.ok(storage.data.attendanceLeaves.dlAt && storage.data.attendanceLeaves.mlAt, "duty then medical");
});

test("opening a leave page on CUIMS updates pending leave with no page request", async () => {
  const server = fakeCuims({ signedIn: true, marksToday: [LEAVE_DAY_MARK] });
  const storage = saved({ attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceCourses: { "24CSP305": "enc305" }, attendanceSnapshot: { fetchedAt: new Date(MONDAY_11).toISOString(), subjects: [] } });
  await daemon(server, storage).ingestLeavePage("dl", dutyLeavePage([{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }]));
  assert.equal(server.state.leavePageLoads, 0);
  assert.deepEqual({ ...storage.data.attendanceSnapshot.leaves.pending["24CSP305"] }, { vdl: 1, idl: 0, adl: 0, ml: 0 });
});

// ---- today's planner ----

function plannerView(options = {}) {
  const slots = A.parseTimetable(TIMETABLE_HTML);
  const snapshot = { fetchedAt: new Date(at(12, 30)).toISOString(), marksDay: "2026-09-28", slots, subjects: [
    { code: "24CSP-305", title: "Competitive Coding-II", attended: 26, delivered: 32 },
    { code: "24CST-302", title: "Computer Networks", attended: 11, delivered: 12 },
    { code: "24TDT-312", title: "Aptitude-III", attended: 100, delivered: 100 },
  ] };
  return A.buildAnalytics(snapshot, new Date(at(12, 30)), options);
}

test("the planner lists today's remaining classes with a verdict each", () => {
  const view = plannerView();
  assert.deepEqual(JSON.parse(JSON.stringify(view.today.classes.map((item) => [item.time, item.title]))), [["1:00", "Computer Networks"]]);
  assert.equal(view.today.classes[0].verdict, "can-skip");
  assert.equal(view.today.maxSkips, 1);
});

test("planning a skip shows the end-of-day figures, and too many skips are flagged", () => {
  const key = plannerView().today.classes[0].key;
  const planned = plannerView({ plan: [key] });
  assert.equal(planned.today.classes[0].verdict, "planned");
  assert.equal(Math.round(planned.today.projection.subjects[0].percent * 10), Math.round((11 / 13) * 1000));
  const strict = plannerView({ goal: "strict", plan: [key] });
  assert.equal(strict.today.classes[0].verdict, "too-many");
  assert.equal(strict.today.projection.safe, false);
});

test("the popup shows the goal switch, today's plan and the leave card, and never 'overall cap'", () => {
  const view = plannerView();
  const html = A.renderAttendance(view, { now: new Date(at(12, 30)) });
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /data-goal="strict"/);
  assert.match(html, /data-plan-key=/);
  assert.match(html, /Today · Mon/);
  assert.doesNotMatch(html, /overall cap/);
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
