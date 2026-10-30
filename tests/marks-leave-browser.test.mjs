// The packaged Chrome extension on CUIMS's Marks View and Duty Leave pages,
// served from fixtures at their real URLs. Runs when Chrome is available:
// CHROME_BIN=/path/to/chrome npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const CHROME = process.env.CHROME_BIN;
const browserTest = CHROME && existsSync(CHROME) ? test : test.skip;
const ORIGIN = "https://students.cuchd.in";
const fixture = (name) => readFileSync(new URL(`./fixtures/cuims/${name}`, import.meta.url), "utf8");
const shots = new URL("../work/e2e/results/marks-leave/", import.meta.url);

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../outputs/cuims-clear-firefox/marks-model.js", import.meta.url), "utf8"), context);
const M = context.CuimsMarks;

// The accordion as it stands once CUIMS's jQuery UI has run over it.
const marksPage = (name) => fixture(name).replace(/<h3>/g, '<h3 class="ui-accordion-header">').replace("</form>", '<div id="uims_sidebar"></div></form>');

async function launch() {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: true, args: process.getuid?.() === 0 ? ["--no-sandbox"] : [] });
  const id = await browser.installExtension(path.resolve("outputs/cuims-clear-chrome"));
  const target = await browser.waitForTarget((item) => item.type() === "service_worker" && item.url().startsWith(`chrome-extension://${id}`));
  const worker = await target.worker();
  // No background request may reach the network from here.
  await worker.evaluate(() => {
    globalThis.fetch = async () => new Response("offline", { status: 503 });
  });
  return { browser, worker };
}

async function servePortal(page, routes) {
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const url = new URL(request.url());
    try {
      if (url.origin === ORIGIN && routes[url.pathname]) await request.respond({ status: 200, contentType: "text/html", body: routes[url.pathname] });
      else await request.respond({ status: 204, body: "" });
    } catch {}
  });
}

