import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { contentSource } from "./content-source.mjs";

function page(build) {
  const frames = [];
  const context = vm.createContext({
    document: { documentElement: null, addEventListener() {} },
    chrome: { storage: { onChanged: { addListener() {} } } },
    location: { pathname: "/fixture.aspx" },
    requestAnimationFrame: (fn) => frames.push(fn),
  });
  vm.runInContext(contentSource(build), context);
  return {
    frames,
    changes(records) { context.records = records; vm.runInContext("queuePageMutations(records)", context); },
    reset() { frames.length = 0; vm.runInContext("scanQueued = false", context); },
  };
}
function attr(name, oldValue, value, tagName = "DIV") {
  return { type: "attributes", attributeName: name, oldValue, target: { nodeType: 1, tagName, getAttribute: () => value } };
}

for (const build of ["chrome", "firefox"]) {
  test(`${build}: theme colour/transition writes and no-op classes do not scan the page`, () => {
    const p = page(build);
    p.changes([
      attr("style", "width: 12px; color: red;", "width: 12px; color: rgb(192, 202, 245) !important; background-color: #24283b !important; border-top-color: #292e42 !important; transition-property: opacity, color; transition-duration: 1s, 0s;"),
      attr("class", "modal show", "modal show"),
      { type: "childList", target: { nodeType: 1, tagName: "STYLE" } },
      { type: "childList", target: { nodeType: 1, tagName: "BODY" }, addedNodes: [{ nodeType: 1, tagName: "STYLE" }] },
      { type: "characterData", target: { nodeType: 3, parentElement: { tagName: "SCRIPT" } } },
    ]);
    assert.equal(p.frames.length, 0);
  });
  test(`${build}: overlay visibility, classes and error text still scan and batch into one frame`, () => {
    const p = page(build);
    const records = [
      attr("style", "display: none; color: red;", "display: block; color: blue;"),
      attr("class", "modal", "modal show"),
      attr("hidden", "", null),
      { type: "characterData", target: { nodeType: 3, parentElement: { tagName: "SPAN" } } },
      { type: "childList", target: { nodeType: 1, tagName: "DIV" } },
      attr("style", "", "background: rgba(0, 0, 0, 0.5); position: fixed; inset: 0;"),
    ];
    for (const record of records) {
      p.reset();
      p.changes([record]);
      p.changes([record]);
      assert.equal(p.frames.length, 1, `${record.type} ${record.attributeName || ""}`);
    }
    p.reset();
    p.changes([attr("style", "color: red", "color: blue"), records[0]]);
    assert.equal(p.frames.length, 1, "a cosmetic record must not mask a relevant one");
  });
  test(`${build}: mutation scans use changed roots; a requested full scan takes precedence`, () => {
    const frames = [];
    const context = vm.createContext({
      document: { documentElement: null, addEventListener() {} },
      chrome: { storage: { onChanged: { addListener() {} } } },
      location: { pathname: "/fixture.aspx" },
      requestAnimationFrame: (fn) => frames.push(fn),
    });
    vm.runInContext(contentSource(build), context);
    const root = { nodeType: 1, tagName: "DIV" };
    const added = { nodeType: 1, tagName: "SECTION", parentElement: root };
    context.records = [{ type: "childList", target: root, addedNodes: [added] }];
    vm.runInContext("queuePageMutations(records)", context);
    assert.equal(vm.runInContext("pendingPromptRoots.size", context), 1);
    assert.equal(vm.runInContext("[...pendingPromptRoots][0]", context), added);
    vm.runInContext("queueScan()", context);
    assert.equal(vm.runInContext("pendingPromptRoots", context), null);
    vm.runInContext("queuePageMutations(records)", context);
    assert.equal(vm.runInContext("pendingPromptRoots", context), null);
    assert.equal(frames.length, 1);
  });
}
