// 0.10.5's request flow against live CUIMS, in a disposable Chrome profile
// signed in with .env's test login:
//   1. open the popup: the first read signs in (attendance page, landing,
//      attendance page, first timetable, six seconds apart)
//   2. sign the profile out (clear its cookies), then, five minutes after the
//      last page, Refresh: duty leave meets the login page, the read signs in
//      once and reads it in the fresh session
//   3. Open CUIMS: StudentHome in that session, no login form
//   4. the tab goes to students.cuchd.in/: straight to StudentHome
// Pages never closer than six seconds; the first refusal stops everything.
// Prints the extension's own request log (paths,
// statuses, results) and counts only: no names, marks or credentials.
//   ENV_FILE=../.env node work/e2e/live-0105.mjs outputs/cuims-clear-chrome
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

process.loadEnvFile(path.resolve(process.env.ENV_FILE || ".env"));
assert.ok(process.env.CUIMS_UID && process.env.CUIMS_PASSWORD, "CUIMS_UID and CUIMS_PASSWORD in .env");
const pkg = path.resolve(process.argv[2] || "outputs/cuims-clear-chrome");
const temp = mkdtempSync(path.join(tmpdir(), "cc-live-0105-"));
const profileDir = path.join(temp, "profile");
mkdirSync(profileDir);
const output = path.resolve("work/e2e/results/live-0105");
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

  // 2. Signed out (cookies cleared), five minutes after the last page.
  const cdp = await popup.createCDPSession();
  await cdp.send("Network.clearBrowserCookies");
  const lastPage = Number((await stored(["attendancePageAt"])).attendancePageAt || Date.now());
  const until = lastPage + 5 * 60_000 + 5_000;
  console.log(`signed out; waiting ${Math.round((until - Date.now()) / 1000)} s for five minutes after the last page…`);
  await wait(Math.max(0, until - Date.now()));
  // In real use a session ends hours after its sign-in; here it is five
  // minutes. Stand in for those hours on the sign-in clocks only (the page
  // clocks and budgets stay as they are).
  await popup.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ bgSignInOkAt: 0, bgSignIns: [] }, resolve)));
  started = Date.now();
  await popup.click("#fetch-attendance");
  await settled(started);
  data = await stored(["attendanceLeaves", "attendanceStatus", "sessionAlive", "loginGuard"]);
  entries = await newEntries();
  step("refresh while signed out", { error: data.attendanceStatus?.code || "", dutyRead: Boolean(data.attendanceLeaves?.dlAt), medicalRead: Boolean(data.attendanceLeaves?.mlAt), sessionAlive: data.sessionAlive, failures: data.loginGuard?.failures?.length || 0, pages: pageEntries(entries), requests: entries });
  if (refused(entries)) throw new Error("stop: refusal on the leave read");

  // 3. Open CUIMS right after.
  const before = Date.now();
  const opened = await popup.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "cuims-clear:open-cuims", tabId: 0 }, resolve)));
  const target = await browser.waitForTarget((t) => t.url().startsWith("https://students.cuchd.in"), { timeout: 20_000 });
  const tab = await target.page();
  await tab.waitForFunction(() => document.readyState === "complete", { timeout: 30_000 }).catch(() => {});
  await wait(2_000);
  // The tab may still be moving (a sign-in's redirects): wait and ask again.
  const tabState = async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await tab.waitForFunction(() => document.readyState === "complete", { timeout: 15_000 }).catch(() => {});
        return await tab.evaluate(() => ({ path: location.pathname, menuLinks: document.querySelectorAll("#menu-content a").length, loginForm: Boolean(document.querySelector("#txtUserId, #txtLoginPassword")) }));
      } catch (error) {
        if (attempt >= 4) return { error: String(error.message).slice(0, 80) };
        await wait(2_000);
      }
    }
  };
  entries = await newEntries();
  step("open CUIMS", { reply: opened, tab: await tabState(), requests: entries, tookMs: Date.now() - before });
  if (refused(entries)) throw new Error("stop: refusal on open");

  // 4. The tab goes to the root, as typing students.cuchd.in does.
  await wait(10_000);
  await tab.goto("https://students.cuchd.in/", { waitUntil: "load", timeout: 45_000 });
  await tab.waitForFunction(() => location.pathname.toLowerCase() === "/studenthome.aspx", { timeout: 20_000 }).catch(() => {});
  await wait(2_000);
  entries = await newEntries();
  step("tab: students.cuchd.in/", { tab: await tabState(), requests: entries });

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
