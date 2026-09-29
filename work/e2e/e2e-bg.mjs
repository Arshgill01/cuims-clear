// Loads the real package and exercises the background from inside the browser:
// script load, alarm, the background captcha path, and the popup.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { launchFirefox } from "./ff-launch.mjs";

const [browserName, extDir] = process.argv.slice(2);
const CORPUS = new URL("../corpus", import.meta.url).pathname;
const samples = Object.entries(JSON.parse(readFileSync(path.join(CORPUS, "labels.json"), "utf8"))).slice(0, 12)
  .map(([file, label]) => ({ label, b64: readFileSync(path.join(CORPUS, file)).toString("base64") }));
const UUID = "0d6bf9a4-6a46-4f0e-9d3a-2f3c3a1c7e11";
const errors = [];

let browser, base;
if (browserName === "firefox") {
  browser = await launchFirefox({ prefs: { "extensions.webextensions.uuids": JSON.stringify({ "cuims-clear@arshgill01": UUID }) } });
  await browser.installExtension(path.resolve(extDir));
  base = `moz-extension://${UUID}`;
} else {
  browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true, enableExtensions: true });
  const id = await browser.installExtension(path.resolve(extDir));
  base = `chrome-extension://${id}`;
}
await new Promise((r) => setTimeout(r, 2500));

const page = await browser.newPage();
page.on("pageerror", (e) => errors.push("popup: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("popup console: " + m.text()); });
await page.goto(`${base}/popup.html`);
await new Promise((r) => setTimeout(r, 800));
const popup = await page.evaluate(() => ({
  version: document.querySelector("#version")?.textContent,
  tabs: document.querySelectorAll("[role=tab]").length,
}));

let report;
if (browserName === "firefox") {
  report = await page.evaluate(async (samples) => {
    const bg = await browser.runtime.getBackgroundPage();
    const out = { daemon: typeof bg.startAttendanceBackground, ensure: typeof bg.cuimsEnsureSession, lms: typeof bg.cuimsEnsureSession === "function" && typeof bg.openLms, alarm: Boolean(await browser.alarms.get("cuims-clear-attendance")), reads: [] };
    for (const { label, b64 } of samples) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const t = performance.now();
      try { out.reads.push({ label, text: await bg.solveCaptchaBytes(bytes), ms: Math.round(performance.now() - t) }); }
      catch (e) { out.reads.push({ label, error: String(e) }); }
    }
    return out;
  }, samples);
} else {
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith(base));
  const worker = await target.worker();
  report = await worker.evaluate(async (samples) => {
    const out = { daemon: typeof startAttendanceBackground, ensure: typeof cuimsEnsureSession, lms: typeof openLms, alarm: Boolean(await chrome.alarms.get("cuims-clear-attendance")), reads: [] };
    for (const { label, b64 } of samples) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const t = performance.now();
      try { out.reads.push({ label, text: await solveCaptchaViaOffscreen(bytes), ms: Math.round(performance.now() - t) }); }
      catch (e) { out.reads.push({ label, error: String(e) }); }
    }
    return out;
  }, samples);
}
const right = report.reads.filter((r) => r.text === r.label).length;
console.log(JSON.stringify({ browser: browserName, popup, daemon: report.daemon, ensure: report.ensure, lms: report.lms, alarm: report.alarm, backgroundCaptcha: `${right}/${report.reads.length}`, ms: report.reads.map((r) => r.ms), wrong: report.reads.filter((r) => r.text !== r.label), errors }, null, 1));
await browser.close().catch(() => {});
browser.__kill?.();
process.exit(0);
