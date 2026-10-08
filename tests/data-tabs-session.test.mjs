import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage } from "./fake-cuims.mjs";

const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
const marks = readFileSync(new URL("fixtures/marks/regular.html", import.meta.url), "utf8");
const timetable = readFileSync(new URL("fixtures/timetable/current.html", import.meta.url), "utf8");
function setup({ signedIn = false, openLoginTab = false, stale = true } = {}) {
  const c = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, Intl, Date, Math, JSON, console, setTimeout });
  for (const file of ["attendance-parse.js", "attendance-model.js", "attendance-client.js", "marks.js", "timetable.js", "attendance-daemon.js", "attendance-view.js", "timetable-view.js"])
    vm.runInContext(readFileSync(new URL(file, root), "utf8"), c, { filename: file });
  let at = Date.UTC(2026, 9, 8, 6), present = openLoginTab;
  const base = fakeCuims({ signedIn });
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret", ...(stale ? {
    loginTabAt: at, tabLoginTouchAt: at, pageLoginAt: at,
    marksStatus: { uid: "24BCS00000", at, error: "A CUIMS tab is signing in.", code: "tab-login" },
    timetableStatus: { uid: "24BCS00000", at, error: "A CUIMS tab is signing in.", code: "tab-login" },
  } : {}) });
  const requests = [];
  let refusal = false;
  const fetchImpl = async (target, options = {}) => {
    requests.push({ url: target, ...options });
    const path = new URL(target).pathname;
    if (path === "/frmStudentMarksView.aspx" || path === "/frmMyTimeTable.aspx") {
      if (!base.state.signedIn) return base.fetchImpl("https://students.cuchd.in/StudentHome.aspx", options);
      if (refusal) return { url: "https://students.cuchd.in/error.html", status: 200, text: async () => "Try later" };
      return { url: target, status: 200, text: async () => path === "/frmMyTimeTable.aspx" ? timetable : marks };
    }
    return base.fetchImpl(target, options);
  };
  const daemon = () => c.CuimsAttendance.createDaemon({ storage, fetchImpl, solveCaptcha: async () => "Ab12", loginTabPresent: async () => present, now: () => at, sleep: async () => {} });
  return { c, base, storage, requests, daemon, setTime: value => { at += value; }, closeTab: () => { present = false; }, refuse: () => { refusal = true; } };
}

for (const [tab, method] of [["marks", "fetchRegularMarks"], ["timetable", "fetchCachedTimetable"]]) {
  test(`${tab}: closed CUIMS tabs and stale login flags still allow exactly one guarded sign-in`, async () => {
    const s = setup();
    const result = await s.daemon()[method]();
    assert.ok(result.cache, result.error);
    assert.equal(s.base.state.loginPosts, 1);
    assert.equal(s.base.state.uidPosts, 1);
    assert.equal(s.base.state.landingCalls, 1);
    assert.equal(s.storage.data.loginTabAt, 0);
    assert.equal(s.storage.data.tabLoginTouchAt, 0);
    assert.equal(s.storage.data.pageLoginAt, 0);
    assert.equal(s.requests.length, 7);
    assert.equal(result.requestCounts[tab].perMinute, 7);
    assert.equal(result.requestCounts[tab].perTenMinutes, 7);
    assert.ok(!s.requests.some(r => /frmStudentCourseWiseAttendanceSummary/i.test(r.url)));
    assert.equal(s.requests.find(r => /StudentHome/.test(r.url)).redirect, "manual");
    await s.daemon()[method]();
    assert.equal(s.requests.length, 7, "restart reads from cache");
  });
  test(`${tab}: a real login tab blocks requests; closing it lifts the block immediately`, async () => {
    const s = setup({ openLoginTab: true });
    const d = s.daemon();
    assert.equal((await d[method]()).code, "tab-login");
    assert.equal(s.requests.length, 0);
    s.closeTab();
    assert.ok((await d[method]()).cache);
    assert.equal(s.requests.length, 7);
  });
  test(`${tab}: throttled data page backs off without another login or repeated page attempts`, async () => {
    const s = setup({ signedIn: true, stale: false });
    s.refuse();
    const d = s.daemon();
    const first = await d[method]();
    assert.equal(first.code, "portal-busy");
    assert.equal(s.requests.length, 2);
    assert.equal(s.base.state.loginPosts, 0);
    s.setTime(31000);
    assert.equal((await d[method]()).code, "backoff");
    assert.equal(s.requests.length, 2);
  });
}

test("the actual timetable grid parses all days and sorts morning classes before afternoon", async () => {
  const s = setup({ signedIn: true, stale: false });
  const result = await s.daemon().fetchCachedTimetable();
  assert.equal(s.requests.length, 2, "no invented ReportViewer postback");
  const slots = result.cache.slots;
  assert.equal(slots.length, 36);
  assert.equal(slots[0].weekday, "mon");
  assert.equal(slots[0].start, 570);
  assert.equal(slots.at(-1).weekday, "sun");
  assert.equal(slots.filter(slot => slot.weekday === "mon").length, 7);
  assert.equal(slots[0].title, "Soft Skills-III");
  assert.match(slots[0].rawLabel, /Block-C1-208-A/);
  const html = s.c.CuimsTimetableView.render(result.cache);
  assert.ok(html.indexOf("9:30 AM") < html.indexOf("1:40 PM"));
  assert.match(html, /Sunday/);
});
test("request counts cover only the two new flows and use rolling minute and ten-minute windows", async () => {
  const s = setup({ signedIn: true, stale: false });
  s.storage.data.attendanceRequests = Array(5).fill(Date.UTC(2026, 9, 8, 6));
  const d = s.daemon();
  const a = await d.fetchRegularMarks();
  const b = await d.fetchCachedTimetable();
  assert.equal(a.requestCounts.marks.perMinute, 2);
  assert.equal(b.requestCounts.timetable.perMinute, 2);
  assert.equal(b.requestCounts.marks.perTenMinutes, 2);
  assert.equal(s.storage.data.newTabRequests.length, 4);
  s.setTime(60000);
  const minute = (await d.fetchRegularMarks()).requestCounts;
  assert.equal(minute.marks.perMinute, 0);
  assert.equal(minute.marks.perTenMinutes, 2);
  s.setTime(540000);
  const ten = (await d.fetchCachedTimetable()).requestCounts;
  assert.equal(ten.marks.perTenMinutes, 0);
  assert.equal(ten.timetable.perTenMinutes, 0);
  assert.equal(s.requests.length, 4);
});
test("Marks refresh clicks share a read and successful refreshes wait 30 seconds", async () => {
  const s = setup({ signedIn: true, stale: false }), d = s.daemon();
  await d.fetchRegularMarks();
  await Promise.all([d.fetchRegularMarks({ force: true }), d.fetchRegularMarks({ force: true })]);
  assert.equal(s.requests.length, 4);
  assert.equal((await d.fetchRegularMarks({ force: true })).code, "busy");
  assert.equal(s.requests.length, 4);
  s.setTime(30000);
  assert.ok((await d.fetchRegularMarks({ force: true })).cache);
  assert.equal(s.requests.length, 6);
});