browserTest("Marks View: the average weighs like CU, the raw total sits beside it, and the Aptitude & Soft Skills switch is shared", async () => {
  mkdirSync(shots, { recursive: true });
  const { browser, worker } = await launch();
  try {
    await worker.evaluate(() => chrome.storage.local.set({ cuimsTidy: true, marksIncludeSkills: true }));
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 1000 });
    await servePortal(page, { "/frmStudentMarksView.aspx": marksPage("marks-current.html") });
    await page.goto(`${ORIGIN}/frmStudentMarksView.aspx`);
    await page.waitForSelector(".cc-mk .cc-mk-big b");

    const subjects = M.parseMarksPage(fixture("marks-current.html")).subjects;
    const all = M.summarize(subjects, { includeSkills: true });
    const without = M.summarize(subjects, { includeSkills: false });
    const read = () => page.evaluate(() => ({
      big: document.querySelector(".cc-mk-big b").textContent,
      alt: document.querySelector(".cc-mk-alt b")?.textContent,
      sub: document.querySelector(".cc-mk-sub").textContent,
      tiles: document.querySelectorAll(".cc-mk-subject").length,
      out: [...document.querySelectorAll(".cc-mk-subject.is-out .cc-mk-subject-name span")].map((node) => node.textContent),
      chips: [...document.querySelectorAll(".cc-score")].map((node) => node.textContent),
      switchOn: document.querySelector("[data-cc-skills]")?.checked,
    }));
    let view = await read();
    assert.equal(view.big, M.formatPercent(all.average));
    assert.equal(view.alt, `${M.formatPercent(all.raw.percent)}%`);
    assert.match(view.sub, /^8 subjects, each counted equally/);
    assert.equal(view.tiles, 8);
    assert.deepEqual(view.out, []);
    assert.deepEqual(view.chips, [...all.subjects].map((subject) => `${M.formatPercent(subject.percent)}%`));
    assert.equal(view.switchOn, true);
    await page.screenshot({ path: new URL("marks-view.png", shots).pathname, fullPage: true });

    await page.click("[data-cc-skills]");
    await page.waitForFunction((expected) => document.querySelector(".cc-mk-big b")?.textContent === expected, {}, M.formatPercent(without.average));
    view = await read();
    assert.match(view.sub, /^6 subjects/);
    assert.deepEqual(view.out, ["24TDT-312", "24TDP-311"]);
    assert.equal(view.switchOn, false);
    assert.equal(await worker.evaluate(() => chrome.storage.local.get("marksIncludeSkills").then((value) => value.marksIncludeSkills)), false);
    await page.screenshot({ path: new URL("marks-view-skills-off.png", shots).pathname, fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

browserTest("Duty Leave: straight to External, and one button walks CUIMS's lecture form up to the reason and proof", async () => {
  mkdirSync(shots, { recursive: true });
  const { browser, worker } = await launch();
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const day = (back) => new Date(Date.parse(`${today}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
    const yesterday = day(1);
    const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${yesterday}T00:00:00Z`).getUTCDay()];
    await worker.evaluate((yesterday, weekday) => chrome.storage.local.set({
      // Absent at 9:30 and 10:20, present at 1:40; 11:10 is a class CUIMS
      // will not take more leave for.
      attendanceHistory: { v: 2, subjects: {
        "24TDT312": { attended: 1, delivered: 2, marks: [[yesterday, 570, "a"]] },
        "24CST302": { attended: 1, delivered: 2, marks: [[yesterday, 620, "a"]] },
        "24SMT341": { attended: 2, delivered: 2, marks: [[yesterday, 820, "p"]] },
      } },
      attendanceTimetable: { savedAt: Date.now(), slots: [
        { weekday, start: 570, end: 620, shortCode: "24TDT-312", title: "Aptitude-III" },
        { weekday, start: 620, end: 670, shortCode: "24CST-302", title: "Computer Networks" },
        { weekday, start: 820, end: 870, shortCode: "24SMT-341", title: "Probability and Statistics" },
      ] },
      dlLastCategory: "",
    }), yesterday, weekday);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width: 1100, height: 1000 });
    await servePortal(page, { "/frmStudentApplyDutyLeave.aspx": fixture("duty-leave-mock.html") });

    // Opens on Internal; the extension takes it to External.
    await page.goto(`${ORIGIN}/frmStudentApplyDutyLeave.aspx`);
    await page.waitForFunction(() => location.search === "?tab=external", { timeout: 10_000 });
    await page.waitForSelector(".cc-dl");
    const card = await page.evaluate(() => ({
      days: [...document.querySelectorAll(".cc-dl-day")].map((chip) => [chip.querySelector("b").textContent, chip.querySelector("span").textContent, chip.classList.contains("is-on")]),
      lectures: [...document.querySelectorAll(".cc-dl-lecture")].map((row) => [row.querySelector("b").textContent, row.querySelector(".cc-dl-subject").textContent, row.querySelector("input").checked]),
      go: document.querySelector(".cc-dl-go").disabled,
    }));
    assert.equal(card.days.length, 4, "today and the three days CUIMS still accepts");
    assert.deepEqual(card.days[1], ["Yesterday", "2 absent", true]);
    assert.deepEqual(card.lectures, [["9:30 AM", "Aptitude-III", true], ["10:20 AM", "Computer Networks", true]]);
    assert.equal(card.go, true, "a category comes first");

    await page.select(".cc-dl-field select", "20");
    await page.click(".cc-dl-go");
    await page.waitForSelector('.cc-dl-status[data-tone="good"]', { timeout: 20_000 });
    const after = await page.evaluate(() => ({
      status: document.querySelector(".cc-dl-status").textContent,
      posts: window.__posts,
      picked: [...document.querySelectorAll("#ContentPlaceHolder1_gvSelectedTimes [id*=lblCourseName]")].map((node) => node.textContent),
      focused: document.activeElement?.id,
    }));
    const mmddyyyy = `${yesterday.slice(5, 7)}/${yesterday.slice(8, 10)}/${yesterday.slice(0, 4)}`;
    assert.deepEqual(after.posts.map((post) => post.target), ["ctl00$ContentPlaceHolder1$ddlTypeNew", "ctl00$ContentPlaceHolder1$txtDate", "Next Step"]);
    assert.equal(after.posts[1].state.category, "20", "the category went before the date");
    assert.equal(after.posts[1].state.date, mmddyyyy);
    assert.deepEqual(after.posts[2].ticked, [0, 2]);
    assert.equal(after.posts[2].count, "2");
    assert.ok(!after.posts.some((post) => post.saved), "Save stays with the student");
    assert.deepEqual(after.picked, ["Aptitude-III", "Computer Networks"]);
    assert.match(after.status, /^Filled for 2 lectures \(Aptitude-III, Computer Networks\)\. Now write the reason/);
    assert.equal(after.focused, "ContentPlaceHolder1_txtPurposeofDL");
    assert.equal(await worker.evaluate(() => chrome.storage.local.get("dlLastCategory").then((value) => value.dlLastCategory)), "20");
    await page.screenshot({ path: new URL("duty-leave.png", shots).pathname, fullPage: true });

    // Choosing Internal sticks for the tab: no bounce back to External.
    await page.click("#ContentPlaceHolder1_rblType_0");
    await page.waitForFunction(() => location.search === "" && document.getElementById("ContentPlaceHolder1_pnlInternal"), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(await page.evaluate(() => location.search), "");
    assert.equal(await page.$(".cc-dl"), null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

browserTest("Duty Leave: a lecture CUIMS will not take is reported, and the rest still go in", async () => {
  const { browser, worker } = await launch();
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    await worker.evaluate((today) => chrome.storage.local.set({
      attendanceHistory: { v: 2, subjects: {
        "24CSP305": { marks: [[today, 670, "a"]] },
        "24CSH301": { marks: [[today, 870, "a"]] },
      } },
      attendanceTimetable: null,
      dlLastCategory: "32",
    }), today);
    const page = await browser.newPage();
    await servePortal(page, { "/frmStudentApplyDutyLeave.aspx": fixture("duty-leave-mock.html") });
    await page.goto(`${ORIGIN}/frmStudentApplyDutyLeave.aspx?tab=external`);
    await page.waitForSelector(".cc-dl-day.is-on");
    assert.equal(await page.$eval(".cc-dl-day.is-on b", (node) => node.textContent), "Today");
    await page.click(".cc-dl-go");
    await page.waitForSelector('.cc-dl-status[data-tone="good"]', { timeout: 20_000 });
    const status = await page.$eval(".cc-dl-status", (node) => node.textContent);
    assert.match(status, /^Filled for 1 lecture \(Project Based Learning in Java\)\. 1 not allowed by CUIMS \(Sorry, Can not apply for more DL\)\./);
  } finally {
    await browser.close();
  }
});

browserTest("popup: the Marks tab shows the same figures, switches session, shares the skills switch, and asks for a read", async () => {
  mkdirSync(shots, { recursive: true });
  const { browser, worker } = await launch();
  try {
    const current = M.parseMarksPage(fixture("marks-current.html"));
    const previous = M.parseMarksPage(fixture("marks-previous.html"));
    const savedAt = Date.now() - 2 * 60 * 60 * 1000;
    const examMarks = {
      current: "26271",
      savedAt,
      triedAt: savedAt,
      sessions: {
        26271: { label: current.session.label, subjects: JSON.parse(JSON.stringify(current.subjects)), savedAt },
        25262: { label: previous.session.label, subjects: JSON.parse(JSON.stringify(previous.subjects)), savedAt: savedAt - 1000 },
      },
    };
    await worker.evaluate((examMarks) => chrome.storage.local.set({ uid: "24BCS00000", password: "x", popupView: "marks", rateNudge: { done: true }, attendanceExamMarks: examMarks, marksIncludeSkills: true, attendanceLastAttemptAt: Date.now() }), examMarks);
    const id = new URL(worker.url()).host;
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width: 440, height: 720, deviceScaleFactor: 2 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await page.waitForSelector("#view-marks .fc-big");
    const read = () => page.evaluate(() => ({
      selected: document.querySelector("#tab-marks").getAttribute("aria-selected"),
      big: document.querySelector("#view-marks .fc-big").textContent,
      raw: document.querySelector("#view-marks .mk-raw strong")?.textContent,
      sessions: [...document.querySelectorAll("[data-marks-session]")].map((button) => [button.textContent, button.getAttribute("aria-checked")]),
      courses: document.querySelectorAll("#view-marks .mk-course").length,
      out: [...document.querySelectorAll("#view-marks .mk-course.is-out .course-title")].map((node) => node.textContent),
      note: document.querySelector("#view-marks .attendance-note").textContent,
    }));
    const all = M.summarize(current.subjects);
    let view = await read();
    assert.equal(view.selected, "true");
    assert.equal(view.big, `${M.formatPercent(all.average)}%`);
    assert.equal(view.raw, `${M.formatPercent(all.raw.percent)}%`);
    assert.deepEqual(view.sessions, [["Current session", "true"], ["Previous session", "false"]]);
    assert.equal(view.courses, 8);
    assert.match(view.note, /^Read 2 h ago from Marks View/);
    await page.screenshot({ path: new URL("popup-marks.png", shots).pathname, fullPage: true });

    // The earlier session: a graded course and an attendance-only one wait.
    await page.click('[data-marks-session="25262"]');
    view = await read();
    assert.equal(view.big, `${M.formatPercent(M.summarize(previous.subjects).average)}%`);
    assert.deepEqual(view.out, ["Introduction to Machine Learning (Through SWAYAM)", "Semester Mini Project"]);

    // The switch is shared with Marks View on CUIMS.
    await page.click('[data-marks-session="26271"]');
    await page.click("[data-marks-skills]");
    await page.waitForFunction((expected) => document.querySelector("#view-marks .fc-big")?.textContent === expected, {}, `${M.formatPercent(M.summarize(current.subjects, { includeSkills: false }).average)}%`);
    assert.equal(await worker.evaluate(() => chrome.storage.local.get("marksIncludeSkills").then((value) => value.marksIncludeSkills)), false);
    view = await read();
    assert.deepEqual(view.out, ["Aptitude-III", "Soft Skills-III"]);
    await page.evaluate(() => document.querySelector(".mk-kinds")?.setAttribute("open", ""));
    await page.screenshot({ path: new URL("popup-marks-skills-off.png", shots).pathname, fullPage: true });

    // Refresh marks: the ask is saved before the read.
    await worker.evaluate(() => chrome.storage.local.set({ attendanceLastAttemptAt: 0 }));
    await page.waitForSelector("[data-marks-refresh]:not([disabled])", { timeout: 40_000 });
    const before = Date.now();
    await page.click("[data-marks-refresh]");
    await page.waitForFunction(() => true);
    const wanted = await worker.evaluate(() => new Promise((resolve) => setTimeout(() => chrome.storage.local.get("marksWantedAt").then((value) => resolve(value.marksWantedAt)), 300)));
    assert.ok(wanted >= before, "marksWantedAt set by Refresh marks");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
