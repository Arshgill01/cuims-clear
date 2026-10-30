import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ Intl, Date });
for (const name of ["attendance-model.js", "duty-leave.js"]) vm.runInContext(readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8"), context, { filename: name });
const D = context.CuimsDutyLeave;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Friday 30 Oct 2026; Thursday the 29th had a timetable and marks.
const SLOTS = [
  { weekday: "thu", start: 570, end: 620, shortCode: "24TDT-312", title: "Aptitude-III" },
  { weekday: "thu", start: 620, end: 670, shortCode: "24CST-302", title: "Computer Networks" },
  { weekday: "thu", start: 820, end: 870, shortCode: "24SMT-341", title: "Probability and Statistics" },
  { weekday: "fri", start: 570, end: 620, shortCode: "24CSP-305", title: "Competitive Coding-II" },
];

test("the days CUIMS takes are today and the three before, newest first", () => {
  const days = D.planDays({ todayKey: "2026-10-30" });
  assert.deepEqual(plain(days.map((day) => [day.key, day.weekday, day.back])), [
    ["2026-10-30", "fri", 0],
    ["2026-10-29", "thu", 1],
    ["2026-10-28", "wed", 2],
    ["2026-10-27", "tue", 3],
  ]);
  assert.equal(D.WINDOW_DAYS, 3);
});

test("a day's classes: absences ticked, unmarked ones offered, present and leave left out", () => {
  const history = {
    "24TDT312": { marks: [["2026-10-29", 570, "a"]] },
    "24CST302": { marks: [["2026-10-29", 620, "p"]] },
    "24SMT341": { marks: [["2026-10-29", 820, "d"]] },
    // An absence the timetable does not have (an extra class).
    "24CSH301": { marks: [["2026-10-29", 930, "a"], ["2026-10-20", 570, "a"]] },
  };
  const titles = { "24CSH301": "Project Based Learning in Java" };
  const [today, thursday] = D.planDays({ todayKey: "2026-10-30", history, slots: SLOTS, titles });
  assert.deepEqual(plain(thursday.lectures.map((item) => [item.start, item.title, item.state])), [
    [570, "Aptitude-III", "absent"],
    [930, "Project Based Learning in Java", "absent"],
  ]);
  assert.equal(thursday.absent, 2);
  // Today: on the timetable, not marked yet.
  assert.deepEqual(plain(today.lectures.map((item) => [item.start, item.state])), [[570, "unmarked"]]);
  assert.equal(today.absent, 0);
});

test("CUIMS's date picker text and lecture timings", () => {
  assert.equal(D.pickerDate("2026-10-09"), "10/09/2026");
  assert.equal(D.startOf("09:30 - 10:20 AM"), 570);
  assert.equal(D.startOf("1:40 - 2:30 PM"), 820);
  assert.equal(D.startOf("12:00 - 12:50 PM"), 720);
  assert.equal(D.shiftKey("2026-11-01", -3), "2026-10-29");
});

test("the card only runs on the Duty Leave page, and never presses Save", () => {
  const source = readFileSync(new URL("../outputs/cuims-clear-firefox/duty-leave.js", import.meta.url), "utf8");
  assert.match(source, /frmStudentApplyDutyLeave\\\.aspx\$/);
  assert.doesNotMatch(source, /btnSave/);
  assert.doesNotMatch(source, /FuFileName/);
  assert.doesNotMatch(source, /cbcheckfinal/);
});
