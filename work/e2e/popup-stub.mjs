// A disposable copy of the popup with chrome.* stubbed and a frozen clock,
// for the screenshot and glitch harnesses. Scenarios are picked by URL:
//   popup.html?scenario=<name>&theme=<id>&goal=strict&view=forecast
// No network, no account.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { semester, campusTime } from "../../tests/forecast-fixture.mjs";

const at = (key, hours, minutes = 0) => campusTime(key, hours, minutes).getTime();

// Every shape of data the Forecast tab has to draw well.
export function scenarios() {
  const base = (options = {}) => semester({ until: "2026-10-08", ...options });
  const list = {};
  const add = (name, { data = base(), now = at("2026-10-09", 10, 5), extra = {}, readAgo = 3 * 60_000 } = {}) => {
    const snapshot = { ...data.snapshot, fetchedAt: new Date(now - readAgo).toISOString() };
    list[name] = { now, data: { attendanceSnapshot: snapshot, attendanceHistory: data.history, ...extra } };
  };
  add("default");
  add("struggling", { data: base({ rates: { "24CST-301": 0.5, "24UCT-310": 0.5, "24CSP-305": 0.62 } }) });
  add("strong", { data: base({ rates: Object.fromEntries(["24CST-301", "24CST-302", "24CSP-305", "24CST-304", "24TDT-312", "24CSH-306", "24UCT-310"].map((code) => [code, 0.99])) }) });
  const noTimetable = base();
  noTimetable.snapshot.slots = [];
  add("no-timetable", { data: noTimetable });
  const noHistory = base();
  noHistory.history = null;
  add("no-history", { data: noHistory });
  const long = base();
  long.snapshot.subjects[0].title = "Project Based Learning in Java with Lab and Industry Mentorship";
  long.snapshot.subjects[3].title = "Design and Analysis of Algorithms (Advanced Topics, Section B)";
  for (const slot of long.snapshot.slots) {
    if (slot.shortCode === long.snapshot.subjects[0].code) slot.title = long.snapshot.subjects[0].title;
    if (slot.shortCode === long.snapshot.subjects[3].code) slot.title = long.snapshot.subjects[3].title;
  }
  add("long-titles", { data: long });
  // A new subject with no classes yet, and one CUIMS lists with no timetable slot.
  const zero = base();
  zero.snapshot.subjects.push({ code: "24CSR-399", title: "Seminar", attended: 0, delivered: 0, leave: { vdl: 0, idl: 0, adl: 0, ml: 0 } });
  zero.snapshot.subjects.push({ code: "24XYZ-111", title: "Industrial Training", attended: 9, delivered: 10, leave: { vdl: 0, idl: 0, adl: 0, ml: 0 } });
  add("odd-subjects", { data: zero });
  add("far-end", { extra: { forecastEnd: "2027-01-29" } });
  add("classes-over", { now: at("2026-11-25", 11, 0) });
  add("sunday", { now: at("2026-10-11", 12, 0) });
  add("evening", { now: at("2026-10-09", 19, 30) });
  add("planned", { extra: { attendancePlan: { v: 2, keys: ["2026-10-09|24CSH306@680", "2026-10-10|24TDT312@580", "2026-10-10|24CST304@630"] } } });
  // Last read yesterday evening: nothing reads until Refresh.
  add("old-read", { readAgo: 16 * 60 * 60_000 });
  add("cooldown", { extra: { attendanceLastAttemptAt: at("2026-10-09", 10, 4) } });
  add("throttled", {
    extra: {
      attendanceBackoffUntil: at("2026-10-09", 10, 14),
      attendanceStatus: { working: false, code: "portal-busy", error: "CUIMS is busy right now. Showing your last read. Next try in 9 min.", at: at("2026-10-09", 10, 4) },
    },
  });
  list.empty = { now: at("2026-10-09", 10, 5), data: { attendanceSnapshot: null, attendanceHistory: null } };
  return list;
}

export function preparePopup(source, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(source, dir, { recursive: true });
  writeFileSync(path.join(dir, "scenarios.js"), `window.__SCENARIOS = ${JSON.stringify(scenarios())};`);
  writeFileSync(path.join(dir, "stub.js"), `(() => {
  const query = new URLSearchParams(location.search);
  const scenario = window.__SCENARIOS[query.get("scenario") || "default"];
  const FROZEN = scenario.now;
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FROZEN])); }
    static now() { return FROZEN; }
  }
  window.Date = FrozenDate;
  const theme = query.get("theme") || "clear";
  try { localStorage.setItem("cuims-clear:theme", theme); } catch {}
  const data = Object.assign({ uid: "24BCS10000", password: "x", popupView: query.get("view") || "forecast", theme, attendanceGoal: query.get("goal") || "standard",
    attendanceStatus: null, forecastEnd: "", attendancePlan: null, rateNudge: { done: true } }, JSON.parse(JSON.stringify(scenario.data)));
  const listeners = [];
  const pick = (d) => (typeof d === "string" ? { [d]: data[d] } : Array.isArray(d) ? Object.fromEntries(d.map((k) => [k, data[k]])) : Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in data ? data[k] : v])));
  const local = { get: (d, cb) => { const v = pick(d); cb?.(v); return Promise.resolve(v); }, set: (v, cb) => { Object.assign(data, v); cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } };
  window.__stored = data;
  window.__fire = (changes) => {
    for (const [key, change] of Object.entries(changes)) data[key] = change.newValue;
    listeners.forEach((fn) => fn(changes, "local"));
  };
  window.__sent = [];
  window.chrome = {
    storage: { local, onChanged: { addListener(fn) { listeners.push(fn); } } },
    runtime: { sendMessage: (m, cb) => { window.__sent.push(m.type); cb?.({ snapshot: data.attendanceSnapshot }); }, getManifest: () => ({ version: "${JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8")).version}" }), lastError: null, getURL: (p) => p },
    permissions: { contains: (o, cb) => cb?.(true), request: (o, cb) => cb?.(true) },
    tabs: { query: async () => [] },
  };
})();`);
  const html = readFileSync(path.join(dir, "popup.html"), "utf8");
  writeFileSync(path.join(dir, "popup.html"), html.replace('<script src="themes.js">', '<script src="scenarios.js"></script><script src="stub.js"></script><script src="themes.js">'));
  return dir;
}
