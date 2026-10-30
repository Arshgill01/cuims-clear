import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL("../outputs/cuims-clear-firefox/marks-model.js", import.meta.url), "utf8"), context);
const M = context.CuimsMarks;
const fixture = (name) => readFileSync(new URL(`./fixtures/cuims/${name}`, import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.005, `${label ?? ""} ${actual} ≠ ${expected}`);
const item = (name, max, got) => ({ name, max, got: got === "AB" ? 0 : got, absent: got === "AB" });

test("Marks View parses: sessions, every subject, its rows, and a graded course's letter", () => {
  const current = M.parseMarksPage(fixture("marks-current.html"));
  assert.deepEqual(plain(current.sessions.map((entry) => [entry.value, entry.selected])), [["26271", true], ["25262", false]]);
  assert.equal(current.session.value, "26271");
  assert.equal(current.subjects.length, 8);
  const salesforce = current.subjects[0];
  assert.equal(salesforce.title, "Salesforce-I");
  assert.equal(salesforce.code, "24CSH-316");
  assert.equal(salesforce.items.length, 6);
  assert.deepEqual({ ...salesforce.items[4] }, { name: "Practical Test-1", max: 30, got: 0, absent: true });

  const previous = M.parseMarksPage(fixture("marks-previous.html"));
  assert.equal(previous.session.value, "25262");
  assert.equal(previous.subjects.length, 10);
  const project = previous.subjects.find((subject) => subject.code === "24CSR-208");
  assert.equal(project.grade, "B+");
  assert.equal(project.items.length, 0);
});

test("a theory course comes out exactly as CU's internal: assignment 10, surprise 4, quiz 4, MSTs 20, attendance 2", () => {
  // Real rows of a 2025-26 theory course, obtained marks invented.
  const subject = {
    title: "Operating Systems",
    code: "24CST-205",
    items: [item("Assignment/PBL", 10, 9), item("Attendance Marks", 2, 2), item("Mid-Semester Test-1", 20, 15), item("Quiz", 4, 4), item("Surprise Test", 12, 11), item("Mid-Semester Test-2", 20, 19)],
  };
  const score = M.scoreSubject(subject);
  // CU: 9 + 2 + (15 + 19) / 2 + 4 + 11 / 12 × 4 = 35.67 of 40.
  near(score.points, 9 + 2 + 17 + 4 + (11 / 12) * 4);
  assert.equal(score.outOf, 40);
  near(score.percent, (35.6667 / 40) * 100 + 0.0008);
  // Adding the raw rows (60 of 68) is what read wrong before: MSTs carry
  // 40 of 68 there instead of 20 of 40, the surprise test 12 instead of 4.
  near(score.raw.percent, (60 / 68) * 100);
  assert.notEqual(M.formatPercent(score.percent), M.formatPercent(score.raw.percent));
});

test("repeats of one kind share one weight, however many were held", () => {
  const three = M.scoreSubject({ items: [item("Experiment-1", 30, 30), item("Experiment-2", 30, 30), item("Experiment-3", 30, 30), item("Mid-Term Test", 15, 0)] });
  const one = M.scoreSubject({ items: [item("Experiment-1", 30, 30), item("Mid-Term Test", 15, 0)] });
  // Experiments are 40 to the lab test's 15 either way.
  near(three.percent, (40 / 55) * 100);
  near(one.percent, three.percent);
  // Raw, a fourth experiment would keep pulling the subject up.
  assert.ok(three.raw.percent > one.raw.percent);
});

test("assessments fall into CU's kinds, first match winning", () => {
  const kinds = {
    "Mid-Semester Test-1": "mst",
    "MST-2 Hybrid": "mst",
    "Practical MST": "lab-test",
    "Industry Aligned Assessment(Lab MST Hybrid)": "lab-test",
    "Mid-Term Test": "lab-test",
    "Mid Term": "lab-test",
    "Surprise Test Score": "surprise",
    "Surprise Test(CSE)": "surprise",
    "Quiz-1(Unit-1)": "quiz",
    "Assignment/PBL-2": "assignment",
    "Live Assignment-1(Unit-1)": "assignment",
    "Experiment 3(CSE)": "experiment",
    "Practical Worksheet/Projects 4": "experiment",
    "Practical Test-1": "experiment",
    "Course Project Evaluation": "project",
    "Class Performance(CSE)": "class",
    "Attendance and Engagement Score (LMS)": "attendance",
    "Attendance Marks": "attendance",
  };
  for (const [name, key] of Object.entries(kinds)) assert.equal(M.kindOf(name).key, key, name);
  assert.equal(M.kindOf("Write X (Soft Skills)").key, "other:write x (soft skills)");
  assert.equal(M.kindOf("Viva-2").key, M.kindOf("Viva-1").key);
});

test("rows: ABSENT is zero, unposted marks are left out, a grade row is a grade", () => {
  assert.deepEqual({ ...M.readRow("Practical Test-1", "30", "ABSENT") }, { name: "Practical Test-1", max: 30, got: 0, absent: true });
  assert.deepEqual({ ...M.readRow("Quiz", "4", "3.5") }, { name: "Quiz", max: 4, got: 3.5, absent: false });
  assert.equal(M.readRow("MST-2", "20", ""), null);
  assert.equal(M.readRow("MST-2", "20", "Not Posted"), null);
  assert.equal(M.readRow("MST-2", "0", "0"), null);
  assert.deepEqual({ ...M.readRow("- Grade", "-", "B+") }, { grade: "B+" });
});

test("the average counts each subject once; attendance-only and graded courses wait", () => {
  const previous = M.parseMarksPage(fixture("marks-previous.html"));
  const summary = M.summarize(previous.subjects);
  const byCode = Object.fromEntries(summary.subjects.map((subject) => [subject.code, subject]));
  assert.equal(byCode["24CST-211"].reason, "attendance-only");
  assert.equal(byCode["24CSR-208"].reason, "graded");
  assert.equal(summary.counted, 8);
  const counted = summary.subjects.filter((subject) => subject.counts);
  near(summary.average, counted.reduce((sum, subject) => sum + subject.percent, 0) / 8);
  const raw = counted.reduce((sum, subject) => ({ got: sum.got + subject.raw.got, max: sum.max + subject.raw.max }), { got: 0, max: 0 });
  near(summary.raw.percent, (raw.got / raw.max) * 100);
});

test("Aptitude and Soft Skills are found by name or TDT/TDP code, and the switch leaves them out", () => {
  const current = M.parseMarksPage(fixture("marks-current.html"));
  const skills = current.subjects.filter(M.isSkillCourse).map((subject) => subject.code);
  assert.deepEqual(plain(skills), ["24TDT-312", "24TDP-311"]);
  assert.equal(M.isSkillCourse({ title: "APTITUDE - II", code: "" }), true);
  assert.equal(M.isSkillCourse({ title: "Computer Networks", code: "24CST-302" }), false);
  const all = M.summarize(current.subjects);
  const without = M.summarize(current.subjects, { includeSkills: false });
  assert.equal(all.counted, 8);
  assert.equal(without.counted, 6);
  assert.equal(without.subjects.find((subject) => subject.code === "24TDT-312").reason, "skill-off");
  assert.equal(all.skills, 2);
  assert.notEqual(M.formatPercent(all.average), M.formatPercent(without.average));
});

test("percentages read one decimal, rounded, the same everywhere", () => {
  assert.equal(M.formatPercent(87.25), "87.3");
  assert.equal(M.formatPercent(87.24), "87.2");
  assert.equal(M.formatPercent(100), "100.0");
  assert.equal(M.formatPercent(null), "—");
  assert.equal(M.sessionName({ label: "CurrentSession-26271" }), "Current session");
  assert.equal(M.sessionName({ label: "PreviousSession-25262" }), "Previous session");
});

test("both builds ship the same marks model", () => {
  const chrome = readFileSync(new URL("../outputs/cuims-clear-chrome/marks-model.js", import.meta.url), "utf8");
  const firefox = readFileSync(new URL("../outputs/cuims-clear-firefox/marks-model.js", import.meta.url), "utf8");
  assert.equal(chrome, firefox);
});

// ---- the background: Marks View for the popup ----

import { fakeCuims, memoryStorage, TIMETABLE_HTML } from "./fake-cuims.mjs";

const BACKGROUND = ["attendance-parse.js", "academic-calendar.js", "attendance-model.js", "marks-model.js", "attendance-client.js", "attendance-daemon.js"];

function loadBackground() {
  const sandbox = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, TextEncoder, Intl, Date, Math, JSON, console, setTimeout });
  for (const name of BACKGROUND) vm.runInContext(readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8"), sandbox, { filename: name });
  return sandbox.CuimsAttendance;
}

