// The Forecast tab in the actual installed extension, in Chrome or Firefox.
// A disposable copy of the package carries an in-page driver (Firefox keeps
// extension pages out of BiDi) that seeds a fresh read and a class record,
// drives the tab, and reports to a local HTTP server. The read is fresh, no
// login is saved and nothing is clicked that talks to CUIMS.
//   node work/e2e/forecast-browsers.mjs <chrome|firefox> <package dir>
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";
import { semester } from "../../tests/forecast-fixture.mjs";

const [name, packageDir] = process.argv.slice(2);
assert.ok(["chrome", "firefox"].includes(name), "chrome or firefox");
const temp = mkdtempSync(path.join(tmpdir(), "cc-forecast-"));
const extensionDir = path.join(temp, "extension");
cpSync(path.resolve(packageDir), extensionDir, { recursive: true });

let finish;
const result = new Promise((resolve) => (finish = resolve));
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
    response.end("ok");
    finish(JSON.parse(body));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/report`;

// Yesterday on the campus clock, so today has classes still to come.
const campusToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const yesterday = new Date(`${campusToday}T00:00:00Z`);
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
const { snapshot, history } = semester({ until: yesterday.toISOString().slice(0, 10) });
const seed = { attendanceSnapshot: { ...snapshot, fetchedAt: "NOW" }, attendanceHistory: history, attendanceStatus: null, popupView: "forecast", rateNudge: { done: true } };

const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
if (name === "firefox") {
  manifest.host_permissions.push("<all_urls>");
  manifest.permissions.push("tabs");
  manifest.background.scripts.push("forecast-open-test.js");
  writeFileSync(path.join(extensionDir, "forecast-open-test.js"), `
