import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (browser, name) => readFileSync(new URL(`../outputs/cuims-clear-${browser}/${name}`, import.meta.url), "utf8");
const HOUR = 60 * 60 * 1000;
// Objects from the vm sandbox have its prototypes; compare plain copies.
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function loadCheck() {
  const context = vm.createContext({});
  context.globalThis = context;
  vm.runInContext(read("firefox", "update-check.js"), context);
  return context.CuimsUpdate;
}

const U = loadCheck();

test("versions compare part by part, not as text", () => {
  assert.equal(U.newer("0.10.6", "0.10.5"), true);
  assert.equal(U.newer("0.10.10", "0.10.9"), true);
  assert.equal(U.newer("0.11", "0.10.9"), true);
  assert.equal(U.newer("1.0.0", "0.99.99"), true);
  assert.equal(U.newer("0.10.5", "0.10.5"), false);
  assert.equal(U.newer("0.10.5", "0.10.6"), false);
  assert.equal(U.newer("0.10", "0.10.0"), false);
  assert.equal(U.newer("", "0.10.5"), false);
});

test("a check runs every six hours on its own, and a minute apart on Check now", () => {
  const at = Date.UTC(2026, 9, 14, 6);
  assert.equal(U.due(null, at), true, "never checked");
  assert.equal(U.due({ checkedAt: at }, at + 6 * HOUR - 1), false);
  assert.equal(U.due({ checkedAt: at }, at + 6 * HOUR), true);
  assert.equal(U.due({ checkedAt: at }, at + 30_000, true), false);
  assert.equal(U.due({ checkedAt: at }, at + 60_000, true), true);
  assert.equal(U.due({ checkedAt: at + HOUR }, at), true, "a clock set back does not stall checks");
});

test("only a newer store version is an update", () => {
  assert.equal(U.available({ latest: "0.10.7" }, "0.10.6"), true);
  assert.equal(U.available({ latest: "0.10.6" }, "0.10.6"), false);
  assert.equal(U.available({ latest: "0.10.5" }, "0.10.6"), false, "a store behind a hand-installed build");
  assert.equal(U.available({ latest: "" }, "0.10.6"), false);
  assert.equal(U.available(null, "0.10.6"), false);
});

test("AMO's version counts only when this Firefox can run it", () => {
  const json = { current_version: { version: "0.10.7", compatibility: { firefox: { min: "142.0", max: "*" } } } };
  assert.equal(U.amoLatest(json, "157.0.1"), "0.10.7");
  assert.equal(U.amoLatest(json, "140.0"), "", "too old a Firefox: no notice it cannot act on");
  assert.equal(U.amoLatest(json, undefined), "0.10.7");
  assert.equal(U.amoLatest({}, "157.0"), "");
});

test("What's new shows once after an update, until Got it or three days", () => {
  const at = Date.UTC(2026, 9, 14, 6);
  const done = { from: "0.10.5", to: "0.10.6", at, seen: false };
  assert.deepEqual(plain(U.news(done, "0.10.6", at + HOUR)), plain({ from: "0.10.5", to: "0.10.6", notes: U.NOTES["0.10.6"] }));
  assert.equal(U.news({ ...done, seen: true }, "0.10.6", at), null);
  assert.equal(U.news(done, "0.10.6", at + 3 * 24 * HOUR + 1), null);
  assert.equal(U.news(done, "0.10.7", at), null, "a later update replaces it");
  assert.equal(U.news({ ...done, to: "0.10.9" }, "0.10.9", at), null, "no notes, no card");
  assert.ok(U.NOTES[JSON.parse(read("firefox", "manifest.json")).version]?.length, "this build has notes");
});

