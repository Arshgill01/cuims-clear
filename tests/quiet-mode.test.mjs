import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { contentSource } from "./content-source.mjs";

// Quiet mode against dialogs the student asked for (0.9.0): a click or key
// press just before a dialog appears leaves it open; nothing else does.

function storage() {
  return {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
    setItem(key, value) { this.store.set(key, String(value)); },
    removeItem(key) { this.store.delete(key); },
  };
}

function dialog({ id = "", text, classes = [] }) {
  const properties = new Map();
  const classNames = new Set(classes);
  return {
    id,
    tagName: "DIV",
    textContent: text,
    dataset: {},
    isConnected: true,
    classList: {
      contains: (name) => classNames.has(name),
      add: (name) => classNames.add(name),
      remove: (name) => classNames.delete(name),
    },
    style: {
      getPropertyValue: (name) => properties.get(name)?.[0] || "",
      getPropertyPriority: (name) => properties.get(name)?.[1] || "",
      setProperty(name, value, priority = "") { properties.set(name, [value, priority]); },
      removeProperty: (name) => properties.delete(name),
    },
    removeAttribute() { delete this.dataset.cuimsClearSuppressed; },
    querySelectorAll: () => [],
  };
}

const hidden = (element) => element.style.getPropertyValue("display") === "none";

// One page load. `session` is the tab's sessionStorage, shared across loads.
function page(build, { path = "/StudentHome.aspx", session = storage(), clock }) {
  let dialogs = [];
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const context = vm.createContext({
    Date: FakeDate,
    document: {
      documentElement: null,
      body: { classList: { contains: () => false, remove() {} }, style: { removeProperty() {} }, querySelectorAll: () => [] },
      addEventListener() {},
      getElementById() { return null; },
      querySelector: () => null,
      querySelectorAll: (selector) => (selector === '[role="dialog"]' ? dialogs : []),
      createTreeWalker: () => ({ nextNode: () => false }),
    },
    chrome: { storage: { onChanged: { addListener() {} } }, runtime: { sendMessage() {} } },
    location: { pathname: path },
    localStorage: storage(),
    sessionStorage: session,
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (element) => ({ display: element.style.getPropertyValue("display") || "block" }),
  });
  vm.runInContext(contentSource(build), context);
  return {
    session,
    show(element) { dialogs = [...dialogs.filter((d) => d !== element), element]; },
    scan: () => vm.runInContext("scanPage()", context),
    act: () => vm.runInContext("noteGesture({ isTrusted: true })", context),
    run: (code) => vm.runInContext(code, context),
  };
}

const PROMO = "Register now for Techfest 2026, the annual cultural event";
const QUERIES = "My Question Or Queries · Ticket 4411 · Resolved · Give Rating";

for (const build of ["chrome", "firefox"]) {
  test(`${build}: a promo hidden on load stays hidden after the student clicks around`, () => {
    const clock = { now: 1_000_000 };
    const tab = page(build, { clock });
    const promo = dialog({ text: PROMO, classes: ["modal", "in"] });
    tab.show(promo);
    tab.scan();
    assert.ok(hidden(promo), "hidden on load");
    clock.now += 2000;
    tab.act();
    clock.now += 100;
    tab.scan();
    assert.ok(hidden(promo), "a click after the promo was already up did not ask for it");
  });

  test(`${build}: a dialog the student opened with a click is left open`, () => {
    const clock = { now: 1_000_000 };
    const tab = page(build, { clock });
    const queries = dialog({ text: QUERIES });
    tab.act();
    clock.now += 300;
    queries.classList.add("in");
    queries.style.setProperty("display", "block");
    tab.show(queries);
    tab.scan();
    assert.equal(hidden(queries), false);
    clock.now += 60_000;
    tab.scan();
    assert.equal(hidden(queries), false, "stays open until the page closes it");
  });

  test(`${build}: a key press on the login page does not let the dashboard's promo through`, () => {
    const clock = { now: 1_000_000 };
    const login = page(build, { path: "/", clock });
    login.act();
    clock.now += 3000;
    const home = page(build, { path: "/StudentHome.aspx", session: login.session, clock });
    const promo = dialog({ text: PROMO, classes: ["modal", "in"] });
    home.show(promo);
    home.scan();
    assert.ok(hidden(promo));
  });

  test(`${build}: a click that posts back the same page still counts for the dialog it opens`, () => {
    const clock = { now: 1_000_000 };
    const before = page(build, { path: "/frmMyQueries.aspx", clock });
    before.act();
    clock.now += 2500;
    const after = page(build, { path: "/frmMyQueries.aspx", session: before.session, clock });
    const queries = dialog({ text: QUERIES, classes: ["modal", "in"] });
    after.show(queries);
    after.scan();
    assert.equal(hidden(queries), false);
  });

  test(`${build}: a click long before a dialog appears does not count`, () => {
    const clock = { now: 1_000_000 };
    const tab = page(build, { clock });
    tab.act();
    clock.now += 20_000;
    const promo = dialog({ text: PROMO, classes: ["modal", "in"] });
    tab.show(promo);
    tab.scan();
    assert.ok(hidden(promo));
  });

  test(`${build}: CUIMS's class-feedback panel is hidden even right after a click`, () => {
    const clock = { now: 1_000_000 };
    const tab = page(build, { clock });
    tab.act();
    const panel = dialog({ id: "divSubjectFeedback", text: "Subject feedback: rate your teacher", classes: ["modal", "in"] });
    tab.show(panel);
    tab.scan();
    assert.ok(hidden(panel));
  });

  test(`${build}: quiet mode leaves the online test pages alone`, () => {
    const clock = { now: 1_000_000 };
    const tab = page(build, { path: "/frmMockTestNew.aspx", clock });
    const warning = dialog({ text: "Strict Warning! Do not switch tabs during the event", classes: ["modal", "in"] });
    tab.show(warning);
    tab.scan();
    assert.equal(hidden(warning), false);
  });

  test(`${build}: dialog keywords match whole words only`, () => {
    const tab = page(build, { clock: { now: 0 } });
    const kind = (text) => tab.run(`classifyModal(${JSON.stringify({ textContent: text, querySelectorAll: null })})`) || "";
    assert.equal(kind("Generating report, please wait"), "", "rating inside generating");
    assert.equal(kind("Select a subject to prevent duplicates"), "", "event inside prevent");
    assert.equal(kind("The manifest could not be loaded"), "");
    assert.equal(kind("Techfest 2026 is here"), "event");
    assert.equal(kind("Annual Cultural Festival"), "event");
    assert.equal(kind("Upcoming events this week"), "event");
    assert.equal(kind("Please share your feedback"), "feedback");
    assert.equal(kind("Rate your faculty"), "feedback");
  });

  test(`${build}: CUIMS's own page loader is never taken for an orphan wash`, () => {
    const tab = page(build, { clock: { now: 0 } });
    for (const label of ["loader-wrapper", "Loading...", "spinner", "progress", "PleaseWait"]) {
      assert.ok(tab.run(`LOADER_RE.test(${JSON.stringify(label)})`), label);
    }
    assert.equal(tab.run(`LOADER_RE.test("event-popup-wash")`), false);
  });
}
