// Screenshots 0.10.5's Attendance, Forecast and Settings from a stored
// snapshot (no CUIMS requests: the snapshot is stamped as just read).
//   node work/e2e/shot-0105.mjs <package dir> <snapshot.json> <history.json> <exams.json> <out dir>
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

const [pkg, snapFile, histFile, examsFile, out] = process.argv.slice(2);
const temp = mkdtempSync(path.join(tmpdir(), "cc-shot-0105-"));
mkdirSync(path.join(temp, "profile"));
mkdirSync(out, { recursive: true });
const snapshot = { ...JSON.parse(readFileSync(snapFile, "utf8")), fetchedAt: new Date().toISOString(), exams: JSON.parse(readFileSync(examsFile, "utf8")) };
const history = JSON.parse(readFileSync(histFile, "utf8"));
const browser = await launchBrowser("chrome", { profileDir: path.join(temp, "profile") });
try {
  const id = await browser.installExtension(path.resolve(pkg));
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => (/cuchd\.in/.test(request.url()) ? request.abort() : request.continue()));
  await page.setViewport({ width: 420, height: 1100, deviceScaleFactor: 2 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.evaluate((snapshot, history) => new Promise((resolve) => chrome.storage.local.set({
    uid: "24BCS00000", password: "x", attendanceSnapshot: snapshot, attendanceHistory: history,
    attendanceLastAttemptAt: Date.now(), popupView: "attendance", rateNudge: { done: true },
  }, resolve)), snapshot, history);
  await page.reload();
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(out, "attendance.png") });
  await page.click("#tab-forecast");
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(out, "forecast.png") });
  await page.click("#tab-settings");
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => document.querySelector("#academic-calendar").scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(out, "settings.png") });
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
