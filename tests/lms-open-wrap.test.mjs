import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-open-wrap.js", import.meta.url), "utf8");

function wrap({ pending = Date.now(), open = () => "native" } = {}) {
  const store = new Map(pending ? [["cuims-clear:lms-launch", String(pending)]] : []);
  const dest = { href: undefined };
  const posted = [];
  const clicked = [];
  const listeners = {};
  const link = {
    href: "javascript:__doPostBack('ctl00$lbtnLMSSSO','')",
    getAttribute: (name) => name === "href" ? "javascript:__doPostBack('ctl00$lbtnLMSSSO','')" : name === "data-cc-lms-sso" ? "1" : null,
    click: () => { clicked.push("link"); },
  };
  const window = {
    open,
    top: null,
    __doPostBack: (target, arg) => { posted.push([target, arg]); },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatchEvent: (event) => listeners[event.type]?.(event),
  };
  window.top = window;
  const context = vm.createContext({
    URL,
    Function,
    window,
    document: { querySelector: (sel) => sel.includes("data-cc-lms-sso") ? link : null },
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
    posted,
    clicked,
    window: context.window,
    open: (...args) => context.window.open(...args),
    activate() { context.window.dispatchEvent({ type: "cuims-clear:lms-activate" }); },
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

test("runs CUIMS __doPostBack in the page world so Chrome can start SSO", () => {
  const result = wrap();
  result.activate();
  assert.deepEqual(result.posted, [["ctl00$lbtnLMSSSO", ""]]);
  assert.equal(result.store.get("cuims-clear:lms-activated"), "1");
});
