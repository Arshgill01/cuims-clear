import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { semester } from "./forecast-fixture.mjs";

const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

function memoryStorage(seed = {}) {
  const data = structuredClone(seed);
  return {
    data,
    get: async (defaults) => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in data ? structuredClone(data[key]) : value])),
    set: async (values) => Object.assign(data, structuredClone(values)),
  };
}

function load(names) {
  const context = vm.createContext({ console, Date, Math, JSON, Promise, Intl, Number, String, Array, Object, Set, Map, atob, setTimeout });
  context.globalThis = context;
  for (const name of names) vm.runInContext(read(name), context, { filename: name });
  return context;
}

test("the ledger counts what it is told, keeps the last 24 codes, and drops anything that is not a code", async () => {
  const { CuimsLedger: L } = load(["ledger.js"]);
  const storage = memoryStorage();
  await Promise.all([L.bump(storage, { captchas: 1, code: "K7mX" }, 1000), L.bump(storage, { logins: 1 }, 2000), L.bump(storage, { hidden: 2, code: "nope!" }, 3000)]);
  const ledger = L.normalize(storage.data.cuimsLedger);
  assert.deepEqual({ ...ledger, codes: [...ledger.codes] }, { since: 1000, captchas: 1, logins: 1, hidden: 2, reads: 0, codes: ["K7mX"] });
  for (let i = 0; i < 30; i += 1) await L.bump(storage, { captchas: 1, code: `A${String(i).padStart(3, "0")}` });
  const after = L.normalize(storage.data.cuimsLedger);
  assert.equal(after.captchas, 31);
  assert.equal(after.codes.length, L.CODES_MAX);
  assert.equal(after.codes.at(-1), "A029");
  assert.equal(L.keystrokes(after, 10), 31 * 4 + 1 * 11);
  assert.equal(L.savedSeconds({ logins: 2, hidden: 5, reads: 1 }), 2 * 18 + 5 * 4 + 40);
});

test("a storage failure never throws into the login page", async () => {
  const { CuimsLedger: L } = load(["ledger.js"]);
  const broken = { get: async () => { throw new Error("gone"); }, set: async () => {} };
  assert.equal(await L.bump(broken, { captchas: 1 }), null);
});

function club() {
  return load(["attendance-model.js", "academic-calendar.js", "attendance-view.js", "ledger.js", "celebrate.js"]).CuimsClub;
}

test("the receipt reads the semester from the saved attendance and history", () => {
  const C = club();
  const { snapshot, history } = semester({ until: "2026-10-08" });
  const stats = C.semesterStats(snapshot, history, "cu");
  const attended = snapshot.subjects.reduce((sum, s) => sum + s.attended, 0);
  const delivered = snapshot.subjects.reduce((sum, s) => sum + s.delivered, 0);
  assert.equal(stats.attended, attended);
  assert.equal(stats.delivered, delivered);
  assert.ok(stats.streak > 1);
  assert.match(stats.missedDay, /^[A-Z]+DAY$/);
  assert.equal(C.semesterStats(null, null, "cu"), null);
});

test("an empty ledger prints a note instead of zeros; founders get their line", () => {
  const C = club();
  const lines = C.receiptLines({ ledger: null, semester: null, version: "1.0.0", founder: true, best: 0 });
  assert.ok(lines.some((line) => line.t === "note"));
  assert.ok(!lines.some((line) => line.l === "CAPTCHAS READ"));
  assert.ok(lines.some((line) => /FOUNDING 100/.test(line.text || "")));
  const plain = C.receiptLines({ ledger: { since: 1, captchas: 3, codes: ["K7mX"] }, semester: null, version: "1.0.0", founder: false, best: 12 });
  assert.ok(plain.some((line) => line.l === "CAPTCHAS READ" && line.r === "3"));
  assert.ok(plain.some((line) => line.t === "codes"));
  assert.ok(plain.some((line) => line.l === "PROXY RUN BEST"));
  assert.ok(!plain.some((line) => /FOUNDING/.test(line.text || "")));
});

test("the time capsule opens on the semester's last day of classes, or the next one's", () => {
  const C = club();
  assert.equal(C.capsuleOpensOn("2026-10-16", "cu", []), "2026-11-13");
  // Under a week from the end: the next semester's last day.
  assert.equal(C.capsuleOpensOn("2026-11-10", "cu", []), "2027-04-23");
  // Past the calendar: three months.
  assert.equal(C.capsuleOpensOn("2028-01-01", "cu", []), "2028-03-31");
});

test("the 1.0 tab has news until visited, and again when a capsule comes due", () => {
  const C = club();
  assert.equal(C.hasNews({ clubSeen: null }, "2026-10-16"), true);
  assert.equal(C.hasNews({ clubSeen: { at: Date.parse("2026-10-16T10:00:00+05:30") } }, "2026-10-17"), false);
  const capsule = { opensOn: "2026-11-13", broken: false };
  const seen = { at: Date.parse("2026-10-20T10:00:00+05:30") };
  assert.equal(C.hasNews({ clubSeen: seen, timeCapsule: capsule }, "2026-11-12"), false);
  assert.equal(C.hasNews({ clubSeen: seen, timeCapsule: capsule }, "2026-11-13"), true);
});

test("founding: an update from before 1.0 is a founder, a fresh install is not, and it is decided once", async () => {
  async function run(events, seed = {}) {
    const listeners = [];
    const storage = memoryStorage(seed);
    const context = vm.createContext({ console, Date, Number, String, Boolean, chrome: { runtime: { onInstalled: { addListener: (fn) => listeners.push(fn) } }, storage: { local: storage } } });
    context.globalThis = context;
    vm.runInContext(read("update-check.js"), context);
    vm.runInContext(read("celebrate-bg.js"), context);
    for (const details of events) {
      listeners.forEach((fn) => fn(details));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return storage.data.founding;
  }
  assert.equal((await run([{ reason: "update", previousVersion: "0.10.6" }])).founder, true);
  assert.equal((await run([{ reason: "update", previousVersion: "0.10.6" }])).from, "0.10.6");
  assert.equal((await run([{ reason: "install" }])).founder, false);
  assert.equal((await run([{ reason: "install" }, { reason: "update", previousVersion: "0.9.0" }])).founder, false);
  assert.equal((await run([{ reason: "update", previousVersion: "0.10.6" }, { reason: "update", previousVersion: "1.0.0" }])).founder, true);
});

test("both builds ship the 1.0 files the same, and the popup loads them", () => {
  for (const name of ["ledger.js", "proxy-run.js", "celebrate.js", "celebrate.css", "celebrate-bg.js"]) {
    assert.equal(readFileSync(new URL(`../outputs/cuims-clear-chrome/${name}`, import.meta.url), "utf8"), read(name), name);
  }
  const html = read("popup.html");
  for (const name of ["captcha-glyphs.js", "ledger.js", "proxy-run.js", "celebrate.js"]) assert.ok(html.indexOf(`src="${name}"`) < html.indexOf('src="popup.js"'), name);
  assert.match(html, /id="tab-club"/);
  assert.match(html, /id="view-club"/);
});