const A = loadBackground();
const clock = Date.parse("2026-10-28T11:00:00+05:30");
const META = { reportId: "RID+/=", sessionId: "26271" };
const quiet = (when) => ({
  attendanceMeta: META,
  attendanceTimetable: { slots: A.parseTimetable(TIMETABLE_HTML), savedAt: when, session: "26271" },
  attendanceLeaves: { v: A.LEAVES_VERSION, apps: { dl: [], ml: [] }, pending: {}, dlAt: when, mlAt: when, checkedAt: when },
});

function daemon(server, storage) {
  let time = clock;
  const instance = A.createDaemon({ storage, fetchImpl: server.fetchImpl, solveCaptcha: async () => "Ab12", now: () => time, sleep: async (ms) => { time += ms; } });
  return { ...instance, advance: (ms) => (time += ms), now: () => time };
}

test("Marks View costs no request until the student asks for it", async () => {
  const server = fakeCuims({ signedIn: true, marksView: fixture("marks-current.html") });
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret", ...quiet(clock) });
  const result = await daemon(server, storage).refresh();
  assert.equal(result.error, undefined, result.error);
  assert.equal(server.state.marksLoads, 0);
  assert.equal(storage.data.attendanceExamMarks, undefined);
});

test("asked for on the Marks tab, Marks View is read once with the next refresh and kept by session", async () => {
  const server = fakeCuims({ signedIn: true, marksView: fixture("marks-current.html") });
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret", ...quiet(clock), marksWantedAt: clock - 1000 });
  const bg = daemon(server, storage);
  const result = await bg.refresh();
  assert.equal(result.error, undefined, result.error);
  assert.equal(server.state.marksLoads, 1);
  const saved = storage.data.attendanceExamMarks;
  assert.equal(saved.current, "26271");
  assert.equal(saved.sessions["26271"].subjects.length, 8);
  assert.equal(saved.sessions["26271"].label, "CurrentSession-26271");
  // Read: no second load for the same ask.
  bg.advance(60_000);
  await bg.refresh();
  assert.equal(server.state.marksLoads, 1);
  // A new ask, a new read.
  storage.data.marksWantedAt = bg.now();
  bg.advance(60_000);
  await bg.refresh();
  assert.equal(server.state.marksLoads, 2);
});

