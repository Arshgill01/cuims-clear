// Offline packaged Chrome smoke: real worker, runtime messages and popup.
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SUMMARY, dutyLeavePage } from "../../tests/fake-cuims.mjs";

const results = new URL("./results/conservative/", import.meta.url);
mkdirSync(results, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, pipe: true, enableExtensions: true,
});
try {
  const id = await browser.installExtension(path.resolve("outputs/cuims-clear-chrome"));
  const base = `chrome-extension://${id}`;
  const target = await browser.waitForTarget((item) => item.type() === "service_worker" && item.url().startsWith(base));
  const worker = await target.worker();
  await worker.evaluate(async () => {
    globalThis.__conservativeFetches = 0;
    globalThis.fetch = async () => {
      globalThis.__conservativeFetches += 1;
      return new Response("Too many requests", { status: 429, headers: { "retry-after": "600" } });
    };
    await chrome.storage.local.set({
      uid: "fixture", password: "fixture", popupView: "attendance",
      attendanceLastAttemptAt: Date.now() - 59_000,
      attendanceSnapshot: { fetchedAt: new Date().toISOString(), subjects: [{ code: "TEST", title: "Test subject", attended: 9, delivered: 10 }] },
    });
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width: 440, height: 600 });
  await page.goto(`${base}/popup.html`);
  await page.waitForSelector("#fetch-attendance[disabled]");
  assert.match(await page.$eval("#fetch-attendance", (node) => node.textContent), /Refresh in 1 min/);
  await page.waitForFunction(() => !document.querySelector("#fetch-attendance")?.disabled, { timeout: 3000 });
  assert.equal(await worker.evaluate(() => globalThis.__conservativeFetches), 0, "the UI timer never fetches");
  await page.click("#fetch-attendance");
  await page.waitForFunction(() => document.querySelector(".attendance-info")?.textContent.includes("10 min"));
  assert.equal(await worker.evaluate(() => globalThis.__conservativeFetches), 1);
  assert.match(await page.$eval("#view-attendance", (node) => node.textContent), /Test subject/);
  assert.match(await page.$eval("#fetch-attendance", (node) => node.textContent), /Refresh in 10 min/);
  await page.screenshot({ path: new URL("cooldown.png", results).pathname });
  await page.click(".lms-open-link");
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("10 min"));
  assert.equal(await worker.evaluate(() => globalThis.__conservativeFetches), 1, "LMS obeys the same pause");
  assert.equal((await browser.pages()).filter((item) => item.url().startsWith("https://students.cuchd.in")).length, 0, "no CUIMS fallback tab during throttle");
  await worker.evaluate(() => chrome.storage.local.set({ attendanceLastAttemptAt: Date.now() - 60_000, attendanceBackoffUntil: Date.now() - 1 }));
  await page.waitForFunction(() => !document.querySelector("#fetch-attendance")?.disabled && document.querySelector(".attendance-info")?.textContent.includes("You can refresh now"));
  assert.equal(await worker.evaluate(() => globalThis.__conservativeFetches), 1, "cooldown expiry never fetches automatically");
  // Fetch pending duty leave through the packaged popup, then approve it.
  await worker.evaluate(async ({ summary, pending, approved }) => {
    globalThis.__dutyApproved = false;
    globalThis.__dutyReads = 0;
    globalThis.fetch = async (target, options = {}) => {
      const url = new URL(target);
      if (url.pathname.endsWith("/GetReport")) return new Response(JSON.stringify({ d: JSON.stringify(summary) }));
      if (url.pathname.endsWith("/GetFullReport")) {
        const rows = String(options.body).includes("enc305") ? [{ AttDate: "Friday, 25 Sep 2026", Timing: "2:30 - 3:20 PM", AttendanceCode: "A" }] : [];
        return new Response(JSON.stringify({ d: { Result: rows.length ? JSON.stringify(rows) : "No Data Found" } }));
      }
      if (url.pathname === "/frmStudentApplyDutyLeave.aspx") {
        globalThis.__dutyReads += 1;
        return new Response(globalThis.__dutyApproved ? approved : pending);
      }
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    };
    await chrome.storage.local.set({
      attendanceLastAttemptAt: Date.now() - 60_000, attendanceBackoffUntil: 0, attendanceFailStreak: 0, attendanceRequests: [],
      attendanceMeta: { reportId: "fixture", sessionId: "fixture" },
      attendanceTimetable: { day: CuimsAttendance.campusParts(new Date()).key, slots: [], triedAt: Date.now() },
      attendanceLeaves: { v: CuimsAttendance.LEAVES_VERSION, mlAt: Date.now() },
    });
  }, {
    summary: SUMMARY,
    pending: dutyLeavePage([{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Pending" }]),
    approved: dutyLeavePage([{ id: 11, timing: "2:30 - 3:20 PM", dated: "25 Sep 2026", status: "Recommend and Approved" }]),
  });
  await page.waitForFunction(() => !document.querySelector("#fetch-attendance")?.disabled);
  await page.click("#fetch-attendance");
  await page.waitForFunction(() => document.querySelector(".leave-pending")?.textContent.includes("1 duty leave pending"));
  assert.equal(await worker.evaluate(() => globalThis.__dutyReads), 1);
  assert.equal((await browser.pages()).filter((item) => item.url().startsWith("https://students.cuchd.in")).length, 0);
  await page.waitForFunction(() => !document.querySelector("#status")?.textContent);
  await page.screenshot({ path: new URL("duty-leave.png", results).pathname });
  await worker.evaluate(async () => {
    globalThis.__dutyApproved = true;
    await chrome.storage.local.set({ attendanceLastAttemptAt: Date.now() - 60_000 });
  });
  await page.waitForFunction(() => !document.querySelector("#fetch-attendance")?.disabled);
  await page.click("#fetch-attendance");
  await page.waitForFunction(() => document.querySelector(".leave-pending")?.textContent.includes("No pending leave"));
  assert.equal(await worker.evaluate(() => globalThis.__dutyReads), 2);
  assert.deepEqual(errors, []);
  const report = { refreshReenabledWithoutNetwork: true, cachedAttendanceKept: true, retryAfterMinutes: 10, lmsRequestsDuringPause: 0, dutyLeaveFetchedWithoutPortalTab: true, dutyApprovalUpdatedOnRefresh: true, errors };
  writeFileSync(new URL("smoke.json", results), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
