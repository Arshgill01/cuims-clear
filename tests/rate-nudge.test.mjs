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
const open = (state, d, healthy = true) => R.step(state, { now: START + d * DAY, today: `day${d}`, healthy });

test("the ask shows from the first working read, at the top once a day", () => {
  let r = open(null, 0);
  assert.equal(r.show, "ask");
  assert.equal(r.top, true, "the day's first open puts it at the top");
  r = open(r.state, 0);
  assert.equal(r.show, "ask");
  assert.equal(r.top, false, "later opens that day use the bottom strip");
  r = open(r.state, 1);
  assert.equal(r.top, true, "the next day starts at the top again");
});

test("no attendance yet, or a failed read, keeps the ask away", () => {
  assert.equal(open(null, 0, false).show, "");
  assert.equal(open(null, 0, false).top, false);
});

test("Already rated ends it for good", () => {
  const done = R.rated(open(null, 0).state);
  for (const d of [0, 1, 30, 365]) assert.equal(open(done, d).show, "");
});

test("after Rate the popup asks whether they rated; yes ends it, not yet goes back to asking", () => {
  const opened = R.opened(open(null, 0).state);
  const r = open(opened, 0);
  assert.equal(r.show, "confirm");
  assert.equal(r.top, false, "the question never jumps to the top");
  assert.equal(open(R.rated(r.state), 1).show, "");
  assert.equal(open(R.notYet(r.state), 1).show, "ask");
});

test("× hides it for three days; the third × hides it for good", () => {
  let state = R.snooze(open(null, 0).state, START);
  assert.equal(open(state, 2).show, "");
  assert.equal(open(state, 3).show, "ask");
  state = R.snooze(open(state, 3).state, START + 3 * DAY);
  assert.equal(open(state, 6).show, "ask");
  state = R.snooze(open(state, 6).state, START + 6 * DAY);
  assert.equal(state.done, true);
  assert.equal(open(state, 400).show, "");
});

test("bad stored values are treated as a fresh start", () => {
  const { state, show } = R.step("junk", { now: START, today: "day0", healthy: true });
  assert.equal(show, "ask");
  assert.equal(state.done, false);
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
    if (!elements.has(id)) elements.set(id, { id, value: "", checked: true, hidden: true, innerHTML: "", textContent: "", href: "", addEventListener(event, fn) { this[event] = fn; }, focus() {}, setAttribute() {}, querySelector: (sel) => (id === "#rate-nudge" ? element(sel) : null), querySelectorAll: () => [], replaceChildren() {}, append() {}, matches: () => false, classList: classes() });
    return elements.get(id);
  };
  const links = [element(".rate-link#1"), element(".rate-link#2")];
  const moves = [];
  const timers = [];
  const changes = [];
  Object.assign(element("#views"), { before: () => moves.push("before"), after: () => moves.push("after") });
  const button = (action) => ({ closest: () => ({ dataset: { rate: action } }) });
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
    window: { clearTimeout() {}, setTimeout(fn) { timers.push(fn); return timers.length; }, setInterval() {}, clearInterval() {} },
    CSS: { escape: (v) => v },
    CuimsAttendance: {
      buildAnalytics() { return null; },
      renderAttendance() { return ""; },
      buildForecast() { return null; },
      renderForecast() { return ""; },
      bindForecastCharts: () => ({ busy: () => false }),
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
        onChanged: { addListener(fn) { changes.push(fn); } },
      },
      runtime: { getManifest: () => ({ version: "0.9.1" }), sendMessage() {} },
      permissions: { contains() {}, request() {} },
    },
  });
  vm.runInContext(read("firefox", "rate-nudge.js"), context);
  vm.runInContext(read("firefox", "popup.js"), context);
  return { element, links, names, store, moves, timers, button, tabs: (name) => element(`#tab-${name}`),
    update(values) {
      Object.assign(store, values);
      const records = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
      changes.forEach((fn) => fn(records, "local"));
    },
  };
}

const fresh = { fetchedAt: new Date().toISOString(), subjects: [{ name: "Maths" }] };

test("popup: the day's first ask sits at the top, the strip is only on Attendance, × ends today's ask", () => {
  const p = popup({ rateNudge: null, snapshot: fresh });
  const strip = p.element("#rate-nudge");
  assert.equal(strip.hidden, false);
  assert.equal(strip.classList.contains("is-top"), true);
  assert.equal(p.moves.at(-1), "before");
  assert.equal(p.links[0].href, "https://addons.mozilla.org/firefox/addon/cuims-clear/");
  assert.equal(p.names[0].textContent, "Firefox Add-ons");

  p.timers.at(-1)();
  assert.equal(strip.classList.contains("is-top"), false, "the timer moves it down");
  assert.equal(p.moves.at(-1), "after");

  p.tabs("settings").click();
  assert.equal(strip.hidden, true, "only beside the attendance view");
  p.tabs("attendance").click();
  assert.equal(strip.hidden, false);

  strip.click({ target: p.button("snooze") });
  assert.equal(strip.hidden, true);
  assert.equal(p.store.rateNudge.snoozes, 1);
});

test("popup: Rate turns the strip into the did-you-rate question; yes ends it", () => {
  const p = popup({ rateNudge: { topDay: "x" }, snapshot: fresh });
  const strip = p.element("#rate-nudge");
  p.links[0].click();
  assert.equal(p.store.rateNudge.opened, true);
  assert.equal(strip.hidden, false);
  assert.equal(p.element(".rate-confirm").hidden, false);
  assert.equal(p.element(".rate-ask").hidden, true);
  strip.click({ target: p.button("rated") });
  assert.equal(p.store.rateNudge.done, true);
  assert.equal(strip.hidden, true);
});

test("popup keeps the strip hidden under a failed read, with no attendance, or once rated", () => {
  assert.equal(popup({ rateNudge: null, snapshot: fresh, status: { error: "Session ended", code: "x" } }).element("#rate-nudge").hidden, true);
  assert.equal(popup({ rateNudge: null, snapshot: null }).element("#rate-nudge").hidden, true);
  assert.equal(popup({ rateNudge: { done: true }, snapshot: fresh }).element("#rate-nudge").hidden, true);
});


test("popup: the first successful read shows the ask without reopening", () => {
  const p = popup({ rateNudge: null, snapshot: null });
  p.update({ attendanceSnapshot: fresh, attendanceStatus: { working: false } });
  assert.equal(p.element("#rate-nudge").hidden, false);
  assert.equal(p.element("#rate-nudge").classList.contains("is-top"), true);
});

test("popup: Settings does not consume the daily banner before Attendance is shown", () => {
  const p = popup({ rateNudge: null, snapshot: fresh, view: "settings" });
  assert.equal(p.store.rateNudge?.topDay || "", "");
  p.tabs("attendance").click();
  assert.equal(p.element("#rate-nudge").classList.contains("is-top"), true);
});

test("popup: clearing attendance hides the rating ask", () => {
  const p = popup({ rateNudge: null, snapshot: fresh });
  p.update({ attendanceSnapshot: null, attendanceStatus: null });
  assert.equal(p.element("#rate-nudge").hidden, true);
});
