import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-open.js", import.meta.url), "utf8");

// Objects built inside the VM belong to another realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

const TICKET = "https://lms.cuchd.in/auth/cuims/login.php?ticket=fixture&u=1";
const COURSES = "https://lms.cuchd.in/my/courses.php";
const DASHBOARD = `<form method="post" action="./StudentHome.aspx" id="form1">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs&amp;1" />
<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev" />
<a id="ContentPlaceHolder1_lbtnLMSSSO" href="javascript:__doPostBack(&#39;ctl00$ContentPlaceHolder1$lbtnLMSSSO&#39;,&#39;&#39;)">Click here</a>
</form>`;
const HANDOFF = `<html><script>window.open('${TICKET.replace(/&/g, "\\u0026")}','_blank');</script></html>`;

// students.cuchd.in as the SSO launcher sees it. `signedIn` may flip when the
// session helper signs in.
// `mode`: "redirect" is live CUIMS (the postback redirects through to LMS);
// "window-open" is the older page that calls window.open(<ticket>).
function cuims({ signedIn = true, handoff = HANDOFF, mode = "redirect" } = {}) {
  const state = { signedIn, requests: [], posts: [] };
  async function fetchImpl(url, options = {}) {
    const method = options.method || "GET";
    state.requests.push({ method, url, redirect: options.redirect });
    const response = (status, body, type = "basic", at = url) => ({ status, type, url: at, text: async () => body });
    if (!state.signedIn) return response(0, "", "opaqueredirect");
    if (method === "GET") return response(200, DASHBOARD);
    state.posts.push(new URLSearchParams(options.body));
    if (mode === "redirect") {
      if (options.redirect === "manual") return response(0, "", "opaqueredirect");
      return response(200, "<html>moodle</html>", "basic", "https://lms.cuchd.in/");
    }
    return response(200, handoff);
  }
  return { state, fetchImpl };
}

