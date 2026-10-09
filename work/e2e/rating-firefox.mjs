// Firefox excludes extension pages from BiDi. Run assertions inside a
// disposable copy of the actual popup, reporting only to a local HTTP server.
// No test code, permissions or state is included in the released package.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

const temp = mkdtempSync(path.join(tmpdir(), "cc-rating-firefox-"));
const extensionDir = path.join(temp, "extension");
cpSync(path.resolve(process.argv[2]), extensionDir, { recursive: true });
let finish;
const result = new Promise((resolve) => { finish = resolve; });
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    finish(JSON.parse(body));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/report`;
const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*", "<all_urls>");
manifest.permissions.push("tabs");
manifest.background.scripts.push("rating-open-test.js");
writeFileSync(path.join(extensionDir, "manifest.json"), JSON.stringify(manifest));
writeFileSync(path.join(extensionDir, "rating-open-test.js"), `
let ratingOpened = false;
async function openRatingTest() {
  if (ratingOpened) return;
  ratingOpened = true;
  try {
    await browser.storage.local.set({popupView:"login"});
    await browser.tabs.create({url:browser.runtime.getURL("popup.html")});
  } catch(error) { fetch(${JSON.stringify(endpoint)}, {method:"POST", body:JSON.stringify({error:String(error)})}); }
}
browser.runtime.onInstalled.addListener(openRatingTest);
openRatingTest();
`);
const html = readFileSync(path.join(extensionDir, "popup.html"), "utf8");
writeFileSync(path.join(extensionDir, "popup.html"), html.replace("</body>", '<script src="rating-popup-test.js"></script></body>'));
const driver = async (endpoint) => {
  const checks = [];
  const errors = [];
  const screenshots = {};
  window.addEventListener("error", (event) => errors.push(event.message));
  const wait = async (predicate, timeout = 12000) => {
    const end = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > end) throw new Error("Timed out: " + predicate);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const nudge = () => document.querySelector("#rate-nudge");
  const click = (selector) => document.querySelector(selector).click();
  const snapshot = {fetchedAt:new Date().toISOString(),subjects:[{code:"24CST-302",title:"Computer Networks",attended:36,delivered:40,marks:[]}],slots:[]};
  try {
    await wait(() => rateReady);
    check(document.querySelector("#version").textContent === `v${chrome.runtime.getManifest().version}`, "popup version from the manifest");
    check(document.querySelector(".rate-line a").href === "https://addons.mozilla.org/firefox/addon/cuims-clear/", "Firefox store link");
    await browser.storage.local.set({attendanceSnapshot:snapshot,attendanceStatus:null});
    await wait(() => attendance.snapshot?.subjects?.length && !attendance.status);
    click("#tab-settings");
    check(!rateState?.topDay, "Settings preserves daily banner");
    click("#tab-attendance");
    await wait(() => !nudge().hidden && nudge().classList.contains("is-top"));
    check(!nudge().hidden, "healthy Attendance shows top ask");
    document.querySelector("#tab-attendance").focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    screenshots.top = await browser.tabs.captureVisibleTab({format:"png"});
    document.querySelector(".rate-ask a").focus();
    await wait(() => nudge().classList.contains("is-paused"));
    await new Promise((resolve) => setTimeout(resolve, 8300));
    check(nudge().classList.contains("is-top"), "top timer pauses on keyboard focus");
    document.activeElement.blur();
    await wait(() => !nudge().classList.contains("is-top"));
    check(!nudge().hidden, "eight-second timer settles into bottom strip");
    screenshots.bottom = await browser.tabs.captureVisibleTab({format:"png"});
    const link = document.querySelector(".rate-ask a");
    link.addEventListener("click", (event) => event.preventDefault());
    click(".rate-ask a");
    await wait(() => !document.querySelector(".rate-confirm").hidden);
    check(rateState.opened, "Rate asks for confirmation");
    screenshots.confirm = await browser.tabs.captureVisibleTab({format:"png"});
    click('[data-rate="not-yet"]');
    check(!document.querySelector(".rate-ask").hidden, "Not yet restores ask");
    click('[data-rate="rated"]');
    check(nudge().hidden && rateState.done, "Already rated ends asks permanently");
    rateState = {topDay:todayKey()};
    updateRate(); paintRate();
    click('[data-rate="snooze"]');
    check(nudge().hidden && rateState.snoozeUntil > Date.now()+2.9*86400000, "dismiss snoozes three days");
    rateState = {topDay:todayKey(),snoozes:2};
    updateRate(); paintRate();
    click('[data-rate="snooze"]');
    check(rateState.done, "third dismissal ends asks");
    rateState = null;
    await browser.storage.local.set({attendanceSnapshot:null,attendanceStatus:{working:true,at:Date.now()}});
    await wait(() => nudge().hidden);
    await browser.storage.local.set({attendanceSnapshot:snapshot,attendanceStatus:null});
    await wait(() => !nudge().hidden);
    check(!nudge().hidden, "first healthy read appears without reopening");
    await browser.storage.local.set({attendanceStatus:{error:"Test refusal",code:"portal-busy"}});
    await wait(() => nudge().hidden);
    check(nudge().hidden, "failed reads hide ask");
    await browser.storage.local.set({attendanceSnapshot:null,attendanceStatus:null});
    await wait(() => nudge().hidden);
    check(nudge().hidden, "empty attendance hides ask");
    await fetch(endpoint, {method:"POST",body:JSON.stringify({checks,errors,screenshots})});
  } catch(error) {
    await fetch(endpoint, {method:"POST",body:JSON.stringify({checks,errors,error:String(error)})});
  }
};
writeFileSync(path.join(extensionDir, "rating-popup-test.js"), `(${driver.toString()})(${JSON.stringify(endpoint)});`);
const browser = await launchBrowser("firefox", {profileDir:path.join(temp,"profile")});
let timer;
try {
  await browser.installExtension(extensionDir);
  const report = await Promise.race([result, new Promise((_, reject) => {timer=setTimeout(()=>reject(new Error("Firefox popup did not report")),45000);})]);
  report.browser = await browser.version();
  assert.equal(report.error, undefined, JSON.stringify(report));
  assert.deepEqual(report.errors, []);
  mkdirSync("work/e2e/results", {recursive:true});
  for (const [name, data] of Object.entries(report.screenshots || {})) {
    writeFileSync(`work/e2e/results/firefox-rating-${name}.png`, Buffer.from(data.split(",")[1], "base64"));
  }
  delete report.screenshots;
  writeFileSync("work/e2e/results/firefox-rating.json", JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  clearTimeout(timer);
  await browser.close();
  server.close();
  rmSync(temp,{recursive:true,force:true});
}
