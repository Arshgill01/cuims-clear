import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-boot.js", import.meta.url), "utf8");

function boot({ hash = "", path = "/my/courses.php", enabled = true, iframe = false, asyncStorage = false } = {}) {
  const className = { value: "" };
  const style = {};
  const root = {
    classList: {
      add: (name) => { className.value = [...new Set(`${className.value} ${name}`.trim().split(/\s+/))].join(" "); },
      remove: (name) => { className.value = className.value.split(/\s+/).filter((n) => n && n !== name).join(" "); },
    },
    style: {
      setProperty: (name, value) => { style[name] = value; },
      removeProperty: (name) => { delete style[name]; },
    },
  };
  let replaced;
  let stored;
  const window = {};
  window.top = iframe ? {} : window;
  vm.runInContext(source, vm.createContext({
    window,
    document: { documentElement: root },
    location: {
      hash, pathname: path,
      replace: (url) => { replaced = url; },
    },
    chrome: {
      storage: {
        local: {
          get: (defaults, cb) => {
            const result = { ...defaults, lmsClear: enabled };
            if (asyncStorage) stored = () => cb(result);
            else cb(result);
          },
        },
      },
    },
  }));
  return {
    get className() { return className.value; },
    style,
    get replaced() { return replaced; },
    flush() { stored?.(); },
  };
}

test("marks the document pending before Moodle paints, then sends LMS home to courses", () => {
  const result = boot({ path: "/my/" });
  assert.match(result.className, /cc-lms-pending/);
  assert.equal(result.style.visibility, "hidden");
  assert.equal(result.replaced, "https://lms.cuchd.in/my/courses.php");
});

test("hides the document before storage returns and only then redirects home", () => {
  const result = boot({ path: "/my/", asyncStorage: true });
  assert.match(result.className, /cc-lms-pending/);
  assert.equal(result.style.visibility, "hidden");
  assert.equal(result.replaced, undefined);
  result.flush();
  assert.equal(result.replaced, "https://lms.cuchd.in/my/courses.php");
});

test("original view and a stored off switch never hide the native page", () => {
  assert.equal(boot({ hash: "#original" }).className, "");
  const off = boot({ enabled: false });
  assert.doesNotMatch(off.className, /cc-lms-pending/);
  assert.match(off.className, /cc-lms-original/);
  assert.equal(off.style.visibility, undefined);
  assert.equal(off.replaced, undefined);
});

test("a stored off switch unhides after storage if hide ran first", () => {
  const off = boot({ enabled: false, asyncStorage: true });
  assert.match(off.className, /cc-lms-pending/);
  off.flush();
  assert.doesNotMatch(off.className, /cc-lms-pending/);
  assert.match(off.className, /cc-lms-original/);
  assert.equal(off.style.visibility, undefined);
});

test("subframes never rewrite LMS navigation", () => {
  assert.equal(boot({ iframe: true, path: "/my/" }).replaced, undefined);
});
