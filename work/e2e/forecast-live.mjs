// One live read for the Forecast tab: the actual Chrome package in a
// disposable profile signs in with .env's test login in the background,
// reads attendance and the class record, and the tab is drawn from it.
// Prints counts and shapes only, never marks, names or credentials. Two
// refreshes at most (the second fills the rest of the record and the
// timetable), well inside CUIMS's throttle.
//   node work/e2e/forecast-live.mjs <chrome package dir>
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

process.loadEnvFile(path.resolve(process.env.ENV_FILE || ".env"));
assert.ok(process.env.CUIMS_UID && process.env.CUIMS_PASSWORD, "CUIMS_UID and CUIMS_PASSWORD in .env");
const temp = mkdtempSync(path.join(tmpdir(), "cc-forecast-live-"));
const profileDir = path.join(temp, "profile");
mkdirSync(profileDir);
const output = path.resolve("work/e2e/results/forecast");
mkdirSync(output, { recursive: true });
const browser = await launchBrowser("chrome", { profileDir });
const summary = {};
try {
  const id = await browser.installExtension(path.resolve(process.argv[2]));
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 600, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.evaluate((uid, password) => new Promise((resolve) => chrome.storage.local.set({ uid, password, popupView: "forecast", rateNudge: { done: true } }, resolve)), process.env.CUIMS_UID, process.env.CUIMS_PASSWORD);
  const stored = () => page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(["attendanceSnapshot", "attendanceHistory", "attendanceStatus", "attendanceTimetable"], resolve)));
  const settled = async (since) => {
    await page.waitForFunction(
      (since) => new Promise((resolve) => chrome.storage.local.get(["attendanceStatus", "attendanceSnapshot"], (data) => resolve(!data.attendanceStatus?.working && (Date.parse(data.attendanceSnapshot?.fetchedAt || "") > since || data.attendanceStatus?.error)))),
      { timeout: 150_000, polling: 1000 },
      since,
    );
  };
  // Opening the tab with no read starts the first refresh.
  let started = Date.now();
  await page.reload();
  await settled(started);
  let data = await stored();
  summary.firstRead = { error: data.attendanceStatus?.error || "", subjects: data.attendanceSnapshot?.subjects?.length || 0, history: Object.keys(data.attendanceHistory?.subjects || {}).length };
  // CUIMS's manual gap is 30 s; the second read fills the rest.
  await new Promise((resolve) => setTimeout(resolve, 35_000));
  started = Date.now();
  await page.click("[data-action='refresh']");
  await settled(started);
  data = await stored();
  const history = data.attendanceHistory?.subjects || {};
  const all = Object.values(history).flatMap((entry) => entry.marks);
  const kinds = all.reduce((counts, [, , kind]) => ({ ...counts, [kind]: (counts[kind] || 0) + 1 }), {});
  summary.secondRead = {
    error: data.attendanceStatus?.error || "",
    subjects: data.attendanceSnapshot?.subjects?.length || 0,
    historySubjects: Object.keys(history).length,
    marks: all.length,
    kinds,
    withTiming: all.filter(([, start]) => start >= 0).length,
    firstDay: all.map(([day]) => day).sort()[0] || null,
    lastDay: all.map(([day]) => day).sort().at(-1) || null,
    timetableSlots: data.attendanceSnapshot?.slots?.length || 0,
    // Marks against the official counts, per subject: present vs attended.
    alignment: (data.attendanceSnapshot?.subjects || []).map((subject) => {
      const entry = history[subject.code.toUpperCase().replace(/[^A-Z0-9]/g, "")];
      if (!entry) return null;
      const counted = entry.marks.filter(([, , kind]) => kind === "p" || kind === "a");
      return { delivered: subject.delivered, counted: counted.length, attended: subject.attended, present: counted.filter(([, , kind]) => kind === "p").length };
    }),
  };
  await page.waitForSelector("#view-forecast .fc-hero", { timeout: 10_000 });
  summary.view = await page.evaluate(() => ({
    hero: document.querySelector(".fc-big")?.textContent.trim(),
    verdict: document.querySelector(".fc-verdict strong")?.textContent.trim(),
    end: document.querySelector(".fc-end-date span")?.textContent.trim(),
    estimated: Boolean(document.querySelector(".fc-end-tag")),
    pastPoints: document.querySelector(".fc-hero .fc-past")?.getAttribute("d")?.split("L").length || 0,
    planDays: document.querySelectorAll("[data-plan-day]").length,
    habits: Boolean(document.querySelector(".fc-cols")),
    bad: /NaN|undefined|Infinity/.test(document.querySelector("#view-forecast").innerHTML),
  }));
  summary.pageErrors = errors;
  await page.screenshot({ path: path.join(output, "live-forecast.png") });
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
console.log(JSON.stringify(summary, null, 2));
