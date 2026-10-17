// Offline 1.0 UI smoke in a real browser, using the existing saved-data stub.
// node work/e2e/release-1.0.mjs <chrome|firefox> <package-dir>
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";
import { preparePopup } from "./popup-stub.mjs";

const name = process.argv[2] || "chrome";
const source = path.resolve(process.argv[3] || `outputs/cuims-clear-${name}`);
const temp = mkdtempSync(path.join(tmpdir(), "cc-release-1.0-"));
const pkg = preparePopup(source, path.join(temp, "popup"));
appendFileSync(path.join(pkg, "scenarios.js"), '\nwindow.__SCENARIOS.default.data.founding = { founder: true, from: "0.10.6", at: Date.now() };');
const out = path.resolve(`work/e2e/results/release-1.0/${name}`);
mkdirSync(out, { recursive: true });
const browser = await launchBrowser(name);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 600 });
  if (name === "chrome") await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const errors = [];
  const network = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page.goto(`file://${pkg}/popup.html?view=club`);
  await page.waitForSelector("#capsule-note");
  assert.match(await page.$eval(".receipt-card", (el) => el.textContent), /FOUNDING MEMBER/);
  assert.ok(await page.$(".heat-card svg"), "attendance heatmap renders");
  assert.ok(await page.evaluate(() => window.__stored.clubSeen.printed));

  // Receipt export uses a real canvas and a PNG blob, without writing a download.
  await page.evaluate(() => {
    window.__blobs = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { window.__blobs.push(blob); return original(blob); };
    document.addEventListener("click", (event) => {
      if (event.target.closest?.("a[download]")) event.preventDefault();
    }, true);
  });
  await page.$eval('[data-receipt="save"]', (el) => el.click());
  await page.waitForFunction(() => window.__blobs.some((blob) => blob.type === "image/png"));
  const receipt = await page.evaluate(async () => {
    const image = await createImageBitmap(window.__blobs.find((blob) => blob.type === "image/png"));
    return { width: image.width, height: image.height };
  });
  assert.deepEqual(receipt, { width: 1080, height: 1920 });

  await page.type("#capsule-note", "Keep showing up.");
  await page.$eval('[data-capsule="seal"]', (el) => el.click());
  assert.equal(await page.evaluate(() => window.__stored.timeCapsule.note), "Keep showing up.");
  await page.$eval('[data-capsule="break"]', (el) => el.click());
  assert.equal(await page.evaluate(() => window.__stored.timeCapsule.broken), false);
  await page.$eval('[data-capsule="break"]', (el) => el.click());
  assert.equal(await page.evaluate(() => window.__stored.timeCapsule.broken), true);
  assert.match(await page.$eval("#capsule-body", (el) => el.textContent), /Keep showing up/);

  await page.$eval("[data-wrapped-open]", (el) => el.click());
  await page.waitForSelector(".wrapped-canvas");
  assert.match(await page.$eval("#wrapped-count", (el) => el.textContent), /1 \/ 6/);
  await page.keyboard.press("ArrowRight");
  assert.match(await page.$eval("#wrapped-count", (el) => el.textContent), /2 \/ 6/);
  await page.keyboard.press("Escape");
  assert.equal(await page.$(".wrapped-canvas"), null);

  await page.$eval('[data-cal="classes"]', (el) => el.click());
  await page.waitForFunction(() => window.__blobs.some((blob) => blob.type.startsWith("text/calendar")));
  const calendar = await page.evaluate(async () => window.__blobs.find((blob) => blob.type.startsWith("text/calendar")).text());
  assert.match(calendar, /BEGIN:VCALENDAR/);
  assert.match(calendar, /BEGIN:VEVENT/);
  await page.$eval('[data-game="play"]', (el) => el.click());
  await page.keyboard.press(" ");
  await page.click("#tab-theme");
  await page.waitForSelector('[data-theme-id="founders"]');
  assert.equal(await page.$eval('[data-theme-id="founders"]', (el) => el.getAttribute("aria-disabled")), null);
  await page.$eval('[data-theme-id="founders"]', (el) => el.click());
  assert.equal(await page.evaluate(() => window.__stored.theme), "founders");
  await page.click("#tab-club");
  await page.waitForSelector(".receipt-card");
  await page.screenshot({ path: path.join(out, "founder.png") });

  appendFileSync(path.join(pkg, "scenarios.js"), '\nwindow.__SCENARIOS.default.data.founding = { founder: false };');
  await page.reload();
  await page.click("#tab-theme");
  await page.waitForSelector('[data-theme-id="founders"]');
  assert.equal(await page.$eval('[data-theme-id="founders"]', (el) => el.getAttribute("aria-disabled")), "true");
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  const report = { browser: await browser.version(), receipt, capsule: "seal and two-step early open", wrapped: "navigate and dismiss", calendar: "ICS generated", founders: "unlocked for founder; locked for fresh install", errors, network };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