// The background, with the browser's APIs faked.
function loadBackground(build, { amo, chromeAnswers = [], store: seed = {} } = {}) {
  const store = { ...seed };
  const listeners = { message: [], installed: [], updateAvailable: [] };
  const event = (list) => ({ addListener: (fn) => list.push(fn) });
  const fetched = [];
  const badge = [];
  let reloads = 0;
  let reloadedAt = 0;
  let asked = 0;
  const runtime = {
    id: "cuims-clear@arshgill01",
    getURL: (path) => `${build === "firefox" ? "moz-extension" : "chrome-extension"}://uuid/${path}`,
    getManifest: () => ({ version: "0.10.6" }),
    onMessage: event(listeners.message),
    onInstalled: event(listeners.installed),
    onUpdateAvailable: event(listeners.updateAvailable),
    reload: () => {
      reloads += 1;
      reloadedAt = clock.now;
    },
    getPlatformInfo: (done) => done({}),
  };
  if (build === "chrome") {
    runtime.requestUpdateCheck = async () => {
      asked += 1;
      const next = chromeAnswers.shift() || { status: "no_update" };
      if (next instanceof Error) throw next;
      return next;
    };
  }
  const chrome = {
    runtime,
    storage: {
      local: {
        get: async (defaults) => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, key in store ? store[key] : value])),
        set: async (values) => Object.assign(store, JSON.parse(JSON.stringify(values))),
      },
    },
    action: { setBadgeText: ({ text }) => badge.push(text), setBadgeBackgroundColor() {}, setTitle() {} },
  };
  // A clock that moves only when the background waits, so waits are instant
  // and in order.
  const clock = { now: Date.now() };
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  }
  const context = vm.createContext({
    chrome,
    console,
    Date: FakeDate,
    Promise,
    Set,
    JSON,
    setTimeout: (fn, ms = 0) => {
      clock.now += ms;
      setImmediate(fn);
      return 1;
    },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    fetch: async (url, options) => {
      fetched.push({ url, options });
      if (amo instanceof Error) throw amo;
      return { ok: true, json: async () => amo };
    },
    browser: build === "firefox" ? { runtime: { getBrowserInfo: async () => ({ version: "157.0.1" }) } } : undefined,
  });
  context.globalThis = context;
  for (const name of ["keep-awake.js", "update-check.js", "update-bg.js"]) vm.runInContext(read(build, name), context, { filename: `${build}/${name}` });
  const send = (message, sender = { id: runtime.id, url: runtime.getURL("popup.html") }) =>
    new Promise((resolve) => {
      let answered = false;
      for (const listener of listeners.message) {
        if (listener(message, sender, (value) => { answered = true; resolve(value); }) === true) return;
      }
      if (!answered) setImmediate(() => resolve(undefined));
    });
  return { store, listeners, fetched, badge, send, clock, reloads: () => reloads, reloadedAt: () => reloadedAt, asked: () => asked };
}

const AMO = (version) => ({ current_version: { version, compatibility: { firefox: { min: "142.0", max: "*" } } } });

test("Firefox asks addons.mozilla.org, marks the icon, and asks again only after six hours", async () => {
  const bg = loadBackground("firefox", { amo: AMO("0.10.7") });
  const first = await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.equal(first.available, true);
  assert.equal(first.latest, "0.10.7");
  assert.equal(first.browser, "firefox");
  assert.equal(bg.fetched.length, 1);
  assert.equal(bg.fetched[0].url, "https://addons.mozilla.org/api/v5/addons/addon/cuims-clear/");
  assert.equal(bg.fetched[0].options.credentials, "omit", "no cookies go to AMO");
  assert.equal(bg.badge.at(-1), "↑");
  await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.equal(bg.fetched.length, 1, "within six hours: the saved answer");
  bg.clock.now += 61_000;
  await bg.send({ type: "cuims-clear:update-status", check: true, manual: true });
  assert.equal(bg.fetched.length, 2, "Check now, a minute later, asks again");
  assert.equal(bg.listeners.updateAvailable.length, 0, "Firefox would hold the update until a restart");
});

test("Firefox: an older AMO version, or AMO unreachable, is no update and no throw", async () => {
  let bg = loadBackground("firefox", { amo: AMO("0.10.5") });
  let answer = await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.equal(answer.available, false);
  assert.equal(bg.badge.at(-1), "");
  bg = loadBackground("firefox", { amo: new Error("offline") });
  answer = await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.equal(answer.available, false);
  assert.match(answer.error, /offline/);
  assert.ok(answer.checkedAt > 0, "a failed check still waits six hours, so it never hammers");
});

test("a CUIMS page load prompts a check, but other senders get nothing", async () => {
  const bg = loadBackground("firefox", { amo: AMO("0.10.7") });
  await bg.send({ type: "cuims-clear:tab-page", path: "/StudentHome.aspx" }, { url: "https://students.cuchd.in/StudentHome.aspx" });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bg.fetched.length, 1);
  const stranger = await bg.send({ type: "cuims-clear:update-status", check: true }, { url: "https://example.com/" });
  assert.equal(stranger, undefined);
  assert.equal(bg.fetched.length, 1);
});

test("Firefox never installs from the background", async () => {
  const bg = loadBackground("firefox", { amo: AMO("0.10.7") });
  assert.deepEqual(plain(await bg.send({ type: "cuims-clear:update-apply" })), { status: "firefox" });
  assert.equal(bg.reloads(), 0);
});

