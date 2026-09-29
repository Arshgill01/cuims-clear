import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-open.js", import.meta.url), "utf8");

// Objects built inside the VM belong to another realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

const TICKET = "https://lms.cuchd.in/auth/cuims/login.php?ticket=fixture&u=1";
const DASHBOARD = `<form method="post" action="./StudentHome.aspx" id="form1">
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="vs&amp;1" />
<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="ev" />
<a id="ContentPlaceHolder1_lbtnLMSSSO" href="javascript:__doPostBack(&#39;ctl00$ContentPlaceHolder1$lbtnLMSSSO&#39;,&#39;&#39;)">Click here</a>
</form>`;
const HANDOFF = `<html><script>window.open('${TICKET.replace(/&/g, "\\u0026")}','_blank');</script></html>`;

// students.cuchd.in as the SSO launcher sees it. `signedIn` may flip when the
// session helper signs in.
function cuims({ signedIn = true, handoff = HANDOFF } = {}) {
  const state = { signedIn, requests: [], posts: [] };
  async function fetchImpl(url, options = {}) {
    const method = options.method || "GET";
    state.requests.push({ method, url, redirect: options.redirect });
    const response = (status, body, type = "basic") => ({ status, type, text: async () => body });
    if (!state.signedIn) return response(0, "", "opaqueredirect");
    if (method === "GET") return response(200, DASHBOARD);
    state.posts.push(new URLSearchParams(options.body));
    return response(200, handoff);
  }
  return { state, fetchImpl };
}

function open({ lms = [], active = { id: 1, index: 0, windowId: 1, url: "about:newtab" }, server = cuims(), ensureSession } = {}) {
  const created = [];
  const updated = [];
  const focused = [];
  const storage = {};
  const listeners = [];
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener: (fn) => listeners.push(fn) } },
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
  const context = vm.createContext({ chrome, fetch: server.fetchImpl, URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, Promise });
  if (ensureSession) context.cuimsEnsureSession = ensureSession;
  vm.runInContext(source, context);
  const send = (message, sender = { id: "ext" }) =>
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
  const server = cuims({ signedIn: false });
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
  assert.ok(result.storage.lmsLaunchAt);
  assert.deepEqual(plain(result.created), [{ url: "https://students.cuchd.in/StudentHome.aspx#cuims-clear-lms", active: true, index: 1 }]);
});

test("a handoff that points anywhere but LMS is not followed", async () => {
  const result = open({ server: cuims({ handoff: `<script>window.open('https://evil.example/steal','_blank')</script>` }) });
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
  const response = await result.send({ type: "cuims-clear:launch-lms" }, { id: "ext", tab: { id: 4 } });
  assert.equal(response, undefined);
  assert.equal(result.server.state.requests.length, 0);
});
