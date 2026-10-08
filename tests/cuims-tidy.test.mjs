import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const read = (name) => readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8");
const context = vm.createContext({});
for (const name of ["attendance-parse.js", "attendance-model.js"]) vm.runInContext(read(name), context);
const A = context.CuimsAttendance;

// CUIMS's timetable as served since October 2026: grdMain, rows in CUIMS's
// own (not chronological) order, and the course list as grdCourseDetail.
// Invented teachers and rooms.
const NEW_TIMETABLE = `
<div class="form_header">My Time Table</div>
<div><div>
<table class="table table-bordered table-hover" id="grdMain">
  <tbody>
    <tr><th scope="col">Timing</th><th scope="col">Mon</th><th scope="col">Tue</th><th scope="col">Wed</th><th scope="col">Sat</th></tr>
    <tr><td>12:50 - 1:40 PM</td><td>&nbsp;</td><td>&nbsp;</td><td>24CSP-305:P::GP-A: By Asha Rao(E10001) at Block-C1-307
</td><td>&nbsp;</td></tr>
    <tr><td>1:40 - 2:30 PM</td><td>24SMT-341:L::GP-All: By Ravi Kumar(E10002) at Block-B1-314
</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
    <tr><td>09:30 - 10:20 AM</td><td>24CSP-305:P::GP-A: By Asha Rao(E10001) at Block-C1-307
</td><td>24CST-302:L::GP-All: By Meena Iyer(E10003) at Block-B1-405-A
</td><td>&nbsp;</td><td>&nbsp;</td></tr>
  </tbody>
</table>
</div></div>
<table id="ContentPlaceHolder1_grdCourseDetail">
  <tr><th>Course Code</th><th>Title</th></tr>
  <tr><td>24CSP-305</td><td>Competitive Coding-II</td></tr>
  <tr><td>24SMT-341</td><td>Probability and Statistics</td></tr>
  <tr><td>24CST-302</td><td>Computer Networks</td></tr>
</table>`;

test("the timetable parses from CUIMS's grdMain markup", () => {
  const slots = A.parseTimetable(NEW_TIMETABLE);
  assert.equal(slots.length, 4);
  const coding = slots.find((slot) => slot.weekday === "wed");
  assert.deepEqual({ ...coding }, { weekday: "wed", start: 770, end: 820, shortCode: "24CSP-305", title: "Competitive Coding-II", kind: "P" });
  assert.equal(slots.find((slot) => slot.weekday === "tue").title, "Computer Networks");
});

test("both timetable markups count as a timetable, so no extra postback is sent", () => {
  assert.equal(A.hasTimetable(NEW_TIMETABLE), true);
  assert.equal(A.hasTimetable('<table id="ContentPlaceHolder1_gvMyTimeTable"><tr><td>x</td></tr></table>'), true);
  assert.equal(A.hasTimetable("<p>Session expired</p>"), false);
  assert.match(read("attendance-client.js"), /if \(!api\.hasTimetable\(page\.html\)\)/);
});

test("both manifests load the tidy layer on CUIMS, after the model it uses", () => {
  for (const build of ["firefox", "chrome"]) {
    const manifest = JSON.parse(readFileSync(new URL(`../outputs/cuims-clear-${build}/manifest.json`, import.meta.url), "utf8"));
    const entry = manifest.content_scripts.find((script) => script.js.includes("cuims-tidy.js"));
    assert.ok(entry, build);
    assert.deepEqual(entry.matches, ["https://students.cuchd.in/*"]);
    assert.deepEqual(entry.js, ["attendance-model.js", "cuims-tidy.js"]);
    assert.deepEqual(entry.css, ["cuims-tidy.css"]);
    assert.equal(entry.all_frames, undefined, `${build}: top frame only`);
  }
});

test("the tidy switch is in Settings and on by default", () => {
  assert.match(read("popup.html"), /data-key="cuimsTidy"/);
  assert.match(read("popup.js"), /cuimsTidy: true,/);
});