test("Chrome: the Web Store's answer, the download, then a restart that waits for a CUIMS read", async () => {
  const bg = loadBackground("chrome", { chromeAnswers: [{ status: "update_available", version: "0.10.7" }] });
  const status = await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.equal(status.latest, "0.10.7");
  assert.equal(status.ready, false);
  assert.equal(bg.listeners.updateAvailable.length, 1);
  bg.listeners.updateAvailable[0]({ version: "0.10.7" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bg.store.updateInfo.ready, true);
  // A read holds attendanceRunUntil for 20 s more; the restart waits for it.
  bg.store.attendanceRunUntil = bg.clock.now + 20_000;
  assert.deepEqual(plain(await bg.send({ type: "cuims-clear:update-apply" })), { status: "restarting", version: "0.10.7" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bg.reloads(), 1);
  assert.ok(bg.reloadedAt() >= bg.store.attendanceRunUntil, "not before the read ended");
  assert.equal(bg.asked(), 1, "Update did not ask Chrome again");
});

test("Chrome: Update right after a check that found it waits for the download, not a throttled second ask", async () => {
  const bg = loadBackground("chrome", { chromeAnswers: [{ status: "update_available", version: "0.10.7" }, { status: "throttled" }] });
  await bg.send({ type: "cuims-clear:update-status", check: true });
  const applied = bg.send({ type: "cuims-clear:update-apply" });
  // Chrome finishes the download a moment later.
  await new Promise((resolve) => setImmediate(resolve));
  bg.listeners.updateAvailable[0]({ version: "0.10.7" });
  assert.equal(plain(await applied).status, "restarting");
  assert.equal(bg.asked(), 1);
});

test("Chrome: a found update that never finishes downloading says so, and does not restart", async () => {
  const bg = loadBackground("chrome", { chromeAnswers: [{ status: "update_available", version: "0.10.7" }, { status: "throttled" }] });
  await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.deepEqual(plain(await bg.send({ type: "cuims-clear:update-apply" })), { status: "downloading" });
  assert.equal(bg.reloads(), 0);
});

test("Chrome: Update with nothing new, or throttled, says so and does not restart", async () => {
  let bg = loadBackground("chrome", { chromeAnswers: [{ status: "no_update" }], store: { updateInfo: { latest: "0.10.7", checkedAt: 1 } } });
  assert.deepEqual(plain(await bg.send({ type: "cuims-clear:update-apply" })), { status: "no_update" });
  assert.equal(bg.store.updateInfo.latest, "", "the stale notice goes");
  bg = loadBackground("chrome", { chromeAnswers: [{ status: "throttled" }] });
  assert.deepEqual(plain(await bg.send({ type: "cuims-clear:update-apply" })), { status: "throttled" });
  bg = loadBackground("chrome", { chromeAnswers: [new Error("boom")] });
  assert.equal((await bg.send({ type: "cuims-clear:update-apply" })).status, "error");
  assert.equal(bg.reloads(), 0);
});

test("Chrome: a throttled check keeps what was known", async () => {
  const bg = loadBackground("chrome", { chromeAnswers: [{ status: "throttled" }], store: { updateInfo: { latest: "0.10.7", checkedAt: 1 } } });
  const status = await bg.send({ type: "cuims-clear:update-status", check: true });
  assert.equal(status.latest, "0.10.7");
  assert.equal(status.available, true);
});

test("an update landing clears the notice and leaves What's new for the popup", async () => {
  const bg = loadBackground("firefox", { store: { updateInfo: { latest: "0.10.6", checkedAt: 1, ready: true } } });
  bg.listeners.installed[0]({ reason: "update", previousVersion: "0.10.5" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bg.store.updateDone.from, "0.10.5");
  assert.equal(bg.store.updateDone.to, "0.10.6");
  assert.equal(bg.store.updateDone.seen, false);
  assert.equal(bg.store.updateInfo.latest, "");
  assert.equal(bg.store.updateInfo.ready, false);
  assert.equal(bg.badge.at(-1), "");
  const fresh = loadBackground("firefox");
  fresh.listeners.installed[0]({ reason: "install" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fresh.store.updateDone, undefined, "a first install has nothing to announce");
});

test("both builds ship the same update scripts, and no new permission", () => {
  for (const name of ["update-check.js", "update-bg.js", "update-bar.js"]) assert.equal(read("chrome", name), read("firefox", name), name);
  for (const build of ["firefox", "chrome"]) {
    const manifest = JSON.parse(read(build, "manifest.json"));
    // The same as 0.10.5: a new permission would make Chrome disable the
    // extension until the student approves it.
    assert.deepEqual(manifest.permissions, build === "firefox" ? ["storage", "activeTab"] : ["storage", "tabs"], build);
    assert.deepEqual(manifest.host_permissions, ["https://students.cuchd.in/*", "https://lms.cuchd.in/*"], build);
    const bar = manifest.content_scripts.find((entry) => entry.js.includes("update-bar.js"));
    assert.deepEqual(bar.js, ["update-check.js", "update-bar.js"]);
    assert.deepEqual(bar.matches, ["https://students.cuchd.in/*"]);
    assert.equal(bar.all_frames, undefined, "top frame only");
  }
});
