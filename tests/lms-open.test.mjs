import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-open.js", import.meta.url), "utf8");

// Objects built inside the VM belong to another realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

const HOME = "https://students.cuchd.in/StudentHome.aspx";
const LMS_LAUNCH = `${HOME}#cuims-clear-lms`;

// lms-open.js with chrome.* stubbed. `fetch` counts any request it might make
// (it should make none). `stored`: what the background last knew.
function open({ lms = [], active = { id: 1, index: 0, windowId: 1, url: "about:newtab" }, stored = {} } = {}) {
  const created = [];
  const updated = [];
  const focused = [];
  const requests = [];
  const storage = { ...stored };
  const listeners = [];
  const chrome = {
    runtime: { id: "ext", getURL: (path) => `chrome-extension://ext/${path}`, onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: { set: async (value) => Object.assign(storage, value), get: async (defaults) => ({ ...defaults, ...storage }), remove: () => {} } },
    tabs: {
      get: async (id) => (active?.id === id ? active : Promise.reject(new Error("gone"))),
      query: async (info) => (String(info?.url).includes("lms.cuchd.in") ? lms : active ? [active] : []),
      update: async (id, info) => {
        updated.push({ id, ...info });
        if (info.active) focused.push(id);
      },
      create: async (info) => {
        created.push(info);
        return { id: 99 };
      },
    },
    windows: { update: async () => {} },
  };
  const fetch = async (url) => {
    requests.push(url);
    return { status: 200, url, text: async () => "" };
  };
  const context = vm.createContext({ chrome, fetch, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout, Promise });
  vm.runInContext(source, context);
  const send = (message, sender = { id: "ext", url: "chrome-extension://ext/popup.html" }) =>
    new Promise((resolve) => {
      const async = listeners[0](message, sender, resolve);
      if (async !== true) resolve(undefined);
    });
  return {
    storage, created, updated, focused, requests,
    launch: () => send({ type: "cuims-clear:launch-lms", tabId: active?.id }),
    openCuims: () => send({ type: "cuims-clear:open-cuims", tabId: active?.id }),
    send,
  };
}

// The states the background can be in: none of them changes what opens.
const STATES = [
  {},
  { sessionAlive: true, sessionCheckedAt: Date.now() },
  { sessionAlive: false, sessionCheckedAt: Date.now() },
  { pagesPausedUntil: Date.now() + 15 * 60_000, tabLimitedAt: Date.now() },
  { attendanceBackoffUntil: Date.now() + 20 * 60_000 },
];

test("Open LMS opens CUIMS's own LMS hand-off in a new tab, with no request of its own, and never refuses", async () => {
  for (const stored of STATES) {
    const result = open({ stored });
    const response = await result.launch();
    assert.equal(response.error, undefined, JSON.stringify(stored));
    assert.equal(response.via, "page");
    assert.equal(result.requests.length, 0);
    assert.equal(result.updated.length, 0);
    assert.deepEqual(plain(result.created), [{ url: LMS_LAUNCH, active: true, index: 1 }]);
    assert.ok(result.storage.tabPageAt > 0, "background optional pages keep clear of the tab");
    assert.equal(result.storage.lmsLaunchAt, undefined, "the intent rides on this tab's URL, never browser-wide");
  }
});

test("LMS opens beside the tab the popup was opened from, even an empty one", async () => {
  for (const url of ["https://example.com/", "about:newtab", "chrome://newtab/"]) {
    const result = open({ active: { id: 1, index: 3, windowId: 1, url } });
    await result.launch();
    assert.equal(result.updated.length, 0, url);
    assert.deepEqual(plain(result.created), [{ url: LMS_LAUNCH, active: true, index: 4 }], url);
  }
});

test("an already-open LMS tab is focused instead of opening another", async () => {
  const result = open({ lms: [{ id: 3, windowId: 1, url: "https://lms.cuchd.in/my/courses.php" }] });
  assert.equal((await result.launch()).via, "existing");
  assert.equal(result.requests.length, 0);
  assert.equal(result.created.length, 0);
  assert.deepEqual(result.focused, [3]);
});

test("Open CUIMS opens CUIMS in a new tab at once, with no request of its own, like typing the address", async () => {
  for (const stored of STATES) {
    const result = open({ stored });
    const response = await result.openCuims();
    assert.equal(response.error, undefined, JSON.stringify(stored));
    assert.equal(response.via, "tab");
    assert.equal(result.requests.length, 0);
    assert.deepEqual(plain(result.created), [{ url: HOME, active: true, index: 1 }]);
    assert.ok(result.storage.tabPageAt > 0, "background optional pages keep clear of the tab");
  }
});

test("Open CUIMS on a CUIMS tab just stays there", async () => {
  const result = open({ active: { id: 7, index: 0, windowId: 1, url: "https://students.cuchd.in/StudentHome.aspx" } });
  await result.openCuims();
  assert.equal(result.created.length, 0);
  assert.deepEqual(result.focused, [7]);
});

test("content scripts cannot trigger an open", async () => {
  const result = open();
  const response = await result.send({ type: "cuims-clear:launch-lms" }, { id: "ext", url: "https://students.cuchd.in/StudentHome.aspx", tab: { id: 4 } });
  assert.equal(response, undefined);
  assert.equal(result.created.length, 0);
});

test("a launch that needs the login form brings its tab forward", async () => {
  const result = open();
  await result.send({ type: "cuims-clear:lms-needs-ui" }, { id: "ext", url: "https://students.cuchd.in/Login.aspx", tab: { id: 5 } });
  assert.deepEqual(result.focused, [5]);
});
