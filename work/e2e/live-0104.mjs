// One ordinary session of the packaged Chrome build against live CUIMS, in a
// disposable profile signed in with .env's test login:
//   1. open the popup: the first read signs in, loads the attendance page and
//      the first timetable (six seconds apart), then the report calls
//   2. Refresh 35 s later: report calls only
//   3. Open CUIMS: a tab in the same session, no request of the extension's
//   4. in that tab, My Time Table, then Duty Leave, each ten seconds apart:
//      both handed to the extension with no request of its own
//   5. five minutes after the tab's last page, a Refresh: medical leave is
//      the one optional page left
//   6. Open LMS
// Pages are never closer than eight seconds; no bursts, no deliberate
// failures. The first refusal (an empty CUIMS menu or error.html) stops
// everything after it. Prints the extension's own request log (paths,
// statuses, results) and counts only: no names, marks or credentials.
//   ENV_FILE=../.env node work/e2e/live-0104.mjs outputs/cuims-clear-chrome
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

process.loadEnvFile(path.resolve(process.env.ENV_FILE || ".env"));
assert.ok(process.env.CUIMS_UID && process.env.CUIMS_PASSWORD, "CUIMS_UID and CUIMS_PASSWORD in .env");
const pkg = path.resolve(process.argv[2] || "outputs/cuims-clear-chrome");
const temp = mkdtempSync(path.join(tmpdir(), "cc-live-0104-"));
const profileDir = path.join(temp, "profile");
mkdirSync(profileDir);
const output = path.resolve("work/e2e/results/live-0104");
mkdirSync(output, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t0 = Date.now();
const since = (at) => `${((Number(at) - t0) / 1000).toFixed(1)}s`;
const report = { steps: [] };
const step = (name, data) => {
  report.steps.push({ step: name, at: since(Date.now()), ...data });
  console.log(`[${since(Date.now())}] ${name}`, JSON.stringify(data));
};

const browser = await launchBrowser("chrome", { profileDir });
let stopped = "";
try {
  const id = await browser.installExtension(pkg);
  const popup = await browser.newPage();
  await popup.setViewport({ width: 440, height: 600, deviceScaleFactor: 2 });
  const errors = [];
  popup.on("pageerror", (error) => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate((uid, password) => new Promise((resolve) => chrome.storage.local.set({ uid, password, popupView: "attendance", rateNudge: { done: true } }, resolve)), process.env.CUIMS_UID, process.env.CUIMS_PASSWORD);
  const stored = (keys) => popup.evaluate((keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)), keys);
  const settled = (after) =>
    popup.waitForFunction(
      (after) => new Promise((resolve) => chrome.storage.local.get(["attendanceStatus", "attendanceLastAttemptAt"], (data) => resolve(Number(data.attendanceLastAttemptAt || 0) >= after && !data.attendanceStatus?.working))),
      { timeout: 150_000, polling: 500 },
      after,
    );
  const journal = async () => (await stored(["cuimsJournal"])).cuimsJournal || [];
  let seen = 0;
  const newEntries = async () => {
    const log = await journal();
    const fresh = log.slice(seen);
    seen = log.length;
    return fresh.map((entry) => ({ at: since(entry.at), by: entry.by, path: entry.path, ...(entry.to ? { to: entry.to } : {}), ...(entry.status != null ? { status: entry.status } : {}), result: entry.result }));
  };
  const refused = (entries) => entries.some((entry) => ["empty-menu", "page-limit", "error-page"].includes(entry.result));
  const pageEntries = (entries) => entries.filter((entry) => !/\/Get(Full)?Report$/.test(entry.path));

  // 1. The first read, as opening the popup starts it.
  let started = Date.now();
  await popup.reload();
  await settled(started);
  let data = await stored(["attendanceSnapshot", "attendanceStatus", "attendanceTimetable", "attendanceHistory", "sessionAlive"]);
  let entries = await newEntries();
  step("first read", {
    error: data.attendanceStatus?.code || "",
    subjects: data.attendanceSnapshot?.subjects?.length || 0,
    slots: data.attendanceTimetable?.slots?.length || 0,
    history: Object.keys(data.attendanceHistory?.subjects || {}).length,
    sessionAlive: data.sessionAlive,
    requests: entries,
  });
  await popup.screenshot({ path: path.join(output, "1-attendance.png") });
  if (refused(entries) || data.attendanceStatus?.code) throw new Error("stop: first read refused or failed");

  // 2. Refresh, 35 s on: report calls only.
  await wait(35_000);
  started = Date.now();
  await popup.click("#fetch-attendance, [data-action='refresh']");
  await settled(started);
  entries = await newEntries();
  step("refresh", { pages: pageEntries(entries).length, requests: entries });
  if (refused(entries)) throw new Error("stop: refusal on refresh");

  // 3. Open CUIMS, as the popup's button asks for it.
  await wait(10_000);
  const before = Date.now();
  const opened = await popup.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "cuims-clear:open-cuims", tabId: 0 }, resolve)));
  const target = await browser.waitForTarget((t) => t.url().startsWith("https://students.cuchd.in"), { timeout: 20_000 });
  const tab = await target.page();
  await tab.waitForFunction(() => document.readyState === "complete", { timeout: 30_000 }).catch(() => {});
  await wait(2_000);
  const tabState = async () => tab.evaluate(() => ({ path: location.pathname, menuLinks: document.querySelectorAll("#menu-content a").length, loginForm: Boolean(document.querySelector("#txtUserId, #txtLoginPassword")) }));
  entries = await newEntries();
  step("open CUIMS", { reply: opened, tab: await tabState(), requests: entries, tookMs: Date.now() - before });
  if (refused(entries)) throw new Error("stop: refusal on open");

  // 4. Browse in that tab: My Time Table, then Duty Leave.
  await wait(10_000);
  const timetableBefore = (await stored(["attendanceTimetable"])).attendanceTimetable?.savedAt || 0;
  await tab.goto("https://students.cuchd.in/frmMyTimeTable.aspx", { waitUntil: "load", timeout: 45_000 });
  await wait(6_000);
  data = await stored(["attendanceTimetable"]);
  entries = await newEntries();
  step("tab: My Time Table", { tab: await tabState(), handedOver: Number(data.attendanceTimetable?.savedAt || 0) > timetableBefore, slots: data.attendanceTimetable?.slots?.length || 0, requests: entries });
  if (refused(entries)) throw new Error("stop: refusal in tab");
  await wait(10_000);
  const leaveBefore = (await stored(["attendanceLeaves"])).attendanceLeaves?.dlAt || 0;
  await tab.goto("https://students.cuchd.in/frmStudentApplyDutyLeave.aspx", { waitUntil: "load", timeout: 45_000 });
  await wait(4_000);
  data = await stored(["attendanceLeaves", "tabPageAt"]);
  entries = await newEntries();
  const lastTabPage = Number(data.tabPageAt || Date.now());
  step("tab: Duty Leave", { tab: await tabState(), handedOver: Number(data.attendanceLeaves?.dlAt || 0) > leaveBefore, applications: data.attendanceLeaves?.apps?.dl?.length ?? null, requests: entries });
  if (refused(entries)) throw new Error("stop: refusal in tab");

  // 5. A read five minutes after the tab's last page: medical leave is due.
  const until = lastTabPage + 5 * 60_000 + 5_000;
  console.log(`waiting ${Math.round((until - Date.now()) / 1000)} s for the five-minute gap after the tab's last page…`);
  await wait(Math.max(0, until - Date.now()));
  await popup.bringToFront();
  started = Date.now();
  await popup.click("#fetch-attendance, [data-action='refresh']");
  await settled(started);
  data = await stored(["attendanceLeaves", "attendanceStatus"]);
  entries = await newEntries();
  step("refresh after five minutes", { error: data.attendanceStatus?.code || "", medicalRead: Boolean(data.attendanceLeaves?.mlAt), pages: pageEntries(entries), requests: entries.length });
  if (refused(entries)) throw new Error("stop: refusal on optional page");

  // 6. Open LMS.
  await wait(10_000);
  const lms = await popup.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "cuims-clear:launch-lms", tabId: 0 }, resolve)));
  const lmsTarget = await browser.waitForTarget((t) => /^https:\/\/lms\.cuchd\.in/.test(t.url()), { timeout: 45_000 }).catch(() => null);
  await wait(3_000);
  entries = await newEntries();
  step("open LMS", { reply: lms, lmsTab: lmsTarget ? new URL(lmsTarget.url()).pathname : null, requests: entries });

  await popup.click("#tab-forecast").catch(() => {});
  await wait(1_000);
  await popup.screenshot({ path: path.join(output, "2-forecast.png") });
  report.popupErrors = errors;
} catch (error) {
  stopped = error.message;
  console.log(stopped);
} finally {
  report.stopped = stopped;
  writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 1));
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
