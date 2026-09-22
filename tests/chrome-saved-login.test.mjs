import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL(`../outputs/cuims-clear-chrome/${name}`, import.meta.url), "utf8");

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function login(solveResult = { text: "abcd", confidence: 88, score: 113, agreement: 1 }) {
  let nextClicks = 0;
  let loginClicks = 0;
  const uid = { value: "", dispatchEvent() {} };
  const password = { value: "", dispatchEvent() {}, focus() {} };
  const image = {
    src: "fixture.png",
    dataset: {},
    naturalHeight: 40,
    height: 40,
    complete: true,
    naturalWidth: 120,
    style: {},
    addEventListener() {},
  };
  const answer = { value: "", dataset: {}, placeholder: "", dispatchEvent() {}, focus() {} };
  const session = new Map();
  const local = memoryStorage();
  const context = vm.createContext({
    document: {
      documentElement: null,
      body: { appendChild() {} },
      addEventListener() {},
      getElementById() { return null; },
      createElement() {
        return { style: {}, setAttribute() {}, dataset: {} };
      },
      querySelector(selector) {
        if (selector.includes("txtUserId")) return uid;
        if (selector.includes("btnNext")) return { click() { nextClicks++; } };
        if (selector.includes("type='password'")) return password;
        if (selector.includes("btnLogin")) return { click() { loginClicks++; } };
        if (selector.includes("imgCaptcha") || selector.includes("GenerateCaptcha")) return image;
        if (selector.includes("captcha")) return answer;
        return null;
      },
      querySelectorAll() { return []; },
    },
    chrome: {
      storage: { onChanged: { addListener() {} } },
      runtime: { async sendMessage() { return solveResult; } },
    },
    location: { pathname: "/" },
    localStorage: local,
    sessionStorage: {
      getItem: (key) => session.get(key),
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key),
    },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout(fn) { fn(); },
    Math,
    console,
    image, answer, password,
  });
  vm.runInContext(source("content.js"), context);
  vm.runInContext('settings.uid = "TEST123"; settings.password = "fixture-password"; settings.autoSolveCaptcha = false; extractCaptchaVariants = () => ["fixture"];', context);
  return { context, uid, password, image, answer, nextClicks: () => nextClicks, loginClicks: () => loginClicks, local };
}

test("Chrome fills saved UID/password and advances without a browser password manager", () => {
  const state = login();
  vm.runInContext("prepareLogin()", state.context);
  assert.equal(state.uid.value, "TEST123");
  assert.equal(state.password.value, "fixture-password");
  assert.equal(state.nextClicks(), 1);
  vm.runInContext("prepareLogin()", state.context);
  assert.equal(state.nextClicks(), 1, "repeat scans respect the advance cooldown");
});

test("Chrome fills OCR result and submits only when automatic submission is enabled", async () => {
  const state = login();
  vm.runInContext("prepareLogin()", state.context);
  await vm.runInContext("solveCaptchaImage(image, answer, password)", state.context);
  assert.equal(state.answer.value, "abcd");
  assert.equal(state.loginClicks(), 1);
  vm.runInContext("settings.autoSubmitLogin = false", state.context);
  await vm.runInContext("solveCaptchaImage(image, answer, password)", state.context);
  assert.equal(state.loginClicks(), 1);
});

test("Chrome does not auto-submit a low-confidence OCR read", async () => {
  const state = login({ text: "abcd", confidence: 40, score: 65, agreement: 1 });
  vm.runInContext("prepareLogin()", state.context);
  await vm.runInContext("solveCaptchaImage(image, answer, password)", state.context);
  assert.equal(state.answer.value, "abcd");
  assert.equal(state.loginClicks(), 0);
});

test("Chrome stops auto-submit after three attempts", async () => {
  const state = login();
  vm.runInContext("prepareLogin()", state.context);
  for (let i = 0; i < 3; i++) {
    state.answer.dataset = {};
    state.image.dataset = {};
    await vm.runInContext("solveCaptchaImage(image, answer, password)", state.context);
  }
  assert.equal(state.loginClicks(), 3);
  state.answer.dataset = {};
  state.image.dataset = {};
  await vm.runInContext("solveCaptchaImage(image, answer, password)", state.context);
  assert.equal(state.loginClicks(), 3, "circuit breaker blocks the fourth auto-submit");
});

test("Chrome preserves a manually edited CAPTCHA instead of replacing or submitting it", async () => {
  const state = login();
  state.answer.value = "manual";
  state.answer.dataset.cuimsClearUserEdited = "1";
  await vm.runInContext("solveCaptchaImage(image, answer, password)", state.context);
  assert.equal(state.answer.value, "manual");
  assert.equal(state.loginClicks(), 0);
});

test("Chrome popup saves credentials and Clear login removes them without erasing preferences", () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", checked: true, addEventListener(event, fn) { this[event] = fn; }, focus() {}, setAttribute() {} });
    return elements.get(id);
  };
  let saved;
  let removed;
  vm.runInNewContext(source("popup.js"), {
    document: { querySelector: element },
    window: { clearTimeout() {}, setTimeout() {} },
    chrome: { storage: { local: {
      get(defaults, callback) { callback(defaults); },
      set(values, callback) { saved = values; callback(); },
      remove(keys, callback) { removed = Array.from(keys); callback(); },
    } } },
  });
  element("#uid").value = " TEST123 ";
  element("#password").value = "fixture-password";
  element("#settings-form").submit({ preventDefault() {} });
  assert.equal(saved.uid, "TEST123");
  assert.equal(saved.password, "fixture-password");
  element("#clear-login").click();
  assert.deepEqual(removed, ["uid", "password"]);
  assert.equal(element("#password").value, "");
});
