import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/cuims-clear-firefox/lms-boot.js", import.meta.url), "utf8");

function boot({ hash = "", path = "/my/courses.php", enabled = true, iframe = false } = {}) {
  const className = { value: "" };
  const root = {
    classList: {
      add: (name) => { className.value = [...new Set(`${className.value} ${name}`.trim().split(/\s+/))].join(" "); },
      remove: (name) => { className.value = className.value.split(/\s+/).filter((n) => n && n !== name).join(" "); },
    },
  };
  let replaced;
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
      storage: { local: { get: (defaults, cb) => cb({ ...defaults, lmsClear: enabled }) } },
    },
  }));
  return { className: className.value, replaced };
}

test("marks the document pending before Moodle paints, then sends LMS home to courses", () => {
  const result = boot({ path: "/my/" });
  assert.match(result.className, /cc-lms-pending/);
  assert.equal(result.replaced, "https://lms.cuchd.in/my/courses.php");
});

test("original view and a stored off switch never hide the native page", () => {
  assert.equal(boot({ hash: "#original" }).className, "");
  const off = boot({ enabled: false });
  assert.doesNotMatch(off.className, /cc-lms-pending/);
  assert.match(off.className, /cc-lms-original/);
  assert.equal(off.replaced, undefined);
});

test("subframes never rewrite LMS navigation", () => {
  assert.equal(boot({ iframe: true, path: "/my/" }).replaced, undefined);
});
