import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (browser, name) => readFileSync(new URL(`../outputs/cuims-clear-${browser}/${name}`, import.meta.url), "utf8");

function loadRate() {
  const context = vm.createContext({});
  vm.runInContext(read("firefox", "rate-nudge.js"), context);
  return context.CuimsRate;
}

const R = loadRate();
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 1, 6);
const key = (n) => `2026-10-${String(n + 1).padStart(2, "0")}`;

// Opens the popup once a day from day `from` to day `to`, every day with a fresh, working read.
function openDaily(state, from, to, ctx = {}) {
  const shown = [];
  for (let d = from; d <= to; d += 1) {
    const result = R.step(state, { now: START + d * DAY, today: key(d), used: true, healthy: true, ...ctx });
    state = result.state;
    if (result.show) shown.push(d);
  }
  return { state, shown };
}

test("the ask waits for a week and five days of working reads", () => {
  const { shown } = openDaily(null, 0, 7);
  assert.deepEqual(shown, [7], "first shown on day 7, once five read days and a week have passed");

  // Reads on only four days: never asks, however long it has been.
  let state = null;
  for (const d of [0, 10, 20, 30]) state = R.step(state, { now: START + d * DAY, today: key(d), used: true, healthy: true }).state;
  assert.equal(R.step(state, { now: START + 40 * DAY, today: "2026-11-10", used: false, healthy: true }).show, false);
});

test("a failed read keeps the ask away", () => {
  const { state } = openDaily(null, 0, 6);
  assert.equal(R.step(state, { now: START + 7 * DAY, today: key(7), used: true, healthy: false }).show, false);
});

test("the ask shows on three days, sleeps 30 days, gets one more round, then stops for good", () => {
  let { state, shown } = openDaily(null, 0, 9);
  assert.deepEqual(shown, [7, 8, 9]);
  // Opening twice on a shown day does not use up a second show.
  assert.equal(R.step(state, { now: START + 9 * DAY + 1000, today: key(9), used: true, healthy: true }).state.shownDays.length, 3);

  const quiet = [];
  for (let d = 10; d < 40; d += 1) {
    const result = R.step(state, { now: START + d * DAY, today: `d${d}`, used: true, healthy: true });
    state = result.state;
    if (result.show) quiet.push(d);
  }
  assert.deepEqual(quiet, [], "snoozed for 30 days after an ignored round");

  const second = [];
  for (let d = 40; d < 120; d += 1) {
    const result = R.step(state, { now: START + d * DAY, today: `d${d}`, used: true, healthy: true });
    state = result.state;
    if (result.show) second.push(d);
  }
  assert.deepEqual(second, [40, 41, 42], "one more round, then never again");
  assert.equal(state.done, true);
});

test("rating or dismissing ends the ask", () => {
  const { state } = openDaily(null, 0, 7);
  const done = R.finish(state);
  assert.equal(R.step(done, { now: START + 8 * DAY, today: key(8), used: true, healthy: true }).show, false);
});

test("bad stored values are treated as a fresh start", () => {
  const { state, show } = R.step("junk", { now: START, today: key(0), used: true, healthy: true });
  assert.equal(show, false);
  assert.equal(state.firstSeen, START);
  assert.deepEqual([...state.days], [key(0)]);
});

test("each build links to its own store's review page", () => {
  assert.equal(R.store("moz-extension:").url, "https://addons.mozilla.org/firefox/addon/cuims-clear/");
  assert.equal(R.store("chrome-extension:").url, "https://chromewebstore.google.com/detail/amlobigbjldbogimakmfndkdaekcdbkf/reviews");
  for (const browser of ["firefox", "chrome"]) {
    assert.equal(read(browser, "rate-nudge.js"), read("firefox", "rate-nudge.js"), `${browser} ships the same rate-nudge.js`);
    const html = read(browser, "popup.html");
    assert.ok(html.indexOf('src="rate-nudge.js"') < html.indexOf('src="popup.js"'), "loaded before popup.js");
    assert.ok(html.includes('id="rate-nudge"') && html.includes("hidden>"), "the strip starts hidden");
    assert.ok(html.includes('class="rate-line"'), "Settings always has a rate link");
  }
});

