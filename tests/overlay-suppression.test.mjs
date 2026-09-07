import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

for (const build of ["chrome", "firefox"]) {
  test(`${build}: rescanning hides a feedback popup reopened by the page`, () => {
    let writes = 0;
    const properties = new Map([["display", ["", ""]]]);
    const modal = {
      tagName: "DIV",
      textContent: "Dear Student, Filling out the Feedback related to the Teaching & Learning Process",
      dataset: {},
      isConnected: true,
      style: {
        getPropertyValue: (name) => properties.get(name)?.[0] || "",
        getPropertyPriority: (name) => properties.get(name)?.[1] || "",
        setProperty(name, value, priority = "") {
          writes += 1;
          properties.set(name, [value, priority]);
        },
        removeProperty: (name) => properties.delete(name),
      },
      removeAttribute() { delete this.dataset.cuimsClearSuppressed; },
    };
    const body = {
      classList: { remove() {} },
      style: { removeProperty() {} },
      querySelectorAll: () => [],
    };
    const context = vm.createContext({
      document: {
        documentElement: null,
        body,
        addEventListener() {},
        querySelector: () => null,
        querySelectorAll: (selector) => selector === ".modal.in" ? [modal] : [],
        createTreeWalker: () => ({ nextNode: () => false }),
      },
      chrome: {
        storage: { onChanged: { addListener() {} } },
        runtime: { sendMessage() {} },
      },
      location: { pathname: "/StudentHome.aspx" },
      NodeFilter: { SHOW_TEXT: 4 },
      getComputedStyle: (element) => ({ display: element.style.getPropertyValue("display") }),
    });
    vm.runInContext(readFileSync(new URL(`../outputs/cuims-clear-${build}/content.js`, import.meta.url), "utf8"), context);
    vm.runInContext("scanPage()", context);
    assert.equal(modal.style.getPropertyValue("display"), "none");

    // CUIMS opens the already-classified modal after the first scan.
    modal.style.setProperty("display", "block");
    vm.runInContext("scanPage()", context);
    assert.equal(modal.style.getPropertyValue("display"), "none");
    assert.equal(modal.style.getPropertyPriority("display"), "important");

    const writesBeforeScan = writes;
    vm.runInContext("scanPage()", context);
    assert.equal(writes, writesBeforeScan, "unchanged scans must not trigger a mutation loop");

    vm.runInContext("restoreSuppressed()", context);
    assert.equal(modal.style.getPropertyValue("display"), "", "restore the original style, not the page's override");
    assert.equal(modal.dataset.cuimsClearSuppressed, undefined);
  });
}
