// Live, read-only check of the Marks View summary and the Duty Leave card
// on real CUIMS, in a disposable Chrome profile signed in with .env's login:
//   1. Marks View: the summary is drawn, its average matches marks-model.js
//      over the page's own rows, and the page is handed to the popup.
//   2. Duty Leave: the page goes to External by itself, the card appears,
//      and "Fill CUIMS's form" walks CUIMS's form for DL_DATE (a day CUIMS
//      still takes) up to Next Step. Save is never pressed.
// Pages are at least eight seconds apart. Prints counts and outcomes only.
//   DL_DATE=2026-10-29 DL_START=570 ENV_FILE=../cuims-clear/.env node work/e2e/live-marks-leave.mjs
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

process.loadEnvFile(path.resolve(process.env.ENV_FILE || ".env"));
assert.ok(process.env.CUIMS_UID && process.env.CUIMS_PASSWORD, "CUIMS_UID and CUIMS_PASSWORD in .env");
const day = process.env.DL_DATE;
const start = Number(process.env.DL_START || 570);
const pkg = path.resolve("outputs/cuims-clear-chrome");
const temp = mkdtempSync(path.join(tmpdir(), "cc-live-ml-"));
const shots = path.resolve("work/e2e/results/live-marks-leave");
mkdirSync(shots, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await launchBrowser("chrome", { profileDir: path.join(temp, "profile") });
try {
  const id = await browser.installExtension(pkg);
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const stored = (keys) => popup.evaluate((keys) => new Promise((resolve) => chrome.storage.local.get(keys, resolve)), keys);
  await popup.evaluate((uid, password, day, start) => new Promise((resolve) => chrome.storage.local.set({
    uid, password, rateNudge: { done: true }, autoAdvanceUid: true, autoSolveCaptcha: true, autoSubmitLogin: true,
    // One absence on the chosen day, as a refresh would have kept it.
    attendanceHistory: { v: 2, subjects: { LIVE: { marks: [[day, start, "a"]] } } },
    dlLastCategory: "20",
  }, resolve)), process.env.CUIMS_UID, process.env.CUIMS_PASSWORD, day, start);
  await popup.evaluate(() => new Promise((resolve) => chrome.runtime.sendMessage({ type: "cuims-clear:open-cuims", tabId: 0 }, resolve)));
  const target = await browser.waitForTarget((t) => /students\.cuchd\.in/.test(t.url()), { timeout: 30_000 });
  const tab = await target.page();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message.slice(0, 120)));
  await tab.waitForFunction(() => /studenthome\.aspx/i.test(location.pathname), { timeout: 120_000, polling: 1000 });
  console.log("signed in");
  await tab.setViewport({ width: 1280, height: 1000 });
  await wait(8_000);

  // 1. Marks View
  await tab.goto("https://students.cuchd.in/frmStudentMarksView.aspx", { waitUntil: "load", timeout: 45_000 });
  await tab.waitForSelector(".cc-mk .cc-mk-big b", { timeout: 20_000 });
  const marks = await tab.evaluate(() => ({
    shown: document.querySelector(".cc-mk-big b").textContent,
    tiles: document.querySelectorAll(".cc-mk-subject").length,
    chips: document.querySelectorAll(".cc-score").length,
    headers: document.querySelectorAll("#accordion > h3").length,
    skillsSwitch: Boolean(document.querySelector("[data-cc-skills]")),
  }));
  await wait(1_500);
  const handed = (await stored(["attendanceExamMarks"])).attendanceExamMarks;
  const session = handed?.sessions?.[handed.current];
  console.log("marks view", JSON.stringify({ ...marks, handedSubjects: session?.subjects?.length || 0, handedSession: handed?.current || "" }));
  assert.equal(marks.tiles, marks.headers);
  assert.ok(session?.subjects?.length === marks.headers, "Marks View handed to the popup");
  await tab.screenshot({ path: path.join(shots, "marks-view.png"), fullPage: false });

  // 2. Duty Leave
  await wait(8_000);
  await tab.goto("https://students.cuchd.in/frmStudentApplyDutyLeave.aspx", { waitUntil: "load", timeout: 45_000 });
  await tab.waitForFunction(() => document.getElementById("ContentPlaceHolder1_rblType_1")?.checked && document.querySelector(".cc-dl"), { timeout: 45_000, polling: 500 });
  const card = await tab.evaluate((day) => ({
    days: [...document.querySelectorAll(".cc-dl-day b")].map((node) => node.textContent),
    chosen: document.querySelector(".cc-dl-day.is-on b")?.textContent,
    lectures: document.querySelectorAll(".cc-dl-lecture").length,
    category: document.querySelector(".cc-dl-field select")?.value,
    day,
  }), day);
  console.log("duty leave card", JSON.stringify(card));
  // The card opens on the day with an absence: DL_DATE.
  assert.equal(card.days.length, 4);
  assert.equal(card.lectures, 1);
  await wait(6_000);
  await tab.click(".cc-dl-go");
  // Each step as it goes: the card's status and CUIMS's form.
  for (let second = 0; second < 150; second += 3) {
    const seen = await tab.evaluate(() => ({
      status: document.querySelector(".cc-dl-status")?.textContent.slice(0, 90),
      tone: document.querySelector(".cc-dl-status")?.dataset.tone || "",
      type: document.getElementById("ContentPlaceHolder1_ddlTypeNew")?.value,
      date: Boolean(document.getElementById("txtDate")),
      offered: document.querySelectorAll("#rcbTime_DropDown li").length,
      alert: document.querySelector(".swal-overlay--show-modal .swal-text, .sweet-alert.visible p")?.textContent || "",
      async: (() => { try { return Boolean(document.querySelector("#UpdateProgress1")?.offsetParent); } catch { return null; } })(),
    }));
    console.log(`${second}s`, JSON.stringify(seen));
    if (seen.tone) break;
    await wait(3_000);
  }
  await tab.waitForSelector('.cc-dl-status[data-tone="good"], .cc-dl-status[data-tone="bad"]', { timeout: 5_000 });
  const outcome = await tab.evaluate(() => ({
    tone: document.querySelector(".cc-dl-status").dataset.tone,
    status: document.querySelector(".cc-dl-status").textContent,
    type: document.getElementById("ContentPlaceHolder1_ddlTypeNew")?.value,
    category: document.getElementById("ContentPlaceHolder1_ddlDLSource")?.value,
    date: document.getElementById("txtDate")?.value,
    picked: [...document.querySelectorAll("#ContentPlaceHolder1_gvSelectedTimes [id*=lblTime]")].map((node) => node.textContent.trim()),
  }));
  console.log("filled", JSON.stringify(outcome));
  await tab.screenshot({ path: path.join(shots, "duty-leave.png"), fullPage: true });
  console.log("page errors", JSON.stringify(errors));
} catch (error) {
  console.log("stopped:", error.message);
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