// The popup end to end with a stubbed browser: shown only on the attendance
// view, never under an error, and either button ends it.
function popup({ rateNudge, snapshot, status = null, view = "attendance" }) {
  const elements = new Map();
  const classes = () => {
    const set = new Set();
    return { add: (n) => set.add(n), remove: (n) => set.delete(n), contains: (n) => set.has(n), toggle: (n, on) => (on ? set.add(n) : set.delete(n)) };
  };
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: "", checked: true, hidden: true, innerHTML: "", textContent: "", href: "", addEventListener(event, fn) { this[event] = fn; }, focus() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {}, classList: classes() });
    return elements.get(id);
  };
  const links = [element(".rate-link#1"), element(".rate-link#2")];
  const names = [element(".rate-store#1")];
  const store = { rateNudge, attendanceSnapshot: snapshot, attendanceStatus: status, popupView: view, uid: "U", password: "p" };
  const context = vm.createContext({
    document: {
      querySelector: element,
      querySelectorAll: (sel) => (sel === ".rate-link" ? links : sel === ".rate-store" ? names : []),
      addEventListener() {},
      createElement: () => ({ setAttribute() {}, append() {} }),
    },
    location: { protocol: "moz-extension:" },
    window: { clearTimeout() {}, setTimeout() {}, setInterval() {}, clearInterval() {} },
    CSS: { escape: (v) => v },
    CuimsAttendance: {
      buildAnalytics() { return null; },
      renderAttendance() { return ""; },
      escapeHtml: (v) => String(v),
      campusParts: (date) => ({ key: date.toISOString().slice(0, 10) }),
    },
    CuimsThemes: { list: [], mirrored: () => "clear", valid: (id) => id, tokens: () => ({}), load: () => new Promise(() => {}), save() {}, onChange() {}, applyToPopup() {} },
    chrome: {
      storage: {
        local: {
          get(defaults, callback) { callback({ ...defaults, ...Object.fromEntries(Object.entries(store).filter(([k]) => k in defaults)) }); },
          set(values, callback) { Object.assign(store, values); callback?.(); },
          remove(keys, callback) { callback(); },
        },
        onChanged: { addListener() {} },
      },
      runtime: { getManifest: () => ({ version: "0.9.1" }), sendMessage() {} },
      permissions: { contains() {}, request() {} },
    },
  });
  vm.runInContext(read("firefox", "rate-nudge.js"), context);
  vm.runInContext(read("firefox", "popup.js"), context);
  return { element, links, names, store, tabs: (name) => element(`#tab-${name}`) };
}

const today = new Date().toISOString().slice(0, 10);
const ready = { firstSeen: Date.now() - 8 * DAY, days: ["a", "b", "c", "d"], shownDays: [], round: 0, snoozeUntil: 0, done: false };
const fresh = { fetchedAt: new Date().toISOString(), subjects: [{ name: "Maths" }] };

test("popup shows the strip on Attendance once the student qualifies, and × ends it", () => {
  const p = popup({ rateNudge: ready, snapshot: fresh });
  const strip = p.element("#rate-nudge");
  assert.equal(strip.hidden, false);
  assert.deepEqual([...p.store.rateNudge.days], ["a", "b", "c", "d", today]);
  assert.equal(p.links[0].href, "https://addons.mozilla.org/firefox/addon/cuims-clear/");
  assert.equal(p.names[0].textContent, "Firefox Add-ons");

  p.tabs("settings").click();
  assert.equal(strip.hidden, true, "only beside the attendance view");
  p.tabs("attendance").click();
  assert.equal(strip.hidden, false);

  p.element("#rate-dismiss").click();
  assert.equal(strip.hidden, true);
  assert.equal(p.store.rateNudge.done, true);
});

test("popup: pressing Rate ends the ask too", () => {
  const p = popup({ rateNudge: ready, snapshot: fresh });
  p.links[0].click();
  assert.equal(p.store.rateNudge.done, true);
  assert.equal(p.element("#rate-nudge").hidden, true);
});

test("popup keeps the strip hidden under a failed read or an old one", () => {
  assert.equal(popup({ rateNudge: ready, snapshot: fresh, status: { error: "Session ended", code: "x" } }).element("#rate-nudge").hidden, true);
  const old = { ...fresh, fetchedAt: new Date(Date.now() - 3 * DAY).toISOString() };
  assert.equal(popup({ rateNudge: ready, snapshot: old }).element("#rate-nudge").hidden, true);
});
