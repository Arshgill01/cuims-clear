// The login tab's side of the shared CUIMS session: CUIMS keeps one captcha
// per session, and the background sign-in shares this tab's cookies.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { contentSource } from "./content-source.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const TIME_ORIGIN = 1_700_000_000_000;

function loginTab(browser, { pathname = "/Login.aspx", navigation = "navigate", captchaFetchStart = 400, read = { text: "Ab12", confident: true } } = {}) {
  const written = [];
  const assigned = [];
  let loginClicks = 0;
  const pageListeners = {};
  const image = { src: "https://students.cuchd.in/GenerateCaptcha.aspx?1", dataset: {}, complete: true, naturalWidth: 100, naturalHeight: 30, style: {}, addEventListener() {} };
  const answer = { value: "", dataset: {}, placeholder: "", dispatchEvent() {}, focus() {} };
  const password = { value: "secret", dispatchEvent() {}, focus() {} };
  const document = {
    documentElement: {},
    body: { appendChild() {}, innerText: "" },
    addEventListener() {},
    getElementById() { return null; },
    createElement() { return { dataset: {}, style: {}, setAttribute() {}, remove() {} }; },
    querySelector(selector) {
      if (selector.includes("imgCaptcha") || selector.includes("GenerateCaptcha")) return image;
      if (selector.includes("btnLogin")) return { click() { loginClicks++; } };
      if (selector.includes("type='password'")) return password;
      if (selector.includes("captcha")) return answer;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const window = {};
  window.top = window;
  const context = vm.createContext({
    document,
    window,
    location: { pathname, assign: (url) => assigned.push(url), replace: (url) => assigned.push(url) },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    performance: {
      timeOrigin: TIME_ORIGIN,
      getEntriesByType: (type) => (type === "navigation" ? [{ type: navigation }] : []),
      getEntriesByName: (name) => (name === image.src && captchaFetchStart ? [{ fetchStart: captchaFetchStart }] : []),
    },
    addEventListener: (type, fn) => (pageListeners[type] = fn),
    chrome: {
      storage: {
        local: { get: () => {}, set: (values) => written.push(values) },
        onChanged: { addListener() {} },
      },
      runtime: { sendMessage() {} },
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame: () => 0,
    Event: class { constructor(type) { this.type = type; } },
    Math,
    console: { warn() {}, log() {} },
    image, answer, password,
  });
  context.globalThis = context;
  vm.runInContext(contentSource(browser), context);
  vm.runInContext(`settings.uid = "TEST123"; settings.password = "secret"; CuimsCaptcha.readImage = () => (${JSON.stringify(read)});`, context);
  return {
    call: (expression) => vm.runInContext(expression, context),
    written, assigned, pageListeners, image, answer,
    loginClicks: () => loginClicks,
  };
}

for (const browser of ["chrome", "firefox"]) {
  test(`${browser}: a login page says so the moment it starts, before its captcha loads`, () => {
    const tab = loginTab(browser, { pathname: "/" });
    assert.ok(tab.written.some((values) => Number(values.tabLoginTouchAt) > 0), "tabLoginTouchAt is written at document_start");
  });

  test(`${browser}: other CUIMS pages never claim the login flow`, () => {
    const tab = loginTab(browser, { pathname: "/StudentHome.aspx" });
    assert.equal(tab.written.some((values) => "tabLoginTouchAt" in values), false);
  });

  test(`${browser}: a login page restored from history starts over instead of submitting a dead captcha`, () => {
    const tab = loginTab(browser, { navigation: "back_forward" });
    tab.call("prepareCaptchaStep(password)");
    assert.deepEqual(tab.assigned, ["https://students.cuchd.in/"]);
    assert.equal(tab.loginClicks(), 0);
  });

  test(`${browser}: a page shown again from the back/forward cache starts over`, () => {
    const tab = loginTab(browser);
    tab.pageListeners.pageshow?.({ persisted: true });
    assert.deepEqual(tab.assigned, ["https://students.cuchd.in/"]);
  });

  test(`${browser}: a fresh login page solves and submits once`, () => {
    const tab = loginTab(browser);
    tab.call("prepareCaptchaStep(password)");
    assert.equal(tab.answer.value, "Ab12");
    assert.equal(tab.loginClicks(), 1);
    assert.deepEqual(tab.assigned, []);
  });

  test(`${browser}: the captcha counts as issued when its own request went out`, () => {
    const tab = loginTab(browser, { captchaFetchStart: 900 });
    assert.equal(tab.call("captchaIssuedAt(image)"), TIME_ORIGIN + 900);
  });

  test(`${browser}: a background touch before this captcha's request does not restart the login`, () => {
    const tab = loginTab(browser, { captchaFetchStart: 900 });
    tab.call(`sharedLogin.bgLoginTouchAt = ${TIME_ORIGIN + 500}`);
    tab.call("prepareCaptchaStep(password)");
    assert.deepEqual(tab.assigned, []);
    assert.equal(tab.loginClicks(), 1);
  });

  test(`${browser}: a background touch after this captcha was drawn restarts instead of submitting`, () => {
    const tab = loginTab(browser, { captchaFetchStart: 900 });
    tab.call(`sharedLogin.bgLoginTouchAt = ${TIME_ORIGIN + 2_000}`);
    tab.call("prepareCaptchaStep(password)");
    assert.deepEqual(tab.assigned, ["https://students.cuchd.in/"]);
    assert.equal(tab.loginClicks(), 0);
  });

  test(`${browser}: the tab waits while a background sign-in is running`, () => {
    const tab = loginTab(browser);
    tab.call(`sharedLogin.bgSignInUntil = Date.now() + 60_000`);
    tab.call("prepareCaptchaStep(password)");
    assert.equal(tab.answer.value, "Ab12", "filled for the student to see");
    assert.equal(tab.loginClicks(), 0);
  });
}
