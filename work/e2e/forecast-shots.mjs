// Screenshots the Forecast tab from the real popup files with a stubbed
// chrome.* API, the synthetic semester in tests/forecast-fixture.mjs, and a
// frozen clock (Fri 9 Oct 2026, 10:05 IST). No network, no account.
//   node work/e2e/forecast-shots.mjs [chrome|firefox] [package dir]
// Writes PNGs to work/e2e/results/forecast/.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";
import { semester } from "../../tests/forecast-fixture.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const browserName = process.argv[2] || "chrome";
const source = path.resolve(process.argv[3] || path.join(here, "../../outputs/cuims-clear-firefox"));
const out = path.join(here, "results/forecast", browserName);
const pkg = path.join(here, "results/forecast/.popup");
rmSync(pkg, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(source, pkg, { recursive: true });

const FROZEN = Date.UTC(2026, 9, 9, 4, 35);
const { snapshot, history } = semester({ until: "2026-10-08" });
snapshot.fetchedAt = new Date(FROZEN - 3 * 60_000).toISOString();

function stub(extra) {
  return `(() => {
  const FROZEN = ${FROZEN};
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FROZEN])); }
    static now() { return FROZEN; }
  }
  window.Date = FrozenDate;
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") || "clear";
  try { localStorage.setItem("cuims-clear:theme", theme); } catch {}
  const data = Object.assign({ uid: "24BCS10000", password: "x", popupView: "forecast", theme, attendanceGoal: query.get("goal") || "standard",
    attendanceSnapshot: ${JSON.stringify(snapshot)}, attendanceHistory: query.get("nohistory") ? null : ${JSON.stringify(history)},
    attendanceStatus: null, forecastEnd: query.get("end") || "", attendancePlan: null }, ${JSON.stringify(extra || {})});
  const listeners = [];
  const pick = (d) => (typeof d === "string" ? { [d]: data[d] } : Array.isArray(d) ? Object.fromEntries(d.map((k) => [k, data[k]])) : Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in data ? data[k] : v])));
  const local = { get: (d, cb) => { const v = pick(d); cb?.(v); return Promise.resolve(v); }, set: (v, cb) => { Object.assign(data, v); cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } };
  window.chrome = {
    storage: { local, onChanged: { addListener(fn) { listeners.push(fn); } } },
    runtime: { sendMessage: (m, cb) => cb?.({ snapshot: data.attendanceSnapshot }), getManifest: () => ({ version: "0.9.6" }), lastError: null, getURL: (p) => p },
    permissions: { contains: (o, cb) => cb?.(true), request: (o, cb) => cb?.(true) },
    tabs: { query: async () => [] },
  };
})();`;
}
writeFileSync(path.join(pkg, "stub.js"), stub());
writeFileSync(path.join(pkg, "popup.html"), readFileSync(path.join(pkg, "popup.html"), "utf8").replace('<script src="themes.js">', '<script src="stub.js"></script><script src="themes.js">'));

const browser = await launchBrowser(browserName);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
await page.setViewport({ width: 440, height: 600, deviceScaleFactor: 2 });

const settle = () => new Promise((done) => setTimeout(done, 350));
async function open(query = "") {
  await page.goto(`file://${pkg}/popup.html?${query}`);
  await settle();
}
// The scrolling view, unrolled so one image shows the whole tab.
async function full(name) {
  await page.evaluate(() => {
    document.documentElement.style.height = "auto";
    document.body.style.height = "auto";
    document.querySelector(".app").style.height = "auto";
    const views = document.querySelector(".views");
    views.style.overflow = "visible";
  });
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}
const frame = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(",")) : null;
const shots = {
  async popup() { await open(); await frame("popup"); },
  async full() { await open(); await full("full"); },
  async attendance() { await open(); await page.click("#tab-attendance"); await settle(); await frame("attendance"); },
  async plan() {
    await open();
    await page.click('[data-plan-day="2026-10-10"]');
    await settle();
    await page.click("[data-plan-key]");
    await settle();
    await page.evaluate(() => document.querySelector(".fc-plan").scrollIntoView());
    await frame("plan");
  },
  async whole() {
    await open();
    await page.click('[data-plan-day="2026-10-12"]');
    await settle();
    await page.click("[data-plan-whole]");
    await settle();
    await full("whole-day");
  },
  async subject() {
    await open();
    await page.click("[data-subject]");
    await settle();
    await page.evaluate(() => document.querySelector(".fc-subjects").scrollIntoView());
    await frame("subject-open");
  },
  async hover() {
    await open();
    const box = await (await page.$(".fc-hero .fc-chart")).boundingBox();
    await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.5);
    await settle();
    await page.screenshot({ path: path.join(out, "hover.png"), clip: { x: box.x - 20, y: box.y - 60, width: box.width + 40, height: box.height + 80 } });
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await settle();
    await page.screenshot({ path: path.join(out, "hover-past.png"), clip: { x: box.x - 20, y: box.y - 60, width: box.width + 40, height: box.height + 80 } });
  },
  async strict() { await open("goal=strict"); await frame("strict"); },
  async nohistory() { await open("nohistory=1"); await full("no-history"); },
  async themes() {
    for (const theme of ["tokyo-night", "catppuccin-latte", "flexoki-light", "hackerman", "rose-pine", "gruvbox"]) {
      await open(`theme=${theme}`);
      await frame(`theme-${theme}`);
    }
  },
};
for (const [name, run] of Object.entries(shots)) {
  if (only && !only.has(name)) continue;
  await run();
  console.log("shot", name);
}
await browser.close();
if (errors.length) {
  console.log("PAGE ERRORS:\n" + [...new Set(errors)].join("\n"));
  process.exitCode = 1;
}
