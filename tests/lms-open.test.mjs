import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-open.js", import.meta.url), "utf8");

function open(options = {}) {
  const { lms = [], cuims = [], active = [], createdId = 9, sendMessageError } = options;
  const messages = [];
  const created = [];
  const updated = [];
  const reloaded = [];
  const focused = [];
  const storage = {};
  const listeners = { message: [], tabs: [] };
  const chrome = {
    storage: {
      local: {
        set: async (value) => Object.assign(storage, value),
        get: async (defaults) => ({ ...defaults, ...storage }),
        remove: async (key) => { delete storage[key]; },
      },
    },
    runtime: {
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    tabs: {
      query: async (info) => {
        if (info?.active && info.currentWindow) return active;
        if (String(info?.url).includes("lms.cuchd.in")) return lms;
        return cuims;
      },
      update: async (id, info) => {
        updated.push({ id, ...info });
        if (info.active) focused.push(id);
      },
      create: async (info) => { created.push(info); return { id: createdId }; },
      sendMessage: async (id, message) => {
        if (sendMessageError) throw new Error(sendMessageError);
        messages.push({ id, message });
      },
      reload: async (id) => { reloaded.push(id); },
      onUpdated: { addListener: (fn) => listeners.tabs.push(fn) },
    },
    windows: {
      update: async (id, info) => {
        if (info?.focused) focused.push(`window:${id}`);
      },
    },
  };
  vm.runInContext(source, vm.createContext({ chrome, Set }));
  return {
    storage, messages, created, updated, reloaded, focused, listeners,
    async launch() {
      const send = listeners.message[0];
      await new Promise((resolve) => send({ type: "cuims-clear:launch-lms" }, {}, resolve));
    },
    async tabUpdated(tab) {
      await listeners.tabs[0](tab.id, { url: tab.url }, tab);
    },
  };
}

test("opens CUIMS in the background so the dashboard never pops in front", async () => {
  const result = open();
  await result.launch();
  assert.ok(result.storage.lmsLaunchAt);
  assert.equal(result.created[0].url, "https://students.cuchd.in/StudentHome.aspx");
  assert.equal(result.created[0].active, false);
  assert.deepEqual(result.focused, []);
});

test("reuses a background StudentHome tab and does not bring it forward", async () => {
  const result = open({
    cuims: [{ id: 4, windowId: 1, url: "https://students.cuchd.in/StudentHome.aspx" }],
    active: [{ id: 1, url: "https://example.com/" }],
  });
  await result.launch();
  assert.equal(result.created.length, 0);
  assert.equal(result.updated.length, 0);
  assert.deepEqual(result.focused, []);
  assert.equal(result.messages[0].id, 4);
  assert.equal(result.messages[0].message.type, "cuims-clear:launch-lms");
});

test("does not postback the StudentHome tab the student is looking at", async () => {
  const result = open({
    cuims: [{ id: 4, windowId: 1, url: "https://students.cuchd.in/StudentHome.aspx" }],
    active: [{ id: 4, windowId: 1, url: "https://students.cuchd.in/StudentHome.aspx" }],
  });
  await result.launch();
  assert.equal(result.messages.length, 0);
  assert.equal(result.created[0].active, false);
  assert.equal(result.created[0].url, "https://students.cuchd.in/StudentHome.aspx");
});

test("focuses LMS once the SSO tab arrives there", async () => {
  const result = open();
  await result.launch();
  await result.tabUpdated({ id: 9, windowId: 1, url: "https://lms.cuchd.in/my/courses.php" });
  assert.equal(result.updated.at(-1).id, 9);
  assert.equal(result.updated.at(-1).active, true);
  assert.equal(result.storage.lmsLaunchAt, undefined);
});

test("an already-open LMS tab is focused instead of returning to CUIMS", async () => {
  const result = open({ lms: [{ id: 3, windowId: 1, url: "https://lms.cuchd.in/my/courses.php" }] });
  await result.launch();
  assert.equal(result.created.length, 0);
  assert.equal(result.updated[0].id, 3);
  assert.equal(result.updated[0].active, true);
});

test("a background CUIMS login tab is sent to StudentHome without being focused", async () => {
  const result = open({
    cuims: [{ id: 6, windowId: 1, url: "https://students.cuchd.in/Login.aspx" }],
    active: [{ id: 1, url: "https://example.com/" }],
  });
  await result.launch();
  assert.equal(result.created.length, 0);
  assert.equal(result.messages.length, 0);
  assert.equal(result.updated[0].id, 6);
  assert.equal(result.updated[0].url, "https://students.cuchd.in/StudentHome.aspx");
  assert.equal(result.updated[0].active, false);
  assert.deepEqual(result.focused, []);
});

test("reloads a background StudentHome tab when the launch script is not in the tab yet", async () => {
  const result = open({
    cuims: [{ id: 4, windowId: 1, url: "https://students.cuchd.in/StudentHome.aspx" }],
    active: [{ id: 1, url: "https://example.com/" }],
    sendMessageError: "Could not establish connection. Receiving end does not exist.",
  });
  await result.launch();
  assert.equal(result.created.length, 0);
  assert.deepEqual(result.reloaded, [4]);
  assert.deepEqual(result.focused, []);
});

test("reloads a background CUIMS tab even when Chrome hides the tab URL", async () => {
  const result = open({
    cuims: [{ id: 8, windowId: 1 }],
    active: [{ id: 1, url: "https://example.com/" }],
    sendMessageError: "Could not establish connection. Receiving end does not exist.",
  });
  await result.launch();
  assert.deepEqual(result.reloaded, [8]);
  assert.deepEqual(result.focused, []);
});