let opened = false;
async function openForecastTest() {
  if (opened) return;
  opened = true;
  await browser.tabs.create({ url: browser.runtime.getURL("popup.html") });
}
browser.runtime.onInstalled.addListener(openForecastTest);
openForecastTest();
`);
}
writeFileSync(path.join(extensionDir, "manifest.json"), JSON.stringify(manifest));

const driver = async (endpoint, seed) => {
  const checks = [];
  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.message));
  const wait = async (predicate, timeout = 12000) => {
    const end = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > end) throw new Error(`Timed out: ${predicate}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const stored = (key) => new Promise((resolve) => chrome.storage.local.get(key, (data) => resolve(data[key])));
  const view = () => document.querySelector("#view-forecast");
  try {
    if (!sessionStorage.getItem("forecast-seeded")) {
      sessionStorage.setItem("forecast-seeded", "1");
      seed.attendanceSnapshot.fetchedAt = new Date().toISOString();
      await new Promise((resolve) => chrome.storage.local.set(seed, resolve));
      location.reload();
      return;
    }
    await wait(() => view().querySelector(".fc-hero"));
    check(!view().hidden && document.querySelector("#tab-forecast").getAttribute("aria-selected") === "true", "the popup reopens on Forecast");
    check(document.querySelector("#version").textContent === `v${chrome.runtime.getManifest().version}`, "version shown from the manifest");
    check(/≈\d/.test(view().querySelector(".fc-big").textContent), "hero shows the finish figure");
    check(view().querySelectorAll(".fc-subject").length === seed.attendanceSnapshot.subjects.length, "one row per subject");
    check(view().querySelector(".fc-hero svg .fc-past") && view().querySelector(".fc-hero svg .fc-mid"), "hero chart draws history and forecast");

    document.querySelector("#tab-attendance").click();
    await wait(() => document.querySelector("#view-attendance .course-list"));
    check(!document.querySelector("#view-attendance [data-plan-key]"), "Attendance has no planner");
    document.querySelector("#tab-forecast").click();
    await wait(() => !view().hidden && view().querySelector(".fc-hero"));

    const open = [...view().querySelectorAll(".fc-class")].find((row) => !row.classList.contains("is-attend")) || view().querySelector(".fc-class");
    const key = open.dataset.planKey;
    open.click();
    await wait(() => view().querySelector(".fc-impact"));
    check(document.activeElement?.dataset?.planKey === key, "focus stays on the planned class");
    check((await stored("attendancePlan"))?.keys?.includes(key), "the plan is saved");
    check(/planned skip/.test(view().querySelector(".fc-eyebrow").textContent), "hero says the plan is included");
    view().querySelector("[data-plan-clear='day']").click();
    await wait(() => !view().querySelector(".fc-impact"));
    check(((await stored("attendancePlan"))?.keys || []).length === 0, "clearing the day empties the plan");

    const day = view().querySelectorAll("[data-plan-day]")[2];
    day.click();
    await wait(() => view().querySelector(`[data-plan-day="${day.dataset.planDay}"]`).getAttribute("aria-pressed") === "true");
    check(true, "another day can be planned");

    view().querySelector("[data-subject]").click();
    await wait(() => view().querySelector(".fc-detail svg"));
    check(view().querySelector("[data-subject]").getAttribute("aria-expanded") === "true", "a subject opens with its own chart");

    const before = view().querySelector(".fc-eyebrow").textContent;
    view().querySelector("[data-end-step='7']").click();
    await wait(() => view().querySelector(".fc-eyebrow").textContent !== before);
    check(/^\d{4}-\d{2}-\d{2}$/.test(await stored("forecastEnd")), "the last day moves a week and is saved");
    check(view().querySelector("[data-end-reset]"), "a set day offers the estimate back");
    view().querySelector("[data-end-reset]").click();
    await wait(() => view().querySelector(".fc-end-tag"));
    check((await stored("forecastEnd")) === "", "the estimate comes back");

    await new Promise((resolve) => chrome.storage.local.set({ attendanceStatus: { working: true, phase: "Reading attendance…", at: Date.now() } }, resolve));
    await wait(() => view().querySelector(".attendance-note")?.textContent === "Reading attendance…");
    await new Promise((resolve) => chrome.storage.local.set({ attendanceStatus: { working: false, at: Date.now() } }, resolve));
    await wait(() => view().querySelector(".refresh-button") && !view().querySelector(".refresh-button").disabled);
    check(true, "a background read repaints the tab");

    const chart = view().querySelector(".fc-hero .fc-chart");
    const box = chart.querySelector("svg").getBoundingClientRect();
    chart.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + box.width * 0.85, clientY: box.top + box.height / 2 }));
    await wait(() => !chart.querySelector(".fc-tip").hidden);
    check(/≈\d/.test(chart.querySelector(".fc-tip strong").textContent), "pointer shows a forecast point");
    chart.focus();
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await wait(() => !/≈/.test(chart.querySelector(".fc-tip strong").textContent));
    check(true, "keyboard walks the chart back to the first day");

    // Firefox opens the page as a tab, so measure the popup's own frame.
    const views = document.querySelector(".views");
    check(document.body.getBoundingClientRect().width <= 440 && views.scrollWidth <= views.clientWidth, "no sideways scroll");
    check(!errors.length, "no page errors");
  } catch (error) {
    errors.push(String(error?.stack || error));
  }
  await fetch(endpoint, { method: "POST", body: JSON.stringify({ checks, errors }) });
};
writeFileSync(path.join(extensionDir, "forecast-popup-test.js"), `(${driver})(${JSON.stringify(endpoint)}, ${JSON.stringify(seed)});`);
const html = readFileSync(path.join(extensionDir, "popup.html"), "utf8");
writeFileSync(path.join(extensionDir, "popup.html"), html.replace("</body>", '<script src="forecast-popup-test.js"></script></body>'));

const profileDir = path.join(temp, "profile");
mkdirSync(profileDir);
const browser = await launchBrowser(name, { profileDir });
let report;
try {
  const id = await browser.installExtension(extensionDir);
  if (name === "chrome") {
    const page = await browser.newPage();
    await page.setViewport({ width: 440, height: 600 });
    await page.goto(`chrome-extension://${id}/popup.html`);
  }
  report = await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error("no report in 60 s")), 60_000))]);
} finally {
  await browser.close();
  server.close();
  rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify({ browser: name, ...report }, null, 2));
if (report.errors.length) process.exitCode = 1;
