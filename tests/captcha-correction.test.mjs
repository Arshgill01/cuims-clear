import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Load a browser build's content.js into a VM so we can call the CAPTCHA
// geometry helpers directly. Canvas is intentionally unavailable, matching a
// hardened worst case where getImageData is blocked.
function loadContent(browser) {
  const document = {
    documentElement: null,
    body: { innerText: "", appendChild() {} },
    addEventListener() {},
    getElementById() { return null; },
    createElement() {
      // A canvas whose 2D context is unavailable (no getContext support).
      return { dataset: {}, style: {}, setAttribute() {}, remove() {}, getContext() { return null; } };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    document,
    location: { pathname: "/Login.aspx" },
    localStorage: (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    sessionStorage: (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    chrome: { storage: { onChanged: { addListener() {} } }, runtime: { sendMessage() {} } },
    Event: class { constructor(type) { this.type = type; } },
    console,
  });
  const script = readFileSync(new URL(`../outputs/cuims-clear-${browser}/content.js`, import.meta.url), "utf8");
  vm.runInContext(script, context);
  return (expression) => vm.runInContext(expression, context);
}

for (const browser of ["chrome", "firefox"]) {
  test(`${browser}: correctCaptchaCase returns the read unchanged when canvas is unavailable`, () => {
    const call = loadContent(browser);
    // No throw, exact passthrough -> a correct OCR read is never corrupted.
    call("globalThis.__img = { naturalWidth: 100, naturalHeight: 30 };");
    assert.equal(call("correctCaptchaCase('vm2x', __img)"), "vm2x");
    assert.equal(call("correctCaptchaCase('PG50', __img)"), "PG50");
    assert.equal(call("correctCaptchaCase('', __img)"), "");
  });

  test(`${browser}: segmentGlyphColumns splits a two-glyph mask by valley and reports tight heights`, () => {
    const call = loadContent(browser);
    // 24x12 mask: a tall bar (cols 3-6, rows 1-10) and a short bar (cols 15-18, rows 6-10),
    // separated by an empty gutter. Expect two boxes; the first is taller.
    const boxes = call(`(() => {
      const w = 24, h = 12; const mask = new Uint8Array(w*h);
      for (let y = 1; y <= 10; y++) for (let x = 3; x <= 6; x++) mask[y*w+x] = 1;
      for (let y = 6; y <= 10; y++) for (let x = 15; x <= 18; x++) mask[y*w+x] = 1;
      return segmentGlyphColumns(w, h, mask, 2);
    })()`);
    assert.equal(boxes.length, 2);
    const h0 = boxes[0].y1 - boxes[0].y0;
    const h1 = boxes[1].y1 - boxes[1].y0;
    assert.ok(h0 > h1, `expected first glyph taller (${h0} > ${h1})`);
  });

  test(`${browser}: segmentGlyphColumns splits a touching (single blob) run into the requested count`, () => {
    const call = loadContent(browser);
    // One continuous ink band cols 2-21 with a thin valley near the middle.
    const boxes = call(`(() => {
      const w = 24, h = 12; const mask = new Uint8Array(w*h);
      for (let y = 2; y <= 9; y++) for (let x = 2; x <= 21; x++) mask[y*w+x] = 1;
      // carve a low-ink valley around x=11-12 (only one row) so a split point exists
      for (let y = 2; y <= 9; y++) { mask[y*w+11] = 0; mask[y*w+12] = 0; }
      for (let x = 11; x <= 12; x++) mask[5*w+x] = 1;
      return segmentGlyphColumns(w, h, mask, 2);
    })()`);
    assert.equal(boxes.length, 2);
  });
}
