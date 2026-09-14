import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const browser of ["firefox", "chrome"]) {
  test(`${browser} popup puts Open CUIMS and Open LMS above the settings form`, () => {
    const html = readFileSync(new URL(`../outputs/cuims-clear-${browser}/popup.html`, import.meta.url), "utf8");
    const nav = html.indexOf('class="open-nav"');
    const cuims = html.indexOf(">Open CUIMS<");
    const lms = html.indexOf(">Open LMS<");
    const form = html.indexOf('id="settings-form"');
    const local = html.indexOf('class="local-data"');

    assert.ok(nav > -1 && cuims > -1 && lms > -1 && form > -1);
    assert.ok(nav < cuims && cuims < lms && lms < form);
    assert.ok(form < local);
    assert.equal(html.split(">Open CUIMS<").length, 2);
    assert.equal(html.split(">Open LMS<").length, 2);
  });
}
