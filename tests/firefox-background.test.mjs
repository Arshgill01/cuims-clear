import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Both builds load their background scripts in one global scope: Firefox in
// manifest order, Chrome through importScripts in the service worker. A
// top-level error in a later script would silently drop its features, so load
// them all and check the wiring, including the solver the sign-in uses.
function backgroundScripts(build) {
  const root = new URL(`../outputs/cuims-clear-${build}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
  if (build === "firefox") return { root, names: manifest.background.scripts };
  const worker = readFileSync(new URL(manifest.background.service_worker, root), "utf8");
  const names = [...worker.matchAll(/"([\w-]+\.js)"/g)].map((match) => match[1]);
  return { root, names: [...names, manifest.background.service_worker] };
}

function loadBackground(build) {
  const { root, names } = backgroundScripts(build);
  const listeners = { message: [], storage: [], installed: [], updateAvailable: [] };
  const event = (list) => ({ addListener: (fn) => list.push(fn) });
  const chrome = {
    runtime: {
      id: "cuims-clear@arshgill01",
      getURL: (path) => `${build === "firefox" ? "moz-extension" : "chrome-extension"}://uuid/${path}`,
      getManifest: () => ({ version: "0.10.6" }),
      onMessage: event(listeners.message),
      onInstalled: event(listeners.installed),
      // Firefox has the event too; listening to it would hold every update
      // until the browser restarts.
      onUpdateAvailable: event(listeners.updateAvailable),
      ...(build === "chrome" ? { requestUpdateCheck: async () => ({ status: "no_update" }) } : {}),
      sendMessage() {},
    },
    storage: { local: { get: async (defaults) => defaults, set: async () => {}, remove() {} }, onChanged: event(listeners.storage) },
    permissions: { contains: async () => true },
    tabs: { query: async () => [], get: async () => ({}), update: async () => {}, create: async () => ({}) },
    windows: { update: async () => {} },
    action: { setIcon: async () => {} },
  };
  const context = vm.createContext({ chrome, console, URL, URLSearchParams, Headers, AbortSignal, AbortController, TextEncoder, Intl, Date, Math, JSON, Promise, Buffer, setTimeout, clearTimeout, fetch: async () => ({}) });
  context.globalThis = context;
  context.importScripts = () => {};
  for (const name of names) vm.runInContext(readFileSync(new URL(name, root), "utf8"), context, { filename: `${build}/${name}` });
  return { context, listeners, names, chrome };
}

for (const build of ["firefox", "chrome"]) {
  test(`${build}: every background script loads and wires up`, () => {
    const { context, listeners, names, chrome } = loadBackground(build);
    assert.equal(typeof context.CuimsCaptcha?.readBytes, "function", "the sign-in's solver is loaded");
    assert.equal(context.cuimsWithRequests ?? context.cuimsEnsureSession, undefined, "Open CUIMS and Open LMS make no request of their own");
    assert.ok(listeners.message.length >= 3, `message listeners: ${listeners.message.length}`);
    assert.equal(chrome.alarms, undefined);
    assert.ok(names.indexOf("captcha-glyphs.js") < names.indexOf("captcha-solver.js"));
    assert.ok(names.indexOf("captcha-solver.js") < names.indexOf("attendance-bg.js"));
    assert.ok(names.indexOf("update-check.js") < names.indexOf("update-bg.js"));
    // update-bg.js clears the update notice; celebrate-bg.js decides the Founding 100 stamp.
    assert.equal(listeners.installed.length, 2, "two install listeners: the update notice and the founding stamp");
    assert.equal(listeners.updateAvailable.length, build === "chrome" ? 1 : 0, "Firefox must not hold its updates");
  });

  test(`${build}: no OCR engine, offscreen page or WASM is shipped any more`, () => {
    const root = new URL(`../outputs/cuims-clear-${build}/`, import.meta.url);
    const manifest = readFileSync(new URL("manifest.json", root), "utf8");
    assert.doesNotMatch(manifest, /tesseract|offscreen|wasm|captcha-prep|background\.js/i);
    for (const name of backgroundScripts(build).names) {
      assert.doesNotMatch(readFileSync(new URL(name, root), "utf8"), /Tesseract|chrome\.offscreen/, name);
    }
  });
}

