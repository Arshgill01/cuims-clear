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
  const listeners = { message: [], storage: [] };
  const event = (list) => ({ addListener: (fn) => list.push(fn) });
  const chrome = {
    runtime: { id: "cuims-clear@arshgill01", getURL: (path) => `moz-extension://uuid/${path}`, onMessage: event(listeners.message), sendMessage() {} },
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
    assert.equal(typeof context.cuimsEnsureSession, "function", "attendance-bg started");
    assert.ok(listeners.message.length >= 3, `message listeners: ${listeners.message.length}`);
    assert.equal(chrome.alarms, undefined);
    assert.ok(names.indexOf("captcha-glyphs.js") < names.indexOf("captcha-solver.js"));
    assert.ok(names.indexOf("captcha-solver.js") < names.indexOf("attendance-bg.js"));
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
