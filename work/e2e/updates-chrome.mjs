// 0.10.6 update notices in a real Chrome, disposable profile, unpacked
// build. No saved login, so nothing signs in. Network: CUIMS's login page.
// An unpacked extension has no store, so Chrome's own update check answers
// "no update" (or refuses): the test checks the popup says so plainly.
//   node work/e2e/updates-chrome.mjs outputs/cuims-clear-chrome
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

const packageDir = path.resolve(process.argv[2] || "outputs/cuims-clear-chrome");
const out = path.resolve("work/e2e/results");
mkdirSync(out, { recursive: true });
const temp = mkdtempSync(path.join(tmpdir(), "cc-updates-chrome-"));
const browser = await launchBrowser("chrome", { profileDir: path.join(temp, "profile") });
const report = { checks: [] };
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const id = await browser.installExtension(packageDir);
  const popupUrl = `chrome-extension://${id}/popup.html`;
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 600, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(popupUrl);
  await page.waitForFunction(() => document.querySelector("#version")?.textContent);
  const seed = (values) => page.evaluate((data) => chrome.storage.local.set(data), values);
  const stored = (key) => page.evaluate((name) => chrome.storage.local.get(name).then((data) => data[name]), key);

  // Check now: Chrome's own update check, which an unpacked build cannot use.
  await seed({ popupView: "settings" });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#view-settings").hidden);
  await page.click("#update-check");
  await page.waitForFunction(() => /Checked|out|Couldn't/.test(document.querySelector("#update-state").textContent), { timeout: 30_000 });
  report.checkNow = { state: await page.$eval("#update-state", (node) => node.textContent), info: await stored("updateInfo") };
  report.checks.push(`Check now: "${report.checkNow.state}"`);

  // A newer version: the banner and Update now.
  await seed({ updateInfo: { latest: "0.10.7", checkedAt: Date.now(), ready: false, error: "" }, popupView: "attendance" });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#update-banner").hidden);
  report.banner = await page.$eval("#update-banner", (node) => node.innerText);
  assert.match(report.banner, /0\.10\.7 is out/);
  await settle(400);
  await page.screenshot({ path: path.join(out, "chrome-updates-banner.png") });
  await page.click("#update-now");
  await page.waitForFunction(() => document.querySelector("#status").textContent, { timeout: 90_000 });
  report.updateNow = await page.$eval("#status", (node) => node.textContent);
  report.checks.push(`Update now with no store copy: "${report.updateNow}"`);

  // The bar on CUIMS: a button, not a link.
  await seed({ updateInfo: { latest: "0.10.7", checkedAt: Date.now(), ready: false, error: "" }, updateSnoozeUntil: 0 });
  const cuims = await browser.newPage();
  await cuims.setViewport({ width: 900, height: 680, deviceScaleFactor: 1 });
  await cuims.goto("https://students.cuchd.in/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await cuims.waitForFunction(() => document.getElementById("cuims-clear-update-bar")?.getBoundingClientRect().width > 0, { timeout: 30_000 });
  await settle(400);
  await cuims.screenshot({ path: path.join(out, "chrome-updates-cuims-bar.png") });
  report.checks.push(`bar shown on ${new URL(cuims.url()).pathname}`);

  // × hides it for a day, in every CUIMS tab.
  const box = await cuims.$eval("#cuims-clear-update-bar", (node) => { const r = node.getBoundingClientRect(); return { x: r.right - 12 - 13, y: r.top + 12 + 9 }; });
  await cuims.mouse.click(box.x, box.y);
  await cuims.waitForFunction(() => !document.getElementById("cuims-clear-update-bar"), { timeout: 5_000 });
  const snooze = await stored("updateSnoozeUntil");
  assert.ok(snooze > Date.now() + 23 * 3_600_000, "hidden for a day");
  report.checks.push("× hides the bar and saves a day's snooze");
  report.errors = errors;
  report.ok = errors.length === 0;
} catch (error) {
  report.ok = false;
  report.error = String(error?.message || error);
} finally {
  await browser.close().catch(() => {});
  rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
