// Actual extension in a real browser, with every portal request intercepted.
// No account, cookies from a real account, or live CUIMS requests are used.
// node work/e2e/ux-browsers.mjs <chrome|firefox> <packageDir> [--baseline]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

const [name, packageDir, mode] = process.argv.slice(2);
const baseline = mode === "--baseline";
const temp = mkdtempSync(path.join(tmpdir(), "cc-ux-test-"));
const extensionDir = path.join(temp, "extension");
cpSync(path.resolve(packageDir), extensionDir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
for (const script of manifest.content_scripts) {
  if (!script.world || script.world === "ISOLATED") script.js = ["test-control.js", ...script.js];
}
writeFileSync(path.join(extensionDir, "manifest.json"), JSON.stringify(manifest));
// This test bridge/telemetry is only in the disposable copy. Never packaged.
writeFileSync(path.join(extensionDir, "test-control.js"), `
if (!globalThis.__ccTest) {
  globalThis.__ccTest = { reads: 0, scans: 0, scanMs: 0, paintMs: [] };
  const original = getComputedStyle;
  globalThis.getComputedStyle = (...args) => { __ccTest.reads += 1; return original(...args); };
  document.addEventListener("cc-test-command", (event) => {
    const command = JSON.parse(event.detail);
    const finish = () => {
      if (command.reset) { __ccTest.reads = 0; __ccTest.scans = 0; __ccTest.scanMs = 0; __ccTest.paintMs = []; }
      if (command.repaint) CuimsPageTheme.repaint([document.querySelector(command.repaint)]);
      document.documentElement.setAttribute("data-cc-test-reply", JSON.stringify({ id: command.id, ...__ccTest, retained: globalThis.CuimsPageTheme?.metrics?.() }));
    };
    if (command.settings) chrome.storage.local.set(command.settings, finish); else finish();
  });
}
`);
const contentFile = path.join(extensionDir, "content.js");
let content = readFileSync(contentFile, "utf8");
content = content.replace('if (location.pathname.toLowerCase().endsWith("/landingpage.aspx")) {', `
const __originalScan = scanPage;
scanPage = function() {
  const start = performance.now();
  try { return __originalScan(); }
  finally { __ccTest.scans += 1; __ccTest.scanMs += performance.now() - start; }
};
if (location.pathname.toLowerCase().endsWith("/landingpage.aspx")) {`);
writeFileSync(contentFile, content);
const themeFile = path.join(extensionDir, "cuims-theme.js");
let theme = readFileSync(themeFile, "utf8");
theme = theme.replace('document.addEventListener("load", onSheetLoad, true);', `
const __originalRepaint = repaint;
repaint = function(roots) {
  const start = performance.now();
  try { return __originalRepaint(roots); }
  finally { __ccTest.paintMs.push(performance.now() - start); }
};
document.addEventListener("load", onSheetLoad, true);`);
theme = theme.replace("globalThis.CuimsPageTheme = {", "globalThis.CuimsPageTheme = { metrics: () => ({ applied: applied.size, eased: eased.size }),");
writeFileSync(themeFile, theme);

const ORIGIN = "https://students.cuchd.in";
const LMS = "https://lms.cuchd.in";
const course = (i, work = false) => `<div class="mc-card" data-name="${work ? "" : "CONT_"}24CST-${300 + i}${work ? "_24BCS_601A_ALL" : ""} :: SUBJECT ${i}" data-url="${LMS}/course/view.php?id=${2 * i + (work ? 2 : 1)}"></div>`;
const coursePage = (from, to, next = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Courses</title></head><body><header id="page-header"></header><div id="region-main">${Array.from({ length: to - from }, (_, i) => course(from + i) + course(from + i, true)).join("")}${next ? '<a href="/my/courses.php?paged=2">Next</a>' : ""}</div></body></html>`;
const portal = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
body { background:#fff;color:#333;font:16px sans-serif } .card{background:#fff;border:1px solid #ddd;padding:8px;margin:2px;transition:background-color .2s,opacity .2s} .inner{background:rgba(10,10,10,.1)}
.modal {position:fixed;inset:50px;background:#fff;padding:24px} .hide{display:none} .dim{position:fixed;inset:0;background:rgba(0,0,0,.5)}
</style></head><body><h1>My Course</h1><p>Announcements</p><button id="open">My queries</button>
<div id="fixture-bulk">${Array.from({ length: 160 }, (_, i) => '<section class="card"><div class="inner"><div><span>Course ' + i + '</span><a href="#">Open</a></div></div></section>').join("")}</div>
<div role="dialog" class="modal show" id="promo">Register now for Techfest 2026</div>
<div class="dim" id="wash"></div><div role="dialog" class="modal hide" id="queries">My Question Or Queries · Give Rating · Ticket 4411<button id="close">Close</button></div>
<div id="feedback-toast"><span id="feedback-copy">Waiting for a portal update</span></div>
<script>document.querySelector('#open').onclick=()=>document.querySelector('#queries').className='modal show';document.querySelector('#close').onclick=()=>document.querySelector('#queries').className='modal hide';</script>
</body></html>`;
const output = path.resolve("work/e2e/results");
mkdirSync(output, { recursive: true });
const browser = await launchBrowser(name, { profileDir: path.join(temp, "profile") });
const errors = [];
let requestCount = 0;
let sequence = 0;
const report = { browser: await browser.version(), baseline, checks: [], requests: {} };
try {
  // Use an existing tab before installing, avoiding a Firefox startup race.
  const page = (await browser.pages())[0] || await browser.newPage();
  await browser.installExtension(extensionDir);
  // installExtension resolves before Firefox has registered every script.
  await new Promise((resolve) => setTimeout(resolve, 500));
  page.on("pageerror", (error) => errors.push({ message: error.message, stack: error.stack }));
  await page.setRequestInterception(true);
  let delayPage2 = false;
  let cancellationCheck = false;
  let holdPage2 = false;
  let page2Started;
  let releasePage2;
  page.on("request", async (req) => {
    const url = new URL(req.url());
    try {
      if (url.origin === LMS && url.pathname === "/my/courses.php") {
        requestCount += 1;
        if (holdPage2 && url.searchParams.get("paged") === "2") {
          holdPage2 = false;
          page2Started();
          await new Promise((resolve) => { releasePage2 = resolve; });
        } else if (delayPage2 && url.searchParams.has("paged")) await new Promise((resolve) => setTimeout(resolve, 400));
        const body = url.searchParams.has("paged") ? coursePage(50, 100) : coursePage(0, 50, true);
        await req.respond({ status: 200, contentType: "text/html", body: cancellationCheck && url.searchParams.get("paged") === "2" ? body.replace("</body>", '<a href="/my/courses.php?paged=3">More</a></body>') : body });
      } else if (url.origin === ORIGIN) {
        await req.respond({ status: 200, contentType: "text/html", body: portal });
      } else await req.respond({ status: 204, body: "" });
    } catch (error) { if (!/no such request|Invalid InterceptionId|interception/i.test(error.message)) errors.push(error.message); }
  });
  async function command(options) {
    const id = ++sequence;
    await page.evaluate((command) => document.dispatchEvent(new CustomEvent("cc-test-command", { detail: JSON.stringify(command) })), { id, ...options });
    await page.waitForFunction((id) => JSON.parse(document.documentElement.getAttribute("data-cc-test-reply") || "{}").id === id, {}, id);
    return page.evaluate(() => JSON.parse(document.documentElement.getAttribute("data-cc-test-reply")));
  }
  async function settle() {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await page.goto(`${LMS}/my/courses.php`);
  await page.waitForFunction(() => document.querySelector(".cc-count")?.textContent === "100 subjects");
  assert.equal(requestCount, 2, "only the document and next page should be requested");
  report.checks.push("paged directory pairs 200 courses into 100 subjects with two requests");
  const search = await page.evaluate(() => {
    const list = document.querySelector(".cc-course-list");
    const input = document.querySelector("#cc-course-search");
    const first = list.querySelector(".cc-course-row");
    let nodesAdded = 0;
    const observer = new MutationObserver(() => {});
    observer.observe(list, { childList: true, subtree: true });
    const started = performance.now();
    for (let i = 0; i < 80; i++) {
      input.value = ["subject", "24cst-320", "no match", ""][i % 4];
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const ms = performance.now() - started;
    for (const record of observer.takeRecords()) nodesAdded += record.addedNodes.length;
    observer.disconnect();
    input.value = "24cst-320";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { ms, nodesAdded, identity: first === list.querySelector(".cc-course-row"), visible: [...list.querySelectorAll(".cc-course-row")].filter((row) => !row.hidden).length };
  });
  assert.equal(search.visible, 1);
  if (!baseline) { assert.equal(search.nodesAdded, 0); assert.equal(search.identity, true); }
  report.search = search;
  report.checks.push("course code search, empty search and keyboard focus");
  await page.focus("#cc-course-search");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains("cc-course-link")), true);
  await page.screenshot({ path: path.join(output, `${name}-${baseline ? "baseline" : "candidate"}-lms.png`), fullPage: false });
  // A page arriving during a search must preserve the typed query and links.
  delayPage2 = true;
  await page.goto(`${LMS}/my/courses.php`);
  await page.waitForSelector("#cc-course-search");
  await page.evaluate(() => {
    window.savedLink = document.querySelector('.cc-course-link');
    const input = document.querySelector('#cc-course-search');
    input.value = '24cst-300'; input.dispatchEvent(new Event('input', { bubbles: true }));
    window.savedLink.focus();
  });
  await page.waitForFunction(() => document.querySelector(".cc-count").textContent === "100 subjects");
  if (!baseline) assert.equal(await page.evaluate(() => window.savedLink === document.activeElement), true);
  assert.equal(await page.$eval("#cc-course-search", (input) => input.value), "24cst-300");
  report.checks.push("pagination preserves current search and focused unchanged link");
  await page.click("#cc-view-toggle");
  assert.equal(await page.$eval("#cc-directory", (directory) => directory.hidden), true);
  await page.click("#cc-view-toggle");
  assert.equal(await page.$eval("#cc-directory", (directory) => directory.hidden), false);
  report.checks.push("Original/Clear toggle retains native markup");
  if (!baseline) {
    cancellationCheck = true;
    holdPage2 = true;
    const pendingPage2 = new Promise((resolve) => { page2Started = resolve; });
    const before = requestCount;
    await page.goto(`${LMS}/my/courses.php`);
    await page.waitForSelector("#cc-course-search");
    await pendingPage2;
    await page.click("#cc-view-toggle");
    releasePage2();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.ok(requestCount - before <= 2, "Original view must stop further pagination requests");
    await page.click("#cc-view-toggle");
    await page.waitForFunction(() => document.querySelector(".cc-count").textContent === "100 subjects" && !document.querySelector(".cc-status").textContent.includes("Loading"));
    cancellationCheck = false;
    report.checks.push("switching to Original cancels pagination; switching back loads remaining courses");
  }

  await page.goto(`${ORIGIN}/StudentHome.aspx`);
  await command({ settings: { theme: "tokyo-night", themeCuims: true, autoAdvanceUid: false, autoSubmitLogin: false } });
  await page.waitForSelector("#cc-cuims-theme");
  await settle();
  assert.equal(await page.$eval("#promo", (node) => getComputedStyle(node).display), "none");
  await page.click("#open");
  await settle();
  assert.notEqual(await page.$eval("#queries", (node) => getComputedStyle(node).display), "none");
  await page.click("#close");
  report.checks.push("quiet mode hides automatic promo but keeps student-opened queries");
  if (!baseline) {
    await page.evaluate(() => { document.querySelector("#feedback-copy").firstChild.nodeValue = "Click here to Fill Now"; });
    await page.waitForFunction(() => document.querySelector("#feedback-toast").dataset.cuimsClearSuppressed === "feedback");
    await page.evaluate(() => { document.querySelector("#feedback-toast").style.display = "block"; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#feedback-toast")).display === "none");
    report.checks.push("changed text discovers feedback in its updated subtree and reopening stays suppressed");
  }
  await settle();
  await command({ reset: true });
  for (let i = 0; i < 5; i++) { await command({ repaint: "#fixture-bulk" }); await settle(); }
  const metrics = await command({});
  report.theme = { reads: metrics.reads, scans: metrics.scans, scanMs: metrics.scanMs, paintMs: metrics.paintMs };
  if (!baseline) assert.equal(metrics.scans, 0, "theme colours must not trigger full-page overlay scans");
  // Native colour meaning and contrast after repaint and a theme switch.
  const colour = await page.$eval("#fixture-bulk .card span", (node) => ({ colour: getComputedStyle(node).color, bg: getComputedStyle(node.closest(".card")).backgroundColor }));
  assert.notEqual(colour.bg, "rgb(255, 255, 255)");
  report.colour = colour;
  async function checkContrast() {
    const result = await page.evaluate(() => {
      const parse = (value) => {
        const [r, g, b, a = 1] = value.match(/[\d.]+/g).map(Number);
        return { rgb: [r, g, b], a };
      };
      const luminance = (rgb) => rgb.map((v) => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, index) => sum + v * [0.2126, 0.7152, 0.0722][index], 0);
      const ratios = [...document.querySelectorAll("#fixture-bulk span, #fixture-bulk a")].map((node) => {
        const parents = [];
        for (let parent = node; parent; parent = parent.parentElement) parents.push(parent);
        let bg = [255, 255, 255];
        for (const parent of parents.reverse()) {
          const color = parse(getComputedStyle(parent).backgroundColor);
          bg = bg.map((value, i) => value * (1 - color.a) + color.rgb[i] * color.a);
        }
        const a = luminance(parse(getComputedStyle(node).color).rgb);
        const b = luminance(bg);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      return { sampled: ratios.length, min: Math.min(...ratios) };
    });
    assert.ok(result.min >= 4.5, `text contrast ${result.min} must meet AA`);
    return result;
  }
  report.darkContrast = await checkContrast();
  // Retained-node regression: repeatedly remove/reinsert portal panels.
  const before = (await command({})).retained.applied;
  await page.evaluate(() => { window.removedPanel = document.querySelector("#fixture-bulk"); window.removedPanel.remove(); });
  await settle();
  const retained = (await command({})).retained;
  report.retained = { before, afterRemoval: retained.applied };
  if (!baseline) {
    assert.ok(retained.applied < 20, "removed panels should be released");
    assert.equal(await page.evaluate(() => window.removedPanel.querySelector(".card").style.color), "");
    assert.equal(await page.evaluate(() => window.removedPanel.querySelector(".card").style.transitionProperty), "");
    assert.equal(retained.eased, 0);
  }
  await page.evaluate(() => document.body.append(window.removedPanel));
  await settle();
  assert.notEqual(await page.$eval("#fixture-bulk .card", (node) => getComputedStyle(node).backgroundColor), "rgb(255, 255, 255)");
  report.checks.push("removed themed panels restore cleanly and reinsert in the active theme");
  await command({ settings: { theme: "catppuccin-latte" } });
  await settle();
  report.lightContrast = await checkContrast();
  await command({ settings: { theme: "clear" } });
  await page.waitForFunction(() => !document.querySelector("#cc-cuims-theme"));
  assert.equal(await page.$eval("#fixture-bulk .card", (node) => node.style.color), "");
  report.checks.push("light/dark/default theme switching restores portal styles");
  report.requests = { directory: requestCount, live: 0 };
  assert.deepEqual(errors, []);
  report.errors = errors;
  writeFileSync(path.join(output, `${name}-${baseline ? "baseline" : "candidate"}-ux.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ failure: error.message, checks: report.checks, requestCount, errors }));
  throw error;
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
