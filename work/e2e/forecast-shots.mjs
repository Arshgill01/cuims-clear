// Screenshots of the Forecast tab from the real popup files at popup size,
// with the stub and scenarios in popup-stub.mjs. No network, no account.
//   node work/e2e/forecast-shots.mjs [chrome|firefox] [package dir]
// Writes PNGs to work/e2e/results/forecast/<browser>/.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";
import { preparePopup } from "./popup-stub.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const browserName = process.argv[2] || "chrome";
const source = path.resolve(process.argv[3] || path.join(here, "../../outputs/cuims-clear-firefox"));
const out = path.join(here, "results/forecast", browserName);
mkdirSync(out, { recursive: true });
const pkg = preparePopup(source, path.join(here, "results/forecast/.popup"));

const browser = await launchBrowser(browserName);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.setViewport({ width: 440, height: 600, deviceScaleFactor: 2 });
const settle = (ms = 300) => new Promise((done) => setTimeout(done, ms));
const open = async (query = "") => {
  await page.goto(`file://${pkg}/popup.html?${query}`);
  await settle();
};
const frame = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
// The whole scrolling view in one image.
async function full(name) {
  await page.evaluate(() => {
    for (const node of [document.documentElement, document.body, document.querySelector(".app")]) node.style.height = "auto";
    document.querySelector(".views").style.overflow = "visible";
  });
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}

const shots = {
  async popup() { await open(); await frame("popup"); },
  async full() { await open(); await full("full"); },
  async hoverLeft() {
    await open();
    const box = await (await page.$(".fc-hero .fc-chart")).boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height * 0.6);
    await settle(100);
    await frame("hover-left");
    await page.mouse.move(box.x + box.width - 3, box.y + box.height * 0.6);
    await settle(100);
    await frame("hover-right");
  },
  async calendar() {
    await open();
    await page.click("[data-cal-toggle]");
    await settle();
    await frame("calendar");
  },
  async waiting() { await open("scenario=no-timetable"); await frame("waiting-timetable"); },
  async stale() {
    await open("scenario=old-read&view=attendance");
    await frame("stale-attendance");
    await open("scenario=old-read");
    await frame("stale-forecast");
  },
  async throttled() { await open("scenario=throttled"); await frame("throttled"); },
  async impact() {
    await open("scenario=long-titles");
    await page.click('[data-plan-day="2026-10-16"]');
    await settle(100);
    await page.click("[data-plan-whole]");
    await settle();
    await page.evaluate(() => document.querySelector(".fc-impact").scrollIntoView({ block: "center" }));
    await frame("impact-long-titles");
  },
  async themes() {
    for (const theme of ["tokyo-night", "catppuccin-latte", "everforest", "rose-pine"]) {
      await open(`theme=${theme}`);
      await page.click("[data-cal-toggle]");
      await settle();
      await frame(`theme-${theme}`);
    }
  },
};
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(",")) : null;
for (const [name, run] of Object.entries(shots)) {
  if (only && !only.has(name)) continue;
  await run();
}
await browser.close();
if (errors.length) {
  console.log(`PAGE ERRORS:\n${[...new Set(errors)].join("\n")}`);
  process.exitCode = 1;
}
console.log("shots in", out);
