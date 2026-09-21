import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL(`../outputs/cuims-clear-chrome/${name}`, import.meta.url), "utf8");

function loginContext() {
  const password = { value: "", autocomplete: "" };
  const captcha = { src: "captcha-1", dataset: { cuimsClearSolved: "captcha-1" } };
  const answer = { value: "abcd", dataset: {} };
  let clicks = 0;
  const button = { click() { clicks++; } };
  const context = vm.createContext({
    document: {
      documentElement: null,
      addEventListener() {},
      querySelector(selector) {
        if (selector.includes("btnLogin")) return button;
        if (selector.includes("type='password'")) return password;
        return null;
      },
    },
    chrome: { storage: { onChanged: { addListener() {} } } },
    location: { pathname: "/" },
    captcha, answer, password,
  });
  vm.runInContext(source("content.js"), context);
  return { context, password, captcha, answer, clicks: () => clicks };
}

test("Chrome submits an already-solved CAPTCHA after delayed password autofill, only once", () => {
  const state = loginContext();
  const submit = () => vm.runInContext("submitSolvedLogin(captcha, answer, password)", state.context);
  submit();
  assert.equal(state.clicks(), 0);
  state.password.value = "autofilled-example";
  submit();
  submit();
  assert.equal(state.clicks(), 1);
});

test("Chrome respects manual CAPTCHA edits and disabled automatic submission", () => {
  const state = loginContext();
  state.password.value = "autofilled-example";
  state.answer.dataset.cuimsClearUserEdited = "1";
  vm.runInContext("submitSolvedLogin(captcha, answer, password)", state.context);
  assert.equal(state.clicks(), 0);
  delete state.answer.dataset.cuimsClearUserEdited;
  vm.runInContext("settings.autoSubmitLogin = false; submitSolvedLogin(captcha, answer, password)", state.context);
  assert.equal(state.clicks(), 0);
});

test("Chrome update removes old credentials without clearing preferences", () => {
  let installed;
  let removed;
  vm.runInNewContext(source("service-worker.js"), {
    importScripts() {},
    chrome: {
      runtime: { onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener() {} } },
      storage: { local: { remove(keys) { removed = Array.from(keys); } } },
    },
  });
  installed();
  assert.deepEqual(removed, ["uid", "password"]);
});

test("Chrome popup reads and writes preferences without requesting credentials", () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { checked: true, addEventListener(event, fn) { this[event] = fn; } });
    return elements.get(id);
  };
  let saved;
  let requested;
  vm.runInNewContext(source("popup.js"), {
    document: { querySelector: element },
    chrome: { storage: { local: {
      get(defaults, callback) { requested = Object.keys(defaults); callback(defaults); },
      set(values) { saved = values; },
    } } },
  });
  element("#settings-form").submit({ preventDefault() {} });
  assert.equal(requested.includes("password"), false);
  assert.equal(requested.includes("uid"), false);
  assert.deepEqual(Object.keys(saved).sort(), ["autoAdvanceUid", "autoSolveCaptcha", "autoSubmitLogin", "blockEvents", "blockFeedback"].sort());
});
