import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage, TIMETABLE_HTML } from "./fake-cuims.mjs";

const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
function load() {
  const c = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, Intl, Date, Math, JSON, console, setTimeout });
  for (const file of ["attendance-parse.js", "attendance-model.js", "attendance-client.js", "marks.js", "timetable.js", "attendance-daemon.js", "attendance-view.js", "timetable-view.js", "marks-view.js"])
    vm.runInContext(readFileSync(new URL(file, root), "utf8"), c, { filename: file });
  return c;
}
const c = load(), A = c.CuimsAttendance, T = c.CuimsTimetable;
const NOW = Date.UTC(2026, 9, 8, 6);
function setup({ signedIn = true, uid = "24BCS00000", malformed = false, clear = false } = {}) {
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret" });
  const base = fakeCuims({ signedIn });
  let count = 0;
  const html = `<h6>${uid}</h6>` + (malformed ? "unexpected data" : TIMETABLE_HTML);
  const fetchImpl = async (target, options) => {
    if (new URL(target).pathname !== "/frmMyTimeTable.aspx") return base.fetchImpl(target, options);
    count++;
    if (!base.state.signedIn) return base.fetchImpl("https://students.cuchd.in/StudentHome.aspx", options);
    if (clear) storage.data.uid = "";
    return { url: target, status: 200, text: async () => html };
  };
  const daemon = () => A.createDaemon({ storage, fetchImpl, solveCaptcha: async () => "Ab12", now: () => NOW, sleep: async () => {} });
  return { storage, base, daemon, count: () => count };
}

test("timetable is fetched once, concurrent reads and background restarts reuse cache", async () => {
  const s = setup(), d = s.daemon();
  const results = await Promise.all([d.fetchCachedTimetable(), d.fetchCachedTimetable(), d.fetchCachedTimetable()]);
  assert.ok(results.every(r => r.cache.slots.length === 3));
  assert.equal(s.count(), 1);
  assert.equal((await s.daemon().fetchCachedTimetable()).cached, true);
  assert.equal(s.count(), 1);
  assert.doesNotMatch(JSON.stringify(s.storage.data.timetableCache), /VIEWSTATE|secret|browser-token/);
});
test("timetable reuses the guarded sign-in when signed out", async () => {
  const s = setup({ signedIn: false });
  assert.equal((await s.daemon().fetchCachedTimetable()).cache.slots.length, 3);
  assert.equal(s.base.state.loginPosts, 1);
});
test("timetable rejects an account mismatch, missing identity, malformed response and cleared login", async () => {
  for (const options of [{ uid: "24BCS99999" }, { uid: "" }, { malformed: true }, { clear: true }]) {
    const s = setup(options);
    const result = await s.daemon().fetchCachedTimetable();
    assert.ok(result.error);
    assert.equal(s.storage.data.timetableCache, undefined);
  }
});
test("timetable caching is scoped to the saved UID including explicit empty timetable", async () => {
  assert.equal(T.cacheFor({ v: T.CACHE_VERSION, uid: "other", slots: [] }, "24BCS00000"), null);
  const s = setup();
  s.storage.data.timetableCache = { v: T.CACHE_VERSION, uid: "24BCS00000", slots: [] };
  assert.equal((await s.daemon().fetchCachedTimetable()).cached, true);
  assert.equal(s.count(), 0);
});
test("attendance reuses the weekly cache across days without another timetable request", async () => {
  const s = setup(), d = s.daemon();
  await d.fetchCachedTimetable();
  await d.refresh("manual");
  const nextDay = A.createDaemon({ storage: s.storage, fetchImpl: s.base.fetchImpl, solveCaptcha: async () => "Ab12", now: () => NOW + 86400000, sleep: async () => {} });
  const prior = s.base.state.requests.length;
  await nextDay.refresh("manual");
  assert.equal(s.count(), 1);
  assert.ok(!s.base.state.requests.slice(prior).some(request => /frmMyTimeTable/i.test(String(request))));
});
test("timetable displays Monday first and sorts times numerically with 12-hour labels and escaped details", () => {
  const slots = [
    { weekday: "tue", start: 540, end: 600, shortCode: "T", title: "Tuesday", kind: "L" },
    { weekday: "mon", start: 780, end: 820, shortCode: "Late", title: "Later", kind: "P" },
    { weekday: "mon", start: 580, end: 620, shortCode: "Early", title: "<Morning>", kind: "L", rawLabel: "By Teacher at 1-2-C <script>" },
  ];
  const html = c.CuimsTimetableView.render({ slots }, {}, { day: "mon" });
  assert.ok(html.indexOf("Monday") < html.indexOf("Tuesday"));
  assert.ok(html.indexOf("Early") < html.indexOf("Late"));
  assert.match(html, /9:40 AM/);
  assert.match(html, /1:00 PM/);
  assert.match(html, /&lt;Morning&gt;/);
  assert.match(html, /Teacher at 1-2-C &lt;script&gt;/);
  assert.doesNotMatch(html, /fetch-timetable|<script>/);
  assert.equal(slots[0].weekday, "tue");
});
test("marks use 12-hour time and every subject starts collapsed", () => {
  const html = c.CuimsMarksView.render({ currentSession: "1", snapshots: { "1": { fetchedAt: "2026-10-08T10:00:00Z", subjects: [{ title: "Subject", exams: [] }] } } });
  assert.match(html, /3:30\s*pm/i);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
});

test("weekday selection defaults to the campus date, including the India midnight boundary", () => {
  assert.equal(c.CuimsTimetableView.today(new Date("2026-10-08T18:29:00Z")), "thu");
  assert.equal(c.CuimsTimetableView.today(new Date("2026-10-08T18:30:00Z")), "fri");
  const html = c.CuimsTimetableView.render({ slots: [] }, {}, { now: new Date("2026-10-08T18:30:00Z") });
  assert.match(html, /data-timetable-day="fri"[^>]*aria-selected="true"/);
  assert.match(html, /No classes scheduled for Friday/);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
});
test("a selected weekday shows only its classes and separates teacher, room, group and class type", () => {
  const html = c.CuimsTimetableView.render({ slots: [
    { weekday: "thu", start: 570, end: 620, title: "Aptitude-III", shortCode: "24TDT-312", kind: "T", rawLabel: "24TDT-312:T::GP-A: By Saurabh(E20046) at Block-B1-302" },
    { weekday: "mon", start: 570, end: 620, title: "Monday subject", shortCode: "M", kind: "L" },
  ] }, {}, { day: "thu" });
  assert.match(html, /Aptitude-III/);
  assert.match(html, /timetable-teacher">Saurabh\(E20046\)/);
  assert.match(html, /timetable-kind">Tutorial/);
  assert.match(html, /<span>Block-B1-302<\/span>/);
  assert.match(html, /<span>GP-A<\/span>/);
  assert.doesNotMatch(html, /Monday subject|24TDT-312:T::/);
  assert.match(html, /timetable-time/);
});
test("days without classes remain selectable instead of showing another day's schedule", () => {
  const html = c.CuimsTimetableView.render({ slots: [{ weekday: "mon", start: 540, end: 600, title: "Class", shortCode: "C", kind: "L" }] }, {}, { day: "sat" });
  assert.match(html, /No classes scheduled for Saturday/);
  assert.equal((html.match(/data-timetable-day=/g) || []).length, 7);
  assert.doesNotMatch(html, /<article/);
});
