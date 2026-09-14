import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-launch.js", import.meta.url), "utf8");

async function launch({
  pending,
  hash = "#cuims-clear-lms",
  signedIn = true,
  iframe = false,
  href = "javascript:__doPostBack('ctl00$lbtnLMSSSO','')",
} = {}) {
  const store = new Map(pending ? [["cuims-clear:lms-launch", String(pending)]] : []);
  const dest = { href: undefined };
  let clicked = false;
  const created = [];
  const link = {
    href,
    matches: (sel) => sel.includes("a"),
    getAttribute: (name) => name === "href" ? href : null,
    click: () => { clicked = true; },
  };
  const window = { open: () => "native" };
  window.top = iframe ? {} : window;
  const context = vm.createContext({
    URL,
    window,
    history: { replaceState() {} },
    location: {
      hash, pathname: "/StudentHome.aspx", search: "",
      href: "https://students.cuchd.in/StudentHome.aspx",
      origin: "https://students.cuchd.in",
      assign: (url) => { dest.href = url; },
    },
    sessionStorage: {
      getItem: (k) => store.get(k),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    document: {
      readyState: "complete",
      querySelector: (sel) => {
        if (/#txtUserId|#txtPassword|#captchaCode|#btnNext|#btnLogin/.test(sel)) {
          return signedIn ? null : { id: "login" };
        }
        return signedIn ? link : null;
      },
      querySelectorAll: () => signedIn ? [link] : [],
      createElement: (tag) => {
        created.push(tag);
        return { style: {}, append() {} };
      },
      addEventListener() {},
    },
    setTimeout: (fn, ms) => {
      if (ms >= 1000) return 0;
      return globalThis.setTimeout(fn, ms);
    },
    clearTimeout: globalThis.clearTimeout,
    chrome: {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults }),
          set: async () => {},
          remove: async () => {},
        },
        onChanged: { addListener() {} },
      },
      runtime: { sendMessage() {}, onMessage: { addListener() {} } },
    },
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { dest, clicked, store, created, window: context.window };
}

test("does not inject a custom LMS overlay on CUIMS", async () => {
  assert.equal(source.includes("cuims-lms-launch-status"), false);
  assert.equal(/Open CU LMS/.test(source), false);
  const result = await launch();
  assert.deepEqual(result.created, []);
});

test("clicks the official CU LMS control instead of showing a custom overlay", async () => {
  const result = await launch();
  assert.equal(result.clicked, true);
});

test("opens a direct LMS href from the official control without a second click", async () => {
  const result = await launch({ href: "https://lms.cuchd.in/auth/example?ticket=fixture" });
  assert.equal(result.clicked, false);
  assert.equal(result.dest.href, "https://lms.cuchd.in/auth/example?ticket=fixture");
});

test("normal visits, expired requests and subframes never trigger SSO", async () => {
  for (const options of [{ hash: "" }, { hash: "", pending: Date.now() - 11 * 60 * 1000 }, { iframe: true }]) {
    assert.equal((await launch(options)).clicked, false);
  }
});

test("retains the short-lived launch intent while CUIMS requires login", async () => {
  const result = await launch({ signedIn: false });
  assert.equal(result.clicked, false);
  assert.equal(result.store.size, 1);
});
