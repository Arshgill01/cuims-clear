import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-open-wrap.js", import.meta.url), "utf8");

function wrap({ pending = Date.now(), open = () => "native" } = {}) {
  const store = new Map(pending ? [["cuims-clear:lms-launch", String(pending)]] : []);
  const dest = { href: undefined };
  const window = { open, top: null };
  window.top = window;
  const context = vm.createContext({
    URL,
    window,
    location: {
      href: "https://students.cuchd.in/StudentHome.aspx",
      origin: "https://students.cuchd.in",
      assign: (url) => { dest.href = url; },
    },
    sessionStorage: {
      getItem: (k) => store.get(k),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  });
  vm.runInContext(source, context);
  return {
    dest,
    store,
    window: context.window,
    open: (...args) => context.window.open(...args),
  };
}

test("follows the university window.open LMS URL in this tab", () => {
  const result = wrap();
  assert.equal(result.open("https://lms.cuchd.in/auth/example?ticket=fixture", "_blank"), null);
  assert.equal(result.dest.href, "https://lms.cuchd.in/auth/example?ticket=fixture");
  assert.equal(result.store.size, 0);
});

test("ignores ordinary LMS config URLs and external window.open destinations", () => {
  const result = wrap();
  assert.equal(result.open("https://lms.cuchd.in/"), "native");
  assert.equal(result.open("https://evil.test/"), "native");
  assert.equal(result.dest.href, undefined);
});

test("leaves window.open alone when the student did not ask to open LMS", () => {
  const result = wrap({ pending: 0 });
  assert.equal(result.open("https://lms.cuchd.in/auth/example?ticket=fixture"), "native");
  assert.equal(result.dest.href, undefined);
});