// The theme engine reads a tinted grey as an accent and recolours it; the
// tidy greys must stay neutral (HSL saturation under 0.2, or near white).
test("tidy greys stay neutral for the CUIMS theme engine", () => {
  const css = read("cuims-tidy.css");
  for (const name of ["line", "line-strong", "soft", "muted"]) {
    const hex = css.match(new RegExp(`--cc-${name}: (#[0-9a-f]{6});`))[1];
    const [r, g, b] = hex.match(/\w\w/g).map((value) => parseInt(value, 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    assert.ok(s < 0.2 || l > 0.96, `--cc-${name} ${hex} saturation ${s.toFixed(2)}`);
  }
});

// The page behaviour itself, in real browsers when they are available:
// CHROME_BIN=/path/to/chrome FIREFOX_BIN=/path/to/firefox npm test
const BROWSERS = [
  ["Chrome", "chrome", process.env.CHROME_BIN],
  ["Firefox", "firefox", process.env.FIREFOX_BIN],
];

const MARKS = `
<div id="accordion">
  <h3 class="ui-accordion-header"><span class="ui-icon"></span>  Computer Networks (24CST-302)</h3>
  <div class="ui-accordion-content"><table><thead><tr><th>Exam</th><th>Max</th><th>Got</th></tr></thead>
    <tbody><tr><td>MST-1</td><td>20</td><td>18.5</td></tr><tr><td>Quiz</td><td>5</td><td>4</td></tr><tr><td>Assignment</td><td>10</td><td>Not posted</td></tr></tbody></table></div>
  <h3 class="ui-accordion-header"><span class="ui-icon"></span>  Aptitude (24TDT-312)</h3>
  <div class="ui-accordion-content"><table><tbody></tbody></table></div>
</div>
<table id="SortTable"><tbody>
  <tr><td data-label="Course Code:">A</td><td data-label="Eligible Delivered:">40</td><td data-label="Eligible Percentage:">72.5</td></tr>
  <tr><td data-label="Course Code:">B</td><td data-label="Eligible Delivered:">40</td><td data-label="Eligible Percentage:">91</td></tr>
  <tr><td data-label="Course Code:">C</td><td data-label="Eligible Delivered:">0</td><td data-label="Eligible Percentage:">0</td></tr>
</tbody></table>
<table class="table" id="ContentPlaceHolder1_wucStudentDateSheet_gvStudentDateSheet"><tbody>
  <tr><th>Exam Type</th><th>datesheettype</th><th>Course code</th><th>Course Name</th><th>UID</th><th>New SlotNo</th><th>Exam Date</th><th>Exam Timing</th><th>Exam Venue</th><th>Mode OF Exam</th></tr>
  <tr><td>Regular</td><td>MST-2</td><td>24CSE-341</td><td>INTRODUCTION TO IOT AND AI/ML</td><td>24BCS10000</td><td>&nbsp;</td><td>02 Oct 2026</td><td>15:00</td><td>B1</td><td>Offline</td></tr>
  <tr><td>Regular</td><td>MST-2</td><td>24TDT-312</td><td>APTITUDE-III</td><td>24BCS10000</td><td>&nbsp;</td><td>01 Oct 2026</td><td>15:00</td><td><a href="https://example.test/exam">Online Exam Link</a></td><td>Online-CBT</td></tr>
  <tr><td>Regular</td><td>MST-2</td><td>24CSH-301</td><td>PROJECT BASED LEARNING IN JAVA</td><td>24BCS10000</td><td>&nbsp;</td><td>01 Oct 2026</td><td>12:30</td><td>B1</td><td>Offline</td></tr>
  <tr><td>Regular</td><td>MST-1</td><td>24CST-302</td><td>COMPUTER NETWORKS</td><td>24BCS10000</td><td>&nbsp;</td><td>25 Aug 2026</td><td>12:30</td><td>B1</td><td>Offline</td></tr>
</tbody></table>
<table id="fullreport"><tbody>
  <tr><td data-label="Attendance">Present</td></tr>
  <tr><td data-label="Attendance">Absent</td></tr>
  <tr><td data-label="Attendance">Absent(Duty Leave)</td></tr>
  <tr><td data-label="Attendance">Present</td></tr>
</tbody></table>`;

for (const [label, kind, executablePath] of BROWSERS) {
const browserTest = executablePath && existsSync(executablePath) ? test : test.skip;
browserTest(`${label}: the tidy layer orders the week, marks today and now, totals marks, tallies a subject, lists upcoming exams, and steps aside when off`, async () => {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ browser: kind, executablePath, headless: true, ...(kind === "chrome" ? { args: ["--no-sandbox"] } : {}) });
  try {
    const page = await browser.newPage();
    // Wednesday 30 Sep 2026, 13:00 IST: the 12:50 lab is in progress.
    const now = Date.UTC(2026, 8, 30, 7, 30);
    await page.evaluateOnNewDocument((frozen) => {
      const Real = Date;
      globalThis.Date = class extends Real {
        constructor(...args) { super(...(args.length ? args : [frozen])); }
        static now() { return frozen; }
      };
      const listeners = [];
      const data = { cuimsTidy: true, attendanceGoal: "standard" };
      globalThis.chrome = {
        storage: {
          local: { get: (defaults, cb) => cb({ ...defaults, ...data }) },
          onChanged: { addListener: (fn) => listeners.push(fn) },
        },
      };
      globalThis.__flip = (value) => listeners.forEach((fn) => fn({ cuimsTidy: { newValue: value } }, "local"));
    }, now);
    await page.goto("about:blank");
    const SIDEBAR = `<div id="uims_sidebar"><ul id="menu-content">
      <li data-toggle="collapse" data-target="#3563"><a class="a-uims-nav" href="javascript:void(0);">Academics</a></li>
      <ul id="3563" class="sub-menu collapse"><li><a class="a-uims-nav" href="frmMyTimeTable.aspx">My Time Table</a></li><li><a class="a-uims-nav" href="frmMyCourse.aspx">My Courses</a></li></ul>
    </ul></div><div id="loader-wrapper"></div>`;
    await page.setContent(`<html><head><style>${read("cuims-tidy.css")}</style></head><body>${SIDEBAR}<div class="inner-wrapper">${NEW_TIMETABLE}${MARKS}</div></body></html>`);
    await page.evaluate(read("attendance-model.js"));
    // The timetable is only rebuilt on its own page; hand the script that URL.
    await page.evaluate((source) => new Function("location", source)(new URL("https://students.cuchd.in/frmMyTimeTable.aspx")), read("cuims-tidy.js"));

    const view = await page.evaluate(() => ({
      times: [...document.querySelectorAll(".cc-tt-grid tbody .cc-tt-start")].map((cell) => cell.textContent),
      heads: [...document.querySelectorAll(".cc-tt-grid thead th")].map((cell) => cell.firstChild.textContent),
      today: document.querySelector(".cc-tt-grid thead th.is-today")?.firstChild.textContent,
      now: [...document.querySelectorAll(".cc-class.is-now .cc-class-title")].map((node) => node.textContent),
      line: document.querySelector(".cc-tt-now").textContent,
      originalHidden: getComputedStyle(document.getElementById("grdMain")).display === "none",
      // Every card holds its own text and sits inside its cell (in Firefox,
      // cards once collapsed and their text ran over the next row).
      spilled: [...document.querySelectorAll(".cc-tt-grid td .cc-class")].filter((card) => {
        const box = card.getBoundingClientRect();
        const cell = card.closest("td").getBoundingClientRect();
        const text = card.lastElementChild.getBoundingClientRect();
        return text.bottom > box.bottom + 1 || box.bottom > cell.bottom + 1;
      }).length,
      scores: [...document.querySelectorAll(".cc-score")].map((chip) => chip.textContent),
      code: document.querySelector(".cc-code")?.textContent,
      low: [...document.querySelectorAll("#SortTable td.is-low")].map((cell) => cell.textContent),
      ok: [...document.querySelectorAll("#SortTable td.is-ok")].map((cell) => cell.textContent),
      tally: document.querySelector(".cc-tally")?.textContent,
      revealed: document.body.classList.contains("loaded"),
      here: [...document.querySelectorAll("#menu-content .cc-here")].map((link) => link.textContent),
      hereGroup: document.querySelector("#menu-content li.cc-here-group")?.textContent,
      exams: [...document.querySelectorAll(".cc-ds-exam")].map((item) => [item.querySelector(".cc-ds-count").textContent, item.querySelector(".cc-ds-name").textContent, item.querySelector(".cc-ds-meta").textContent, item.querySelector(".cc-ds-link")?.href || ""]),
      dsRows: [...document.querySelectorAll('table[id$="gvStudentDateSheet"] tr')].slice(1).map((row) => row.className),
      dsShown: [...document.querySelectorAll('table[id$="gvStudentDateSheet"] th')].filter((cell) => getComputedStyle(cell).display !== "none").map((cell) => cell.textContent),
      marks: [...document.querySelectorAll("#fullreport td.cc-mark")].map((cell) => cell.className.replace("cc-mark ", "")),
    }));
    assert.deepEqual(view.times, ["9:30 AM", "12:50 PM", "1:40 PM"]);
    // Saturday has no classes, so it is dropped.
    assert.deepEqual(view.heads, ["Time", "Mon", "Tue", "Wed"]);
    assert.equal(view.today, "Wed");
    assert.deepEqual(view.now, ["Competitive Coding‑II"]);
    assert.match(view.line, /^NowCompetitive Coding-II in C1-307, until 1:40 PM/);
    assert.equal(view.originalHidden, true);
    assert.equal(view.spilled, 0);
    // Unposted marks are left out of the total; a subject with none has no chip.
    assert.deepEqual(view.scores, ["22.5 / 25"]);
    assert.equal(view.code, "24CST-302");
    assert.deepEqual(view.low, ["72.5"]);
    assert.deepEqual(view.ok, ["91"]);
    // Shown at once, not a second after CUIMS is ready; the sidebar knows where we are.
    assert.equal(view.revealed, true);
    assert.deepEqual(view.here, ["My Time Table"]);
    assert.equal(view.hereGroup, "Academics");
    // Exams still to come, nearest first, with a countdown; past ones dimmed;
    // the own-UID and empty columns hidden.
    assert.deepEqual(view.exams, [
      ["Tomorrow", "Project Based Learning in Java", "MST\u20112 · 12:30 PM · B1 · Offline", ""],
      ["Tomorrow", "Aptitude-III", "MST\u20112 · 3:00 PM · Online\u2011CBT", "https://example.test/exam"],
      ["in 2 days", "Introduction to IoT and AI/ML", "MST\u20112 · 3:00 PM · B1 · Offline", ""],
    ]);
    assert.deepEqual(view.dsRows, ["", "cc-ds-next", "cc-ds-next", "cc-ds-past"]);
    assert.deepEqual(view.dsShown, ["Exam Type", "datesheettype", "Course code", "Course Name", "Exam Date", "Exam Timing", "Exam Venue", "Mode OF Exam"]);
    // Leave is told apart from a plain absence.
    assert.equal(view.tally, "4 classes · 2 present · 1 absent · 1 on leave");
    assert.deepEqual(view.marks, ["is-present", "is-absent", "is-leave", "is-present"]);

    await page.evaluate(() => globalThis.__flip(false));
    const off = await page.evaluate(() => ({
      tidy: document.documentElement.classList.contains("cc-tidy"),
      original: getComputedStyle(document.getElementById("grdMain")).display,
      view: getComputedStyle(document.querySelector(".cc-tt")).display,
      chip: getComputedStyle(document.querySelector(".cc-score")).display,
    }));
    assert.deepEqual(off, { tidy: false, original: "table", view: "none", chip: "none" });

    // Back on: the view is rebuilt once, with Now current again.
    await page.evaluate(() => globalThis.__flip(true));
    const back = await page.evaluate(() => ({
      tidy: document.documentElement.classList.contains("cc-tidy"),
      views: document.querySelectorAll(".cc-tt").length,
      now: document.querySelectorAll(".cc-class.is-now").length,
    }));
    assert.deepEqual(back, { tidy: true, views: 1, now: 1 });
  } finally {
    await browser.close();
  }
});
}
