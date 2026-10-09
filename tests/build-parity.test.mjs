import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Chrome ships the same shared portal and popup code as Firefox", () => {
  const firefox = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
  const chrome = new URL("../outputs/cuims-clear-chrome/", import.meta.url);
  const shared = ["captcha-glyphs.js", "captcha-solver.js", "content.js", "popup.html", "popup.js", "popup.css",
    "attendance-parse.js", "attendance-model.js", "attendance-client.js", "attendance-daemon.js", "attendance-view.js", "attendance-bg.js",
    "marks.js", "marks-view.js", "timetable.js", "timetable-view.js", "lms-model.js", "lms.js", "lms.css", "lms-launch.js", "lms-boot.js",
    "lms-open.js", "lms-open-wrap.js", "themes.js", "theme-boot.js", "theme-bg.js", "cuims-theme.js", "icons/icon.svg"];
  for (const file of shared) assert.equal(readFileSync(new URL(file, chrome), "utf8"), readFileSync(new URL(file, firefox), "utf8"), file);
  const ff = JSON.parse(readFileSync(new URL("manifest.json", firefox)));
  const ch = JSON.parse(readFileSync(new URL("manifest.json", chrome)));
  assert.equal(ch.version, ff.version);
  assert.equal(ch.version, "0.10.0");
  assert.equal(ch.background.service_worker, "service-worker.js");
  assert.equal(ch.background.scripts, undefined);
  assert.equal(ch.browser_specific_settings, undefined);
  assert.deepEqual(ch.host_permissions, ff.host_permissions);
  const worker = readFileSync(new URL("service-worker.js", chrome), "utf8");
  for (const file of ["marks.js", "timetable.js"])
    assert.ok(worker.indexOf(`"${file}"`) < worker.indexOf('"attendance-daemon.js"'));
  const sync = readFileSync(new URL("../scripts/sync-chrome-build.sh", import.meta.url), "utf8");
  for (const file of ["marks.js", "marks-view.js", "timetable.js", "timetable-view.js"]) assert.ok(sync.includes(file));
});