// Firefox stops an event page, and Chrome a service worker, 30 s after the
// last extension event or API call, even with the popup waiting on a reply.
test("a running task keeps the background awake, and lets it sleep once it settles", async () => {
  const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
  const timers = new Map();
  let beats = 0;
  let id = 0;
  const context = vm.createContext({
    chrome: { runtime: { getPlatformInfo: (done) => { beats += 1; done({}); }, lastError: undefined } },
    Promise,
    Date,
    Set,
    setInterval: (fn, ms) => (timers.set(++id, { fn, ms }), id),
    clearInterval: (key) => timers.delete(key),
  });
  context.globalThis = context;
  vm.runInContext(readFileSync(new URL("keep-awake.js", root), "utf8"), context);
  const tick = () => [...timers.values()].forEach((timer) => timer.fn());

  let finish;
  const task = context.cuimsKeepAwake(() => new Promise((done) => (finish = done)));
  assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].ms < 30_000, "beats well inside the 30 s idle limit");
  tick();
  tick();
  assert.equal(beats, 2);
  await Promise.resolve();
  finish("read");
  assert.equal(await task, "read");
  assert.equal(timers.size, 0, "no beat once nothing is running");

  await assert.rejects(context.cuimsKeepAwake(() => Promise.reject(new Error("refused"))), /refused/);
  assert.equal(timers.size, 0);
});

test("a fresh background clears the locks a stopped one left behind, before any read", async () => {
  for (const build of ["firefox", "chrome"]) {
    const { root, names } = backgroundScripts(build);
    const store = {
      attendanceRunUntil: Date.now() + 100_000,
      bgSignInUntil: Date.now() + 80_000,
      attendanceStatus: { working: true, phase: "Signing in…", at: Date.now() },
      attendanceMeta: { reportId: "r", sessionId: "s" },
    };
    const writes = [];
    const listeners = [];
    const chrome = {
      runtime: {
        id: "cuims-clear@arshgill01",
        getURL: (path) => `moz-extension://uuid/${path}`,
        getManifest: () => ({ version: "0.10.6" }),
        onMessage: { addListener: (fn) => listeners.push(fn) },
        onInstalled: { addListener() {} },
        getPlatformInfo: (done) => done({}),
      },
      storage: {
        local: {
          get: async (defaults) => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in store ? store[key] : value])),
          set: async (values) => {
            writes.push(values);
            Object.assign(store, values);
          },
          remove() {},
        },
        onChanged: { addListener() {} },
      },
      permissions: { contains: async () => true },
      tabs: { query: async () => [], get: async () => ({}), update: async () => {}, create: async () => ({}) },
      windows: { update: async () => {} },
      action: { setIcon: async () => {} },
    };
    const context = vm.createContext({ chrome, console, URL, URLSearchParams, Headers, AbortSignal, AbortController, TextEncoder, Intl, Date, Math, JSON, Promise, Set, Buffer, setTimeout, clearTimeout, setInterval, clearInterval, fetch: async () => { throw new Error("no network in this test"); } });
    context.globalThis = context;
    context.importScripts = () => {};
    for (const name of names) vm.runInContext(readFileSync(new URL(name, root), "utf8"), context, { filename: `${build}/${name}` });

    // The popup's Refresh is what woke this background.
    const reply = await new Promise((resolve) => {
      for (const listener of listeners) listener({ type: "cuims-clear:attendance-refresh" }, { id: chrome.runtime.id, url: chrome.runtime.getURL("popup.html") }, resolve);
    });
    const first = JSON.parse(JSON.stringify(writes[0]));
    assert.deepEqual(first, { attendanceRunUntil: 0, bgSignInUntil: 0, attendanceStatus: { ...first.attendanceStatus, working: false, phase: "" } }, build);
    // The refresh then ran under its own lock, taken after the cleanup.
    const locked = writes.findIndex((values) => Number(values.attendanceRunUntil) > 0);
    assert.ok(locked > 0, `${build}: the refresh took its lock after the cleanup`);
    assert.equal(reply.code, "network", build);
    assert.equal(store.attendanceRunUntil, 0, build);
    assert.equal(store.bgSignInUntil, 0, build);
  }
});
