import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function runtime(browser, { pageText = "", uidStep = false } = {}) {
  const storage = memoryStorage();
  const sessionStorage = memoryStorage();
  const uid = { value: "", dispatchEvent() {} };
  let nextClicks = 0;
  const next = { click() { nextClicks++; } };
  let status;
  const body = {
    innerText: pageText,
    appendChild(element) { status = element; },
  };
  const document = {
    documentElement: null,
    body,
    addEventListener() {},
    getElementById(id) { return status?.id === id ? status : null; },
    createElement() {
      return {
        dataset: {}, style: {}, setAttribute() {},
        remove() { status = undefined; },
      };
    },
    querySelector(selector) {
      if (!uidStep) return null;
      if (selector.includes("txtUserId")) return uid;
      if (selector.includes("btnNext")) return next;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    document,
    location: { pathname: "/Login.aspx" },
    localStorage: storage,
    sessionStorage,
    chrome: { storage: { onChanged: { addListener() {} } }, runtime: { sendMessage() {} } },
    Event: class { constructor(type) { this.type = type; } },
    console,
  });
  const script = readFileSync(new URL(`../outputs/cuims-clear-${browser}/content.js`, import.meta.url), "utf8");
  vm.runInContext(script, context);
  return {
    call: (expression) => vm.runInContext(expression, context),
    storage,
    body,
    uid,
    get nextClicks() { return nextClicks; },
    get status() { return status; },
  };
}

for (const browser of ["chrome", "firefox"]) {
  test(`${browser}: returning to UID step preserves the auto-submit budget`, () => {
    const app = runtime(browser, { uidStep: true });
    app.call("settings.autoSolveCaptcha = false; recordAutoSubmit(1000); recordAutoSubmit(1001); recordAutoSubmit(1002)");
    app.call("prepareLogin(); prepareLogin()");
    assert.equal(app.call("readFailureState(1003).failures"), 3);
    assert.equal(app.call("canAutoSubmit(1003).reason"), "budget");
    // Budget stays exhausted while the attempts are recent (within CUIMS's window).
    assert.equal(app.call("readFailureState(1000 + 10 * 60 * 1000).budgetExhausted"), true);
    // A stale run (older than the lockout window) is cleared so a new session is not blocked.
    assert.equal(app.call("readFailureState(1000 + 21 * 60 * 1000).budgetExhausted"), false);
  });

  test(`${browser}: UID-only page is recognized and advances a saved login`, () => {
    const app = runtime(browser, { uidStep: true });
    app.call("settings.uid = 'TEST123'; settings.autoSolveCaptcha = false; prepareLogin()");
    assert.equal(app.uid.value, "TEST123");
    assert.equal(app.uid.autocomplete, "username");
    assert.equal(app.nextClicks, 1);
  });

  test(`${browser}: a portal lockout shows a wait message and blocks auto-submit`, () => {
    const app = runtime(browser, { pageText: "Your account is locked. Please try after 20 minutes." });
    app.call("scanPortalFailureSignals()");
    assert.match(app.status.textContent, /Wait before trying again/);
    assert.equal(app.call("canAutoSubmit().ok"), false);
  });

  test(`${browser}: recent auto-submit error does not double-count`, () => {
    const app = runtime(browser);
    app.call("recordAutoSubmit(1000)");
    assert.equal(app.call("recordDetectedFailure({ lockout: false }, 1500).counted"), false);
    assert.equal(app.call("readFailureState(1500).failures"), 1);
  });

  test(`${browser}: transient CUIMS server error releases a recent attempt`, () => {
    const app = runtime(browser, { pageText: "Service is temporarily unavailable. Please try again later." });
    app.call("recordAutoSubmit(Date.now()); scanPortalFailureSignals()");
    assert.equal(app.call("readFailureState().failures"), 0);
    assert.match(app.status.textContent, /temporarily unavailable/);
  });

  test(`${browser}: only 4–6 alphanumeric reads auto-submit`, () => {
    const app = runtime(browser);
    assert.equal(app.call("mayAutoSubmitSolution({text: 'ofh7', confidence: 10})"), true);
    assert.equal(app.call("mayAutoSubmitSolution({text: 'ofh!', confidence: 99})"), false);
    assert.equal(app.call("mayAutoSubmitSolution({text: 'ab', confidence: 99})"), false);
  });

  for (const [name, expected] of [
    ["lockout", "lockout"],
    ["invalid-captcha", "error"],
    ["invalid-password", "error"],
  ]) {
    test(`${browser}: ${name} fixture is detected by the shipped script`, () => {
      const html = readFileSync(new URL(`./fixtures/login/${name}.html`, import.meta.url), "utf8");
      const app = runtime(browser, { pageText: html.replace(/<[^>]*>/g, " ") });
      assert.equal(app.call("detectPortalFailure()?.kind"), expected);
    });
  }
}