test("a refused Marks View waits for the next ask, and the attendance read still stands", async () => {
  const server = fakeCuims({ signedIn: true, marksView: "<html><body>Something else</body></html>" });
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret", ...quiet(clock), marksWantedAt: clock - 1000 });
  const bg = daemon(server, storage);
  const result = await bg.refresh();
  assert.equal(result.error, undefined);
  assert.ok(result.snapshot.subjects.length);
  assert.equal(server.state.marksLoads, 1);
  assert.ok(storage.data.attendanceExamMarks.triedAt > 0);
  bg.advance(60_000);
  await bg.refresh();
  assert.equal(server.state.marksLoads, 1, "not again for the same ask");
});

test("opening Marks View on CUIMS hands it over for free, each session apart", async () => {
  const server = fakeCuims({ signedIn: true });
  const storage = memoryStorage({ uid: "24BCS00000", password: "secret" });
  const bg = daemon(server, storage);
  await bg.checkStudent();
  await bg.ingestMarksPage(fixture("marks-current.html"));
  bg.advance(1000);
  await bg.ingestMarksPage(fixture("marks-previous.html"));
  const saved = storage.data.attendanceExamMarks;
  assert.deepEqual(Object.keys(saved.sessions).sort(), ["25262", "26271"]);
  // The previous session's page still names the current one in its dropdown.
  assert.equal(saved.current, "26271");
  assert.equal(saved.sessions["25262"].subjects.length, 10);
  assert.equal(server.state.requests.length, 0, "no request of its own");
  // Another student's UID drops it.
  storage.data.uid = "24BCS99999";
  await bg.checkStudent();
  assert.equal(storage.data.attendanceExamMarks, null);
});

test("a CUIMS tab hands Marks View over, and the background accepts it", () => {
  const content = readFileSync(new URL("../outputs/cuims-clear-firefox/content.js", import.meta.url), "utf8");
  assert.match(content, /type: "cuims-clear:marks-page"/);
  assert.match(content, /shareMarksPage\(\);/);
  const bg = readFileSync(new URL("../outputs/cuims-clear-firefox/attendance-bg.js", import.meta.url), "utf8");
  assert.match(bg, /cuims-clear:marks-page.*ingestMarksPage/);
  for (const build of ["firefox", "chrome"]) {
    const manifest = JSON.parse(readFileSync(new URL(`../outputs/cuims-clear-${build}/manifest.json`, import.meta.url), "utf8"));
    const scripts = build === "firefox" ? manifest.background.scripts : readFileSync(new URL("../outputs/cuims-clear-chrome/service-worker.js", import.meta.url), "utf8").match(/"[\w-]+\.js"/g).map((name) => name.slice(1, -1));
    assert.ok(scripts.indexOf("marks-model.js") >= 0 && scripts.indexOf("marks-model.js") < scripts.indexOf("attendance-client.js"), build);
  }
});
