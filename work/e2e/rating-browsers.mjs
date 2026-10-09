// Actual popup pages in disposable installed extensions. No portal requests.
// node work/e2e/rating-browsers.mjs chrome <packageDir>
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

const [name, packageDir] = process.argv.slice(2);
assert.equal(name, "chrome", "Use rating-firefox.mjs for Firefox extension pages");
const temp = mkdtempSync(path.join(tmpdir(), "cc-rating-"));
const profileDir = path.join(temp, "profile");
mkdirSync(profileDir);
const output = path.resolve("work/e2e/results");
mkdirSync(output, { recursive: true });
const browser = await launchBrowser(name, { profileDir });
const errors = [];
const report = { browser: await browser.version(), checks: [] };
try {
  const id = await browser.installExtension(path.resolve(packageDir));
  const base = `chrome-extension://${id}`;
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 600, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) request.abort();
    else request.continue();
  });
  await page.goto(`${base}/popup.html`);
  const reload = () => page.reload();
  await page.waitForFunction(() => document.querySelector("#version")?.textContent === "v0.9.5");
  const snapshot = { fetchedAt: new Date().toISOString(), subjects: [
    { code: "24CST-302", title: "Computer Networks", attended: 36, delivered: 40, marks: [] },
    { code: "24SMT-341", title: "Probability and Statistics", attended: 32, delivered: 40, marks: [] },
  ], slots: [], marksDay: "" };
  const today = await page.evaluate(() => CuimsAttendance.campusParts(new Date()).key);
  async function seed(values) {
    await page.evaluate((data) => new Promise((resolve) => chrome.storage.local.set(data, resolve)), {
      attendanceSnapshot: snapshot, attendanceStatus: null, popupView: "attendance", rateNudge: null, ...values,
    });
    await reload();
    await page.waitForFunction(() => document.querySelector("#version")?.textContent === "v0.9.5");
  }
  const hidden = () => page.$eval("#rate-nudge", (node) => node.hidden);
  const state = () => page.evaluate(() => new Promise((resolve) => chrome.storage.local.get("rateNudge", (data) => resolve(data.rateNudge))));
  await seed({ popupView: "settings" });
  assert.equal(await hidden(), true);
  assert.equal((await state())?.topDay || "", "");
  const expected = "https://chromewebstore.google.com/detail/amlobigbjldbogimakmfndkdaekcdbkf/reviews";
  assert.equal(await page.$eval(".rate-line a", (link) => link.href), expected);
  await page.click("#tab-attendance");
  await page.waitForFunction(() => !document.querySelector("#rate-nudge").hidden);
  assert.equal(await page.$eval("#rate-nudge", (node) => node.classList.contains("is-top")), true);
  assert.equal(await page.$eval(".rate-ask a", (link) => link.href), expected);
  await page.screenshot({ path: path.join(output, `${name}-rating-top.png`), fullPage: true });
  report.checks.push("correct store links; Settings preserves daily top appearance; healthy Attendance displays it");
  await page.hover("#rate-nudge");
  await page.waitForFunction(() => document.querySelector("#rate-nudge").classList.contains("is-paused"));
  await new Promise((resolve) => setTimeout(resolve, 8300));
  assert.equal(await page.$eval("#rate-nudge", (node) => node.classList.contains("is-top")), true);
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector("#rate-nudge").classList.contains("is-top"), { timeout: 12000 });
  await page.screenshot({ path: path.join(output, `${name}-rating-bottom.png`), fullPage: true });
  await reload();
  await page.waitForFunction(() => !document.querySelector("#rate-nudge").hidden);
  assert.equal(await page.$eval("#rate-nudge", (node) => node.classList.contains("is-top")), false);
  report.checks.push("eight-second top timer pauses on hover, settles to bottom, and stays bottom on same-day reopen");
  // Keep the real click handler, but avoid opening a live store page.
  await page.$eval(".rate-ask a", (link) => link.addEventListener("click", (event) => event.preventDefault()));
  await page.click(".rate-ask a");
  await page.waitForFunction(() => !document.querySelector(".rate-confirm").hidden);
  assert.equal((await state()).opened, true);
  await page.screenshot({ path: path.join(output, `${name}-rating-confirm.png`), fullPage: true });
  await page.click('[data-rate="not-yet"]');
  await page.waitForFunction(() => !document.querySelector(".rate-ask").hidden);
  await page.click('[data-rate="rated"]');
  assert.equal(await hidden(), true);
  assert.equal((await state()).done, true);
  await reload();
  assert.equal(await hidden(), true);
  report.checks.push("Rate confirmation, Not yet, Already rated and permanent hiding");
  await seed({ rateNudge: { topDay: today } });
  await page.waitForFunction(() => !document.querySelector("#rate-nudge").hidden);
  await page.click('[data-rate="snooze"]');
  let snoozed = await state();
  assert.equal(snoozed.snoozes, 1);
  assert.ok(snoozed.snoozeUntil > Date.now() + 2.9 * 86400000);
  await reload();
  assert.equal(await hidden(), true);
  await seed({ rateNudge: { snoozes: 2, topDay: today } });
  await page.waitForFunction(() => !document.querySelector("#rate-nudge").hidden);
  await page.click('[data-rate="snooze"]');
  assert.equal((await state()).done, true);
  report.checks.push("three-day snooze persists; third dismissal stops future asks");
  await seed({ attendanceStatus: { error: "Test refusal", code: "portal-busy" } });
  assert.equal(await hidden(), true);
  await seed({ attendanceSnapshot: null, attendanceStatus: { working: true, at: Date.now(), phase: "Test read" }, popupView: "attendance" });
  assert.equal(await hidden(), true);
  await page.evaluate((snapshot) => new Promise((resolve) => chrome.storage.local.set({ attendanceSnapshot: snapshot, attendanceStatus: null }, resolve)), snapshot);
  await page.click("#tab-attendance");
  await page.waitForFunction(() => !document.querySelector("#rate-nudge").hidden);
  await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ attendanceSnapshot: null, attendanceStatus: null }, resolve)));
  await page.waitForFunction(() => document.querySelector("#rate-nudge").hidden);
  report.checks.push("errors and empty reads suppress asks; first healthy read shows it; clearing data hides it");
  await seed({ rateNudge: { topDay: today } });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  assert.equal(await page.$eval("#rate-nudge", (node) => getComputedStyle(node).animationName), "none");
  assert.deepEqual(errors, []);
  report.errors = errors;
  writeFileSync(path.join(output, `${name}-rating.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