function open({ lms = [], active = { id: 1, index: 0, windowId: 1, url: "about:newtab" }, server = cuims({ mode: "window-open" }), ensureSession, withRequests, timers = { setTimeout, clearTimeout } } = {}) {
  const created = [];
  const updated = [];
  const focused = [];
  const storage = {};
  const listeners = [];
  const chrome = {
    runtime: { id: "ext", getURL: (path) => `chrome-extension://ext/${path}`, onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: { set: async (value) => Object.assign(storage, value) } },
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
  const context = vm.createContext({ chrome, fetch: server.fetchImpl, URL, URLSearchParams, AbortSignal, AbortController, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, Promise });
  if (ensureSession) context.cuimsEnsureSession = ensureSession;
  if (withRequests) context.cuimsWithRequests = withRequests;
  vm.runInContext(source, context);
  const send = (message, sender = { id: "ext", url: "chrome-extension://ext/popup.html" }) =>
    new Promise((resolve) => {
      const async = listeners[0](message, sender, resolve);
      if (async !== true) resolve(undefined);
    });
  return {
    server, storage, created, updated, focused,
    launch: () => send({ type: "cuims-clear:launch-lms", tabId: active?.id }),
    openCuims: () => send({ type: "cuims-clear:open-cuims", tabId: active?.id }),
    send,
  };
}

test("a live session opens LMS directly in a new tab, without painting CUIMS", async () => {
  const result = open();
  const response = await result.launch();
  assert.equal(response.via, "sso");
  assert.equal(result.updated.length, 0);
  assert.deepEqual(plain(result.created), [{ url: TICKET, active: true, index: 1 }]);
  const post = result.server.state.posts[0];
  assert.equal(post.get("__EVENTTARGET"), "ctl00$ContentPlaceHolder1$lbtnLMSSSO");
  assert.equal(post.get("__VIEWSTATE"), "vs&1");
  assert.equal(post.get("__EVENTVALIDATION"), "ev");
});

test("LMS opens beside the tab the popup was opened from, even an empty one", async () => {
  for (const url of ["https://example.com/", "about:newtab", "chrome://newtab/"]) {
    const result = open({ active: { id: 1, index: 3, windowId: 1, url } });
    await result.launch();
    assert.equal(result.updated.length, 0, url);
    assert.deepEqual(plain(result.created), [{ url: TICKET, active: true, index: 4 }], url);
  }
});

test("the background never follows CUIMS redirects, so it never loads a login page", async () => {
  const result = open({ server: cuims({ signedIn: false }) });
  await result.launch();
  assert.ok(result.server.state.requests.length > 0);
  assert.ok(result.server.state.requests.every((request) => request.redirect === "manual"));
});

test("signed out: the background signs in first, then goes straight to LMS", async () => {
  const server = cuims({ signedIn: false, mode: "window-open" });
  let asked = 0;
  const result = open({
    server,
    ensureSession: async () => {
      asked += 1;
      server.state.signedIn = true;
      return { alive: true, signedIn: true };
    },
  });
  const response = await result.launch();
  assert.equal(asked, 1);
  assert.equal(response.via, "sso");
  assert.deepEqual(plain(result.created), [{ url: TICKET, active: true, index: 1 }]);
});

test("when the background cannot sign in, the tab loads CUIMS and hands off from there", async () => {
  const result = open({ server: cuims({ signedIn: false }), ensureSession: async () => ({ alive: false, reason: "bad-captcha" }) });
  const response = await result.launch();
  assert.equal(response.via, "page");
  assert.equal(result.storage.lmsLaunchAt, undefined, "the intent rides on this tab's URL, never browser-wide");
  assert.deepEqual(plain(result.created), [{ url: "https://students.cuchd.in/StudentHome.aspx#cuims-clear-lms", active: true, index: 1 }]);
});

test("a handoff that points anywhere but LMS is not followed", async () => {
  const result = open({ server: cuims({ mode: "window-open", handoff: `<script>window.open('https://evil.example/steal','_blank')</script>` }) });
  const response = await result.launch();
  assert.equal(response.via, "page");
  assert.equal(result.created[0].url, "https://students.cuchd.in/StudentHome.aspx#cuims-clear-lms");
});

test("an already-open LMS tab is focused instead of signing in again", async () => {
  const result = open({ lms: [{ id: 3, windowId: 1, url: "https://lms.cuchd.in/my/courses.php" }] });
  await result.launch();
  assert.equal(result.server.state.requests.length, 0);
  assert.deepEqual(result.focused, [3]);
});

test("Open CUIMS opens a new tab only after making sure the session is signed in", async () => {
  const order = [];
  const result = open({
    ensureSession: async () => {
      order.push("session");
      return { alive: true, signedIn: true };
    },
  });
  const original = result.created.push.bind(result.created);
  result.created.push = (entry) => {
    order.push("open");
    return original(entry);
  };
  const response = await result.openCuims();
  assert.deepEqual(order, ["session", "open"]);
  assert.equal(response.signedIn, true);
  assert.deepEqual(plain(result.created), [{ url: "https://students.cuchd.in/StudentHome.aspx", active: true, index: 1 }]);
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
  assert.equal(result.server.state.requests.length, 0);
});

test("live CUIMS: the postback's redirect chain signs LMS in, and the tab opens LMS courses directly", async () => {
  const server = cuims({ mode: "redirect" });
  const result = open({ server });
  const response = await result.launch();
  assert.equal(response.via, "sso");
  assert.deepEqual(plain(result.created), [{ url: COURSES, active: true, index: 1 }]);
  const post = server.state.requests.find((request) => request.method === "POST");
  assert.equal(post.redirect, "follow");
  assert.equal(server.state.requests.find((request) => request.method === "GET").redirect, "manual");
});

test("a postback that ends anywhere but a signed-in LMS page falls back to the tab", async () => {
  const server = cuims({ mode: "redirect" });
  const base = server.fetchImpl;
  server.fetchImpl = async (url, options = {}) => {
    const answer = await base(url, options);
    return options.method === "POST" ? { ...answer, url: "https://lms.cuchd.in/login/index.php" } : answer;
  };
  const response = await open({ server }).launch();
  assert.equal(response.via, "page");
});

test("a background sign-in that outlasts Open CUIMS's wait is cancelled before the tab opens", async () => {
  let signal = null;
  const result = open({
    server: cuims({ signedIn: false }),
    ensureSession: (options) => {
      signal = options?.signal;
      return new Promise(() => {});
    },
    // The 30 s wait elapses at once.
    timers: { setTimeout: (fn) => (queueMicrotask(fn), 1), clearTimeout() {} },
  });
  const response = await result.send({ type: "cuims-clear:open-cuims", tabId: 1 });
  assert.equal(response.via, "tab");
  assert.ok(signal, "the sign-in was handed a signal");
  assert.equal(signal.aborted, true, "the sign-in is told to stop before the tab can race it");
});


test("LMS uses the shared CUIMS request operation for both the home read and SSO post", async () => {
  const server = cuims();
  let operations = 0;
  const result = open({ server, withRequests: async (task) => { operations += 1; return task(server.fetchImpl); } });
  assert.equal((await result.launch()).via, "sso");
  assert.equal(operations, 1);
  assert.equal(server.state.requests.length, 2);
});

test("a shared cooldown prevents LMS network calls and CUIMS fallback navigation", async () => {
  const server = cuims();
  const result = open({ server, withRequests: async () => { throw Object.assign(new Error("CUIMS is limiting requests. Next try in 5 min."), { code: "backoff" }); } });
  const response = await result.launch();
  assert.match(response.error, /Next try in 5 min/);
  assert.equal(server.state.requests.length, 0);
  assert.equal(result.created.length, 0);
});
