import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Firefox runs these scripts in one background page, in manifest order. A
// top-level error in a later script would silently drop its features while
// the CAPTCHA solver kept working, so load them all and check the wiring.
test("firefox: every background script loads in manifest order and wires up", () => {
  const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
  const listeners = { message: [], storage: [] };
  const event = (list) => ({ addListener: (fn) => list.push(fn) });
  const chrome = {
    runtime: { id: "cuims-clear@arshgill01", getURL: (path) => `moz-extension://uuid/${path}`, onMessage: event(listeners.message), sendMessage() {} },
    storage: { local: { get: async (defaults) => defaults, set: async () => {}, remove() {} }, onChanged: event(listeners.storage) },
    permissions: { contains: async () => true },
    tabs: { query: async () => [], get: async () => ({}), update: async () => {}, create: async () => ({}) },
    windows: { update: async () => {} },
  };
  const context = vm.createContext({ chrome, console, URL, URLSearchParams, Headers, AbortSignal, TextEncoder, Intl, Date, Math, JSON, Promise, setTimeout, clearTimeout, fetch: async () => ({}) });
  for (const name of manifest.background.scripts) {
    if (name.startsWith("vendor/")) {
      vm.runInContext("var Tesseract = { createWorker: async () => ({}) };", context);
      continue;
    }
    vm.runInContext(readFileSync(new URL(name, root), "utf8"), context, { filename: name });
  }
  assert.equal(typeof context.solveCaptchaBytes, "function");
  assert.equal(typeof context.cuimsEnsureSession, "function", "attendance-bg started with the page's solver");
  assert.ok(listeners.message.length >= 4, `message listeners: ${listeners.message.length}`);
  assert.equal(chrome.alarms, undefined);
});
