// Offline differential trace through each release's real daemon and client.
// No live requests, credentials, report IDs or student records are printed.
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeCuims, memoryStorage } from "../../tests/fake-cuims.mjs";

const START = Date.UTC(2026, 9, 12, 5, 30);
function load(ref) {
  const context = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, TextEncoder, Intl, Date, Math, JSON, console, setTimeout });
  for (const file of ["attendance-parse", "attendance-model", "attendance-client", "attendance-daemon"]) {
    const source = ref === "working-tree"
      ? readFileSync(new URL(`../../outputs/cuims-clear-firefox/${file}.js`, import.meta.url), "utf8")
      : execFileSync("git", ["show", `${ref}:outputs/cuims-clear-firefox/${file}.js`], { encoding: "utf8" });
    vm.runInContext(source, context, { filename: `${file}.js` });
  }
  return context.CuimsAttendance;
}

async function trace(ref, { timetablePostback = false, inherited = null, tabDuringReport = false } = {}) {
  const api = load(ref);
  const storage = memoryStorage(inherited || { uid: "TEST_ACCOUNT", password: "secret" });
  const server = fakeCuims({ signedIn: true });
  const base = Math.max(START, Number(storage.data.attendanceLastAttemptAt || 0) + 61_000);
  let time = base;
  const rows = [];
  const fetchImpl = async (target, options = {}) => {
    const path = new URL(target).pathname;
    const method = options.method || "GET";
    rows.push({ second: (time - base) / 1000, method, path, cookies: options.credentials !== "omit" });
    if (tabDuringReport && /\/GetReport$/.test(path)) await storage.set({ tabPageAt: time });
    if (timetablePostback && /frmMyTimeTable/.test(path) && method === "GET") {
      return { url: target, status: 200, text: async () => '<form><input type="hidden" name="__VIEWSTATE" value="test" /></form>' };
    }
    return server.fetchImpl(target, options);
  };
  const daemon = () => api.createDaemon({ storage, fetchImpl, solveCaptcha: async () => "Ab12", now: () => time, sleep: async (ms) => { time += ms; } });
  let instance = daemon();
  const reads = [];
  for (const second of [0, 61, 122, 362, 663, 1024]) {
    time = base + second * 1000;
    if (second === 61) instance = daemon(); // restart/update with preserved storage
    const from = rows.length;
    const result = await instance.refresh("manual");
    reads.push({ second, code: result.code || "", requests: rows.slice(from) });
  }
  return { reads, storage: structuredClone(storage.data) };
}

const result = {};
for (const [version, ref] of [["0.8.7", "11b4462^"], ["0.9.0", "11b4462"], ["0.9.5", "056de8e"], ["0.10.3", "35b1c45"], ["candidate", "working-tree"]]) {
  const run = await trace(ref, { timetablePostback: true });
  result[version] = run.reads;
}
const warm = await trace("056de8e");
result.updateWithWarmState = (await trace("35b1c45", { inherited: warm.storage, timetablePostback: true })).reads;
result.concurrentTabPage = (await trace("35b1c45", {
  inherited: { uid: "TEST_ACCOUNT", password: "secret", attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-10-12", slots: [{ weekday: "mon", start: 580, end: 620, shortCode: "24CSP-305" }] } },
  tabDuringReport: true,
})).reads;
result.candidateConcurrentTabPage = (await trace("working-tree", {
  inherited: { uid: "TEST_ACCOUNT", password: "secret", attendanceMeta: { reportId: "RID+/=", sessionId: "25262" }, attendanceTimetable: { day: "2026-10-12", slots: [{ weekday: "mon", start: 580, end: 620, shortCode: "24CSP-305" }] } },
  tabDuringReport: true,
})).reads;
// Pacing can move a due leave page to a later refresh; feature reads remain.
const calls = (reads) => reads.flatMap((read) => read.requests).map(({ second, ...request }) => JSON.stringify(request)).sort();
assert.deepEqual(calls(result.candidate), calls(result["0.10.3"]));
const pages = result.candidate.flatMap((read) => read.requests).filter((request) => /\.aspx$/.test(request.path));
assert.ok(pages.slice(1).every((page, index) => page.second - pages[index].second >= 6));
assert.ok(result.candidateConcurrentTabPage.every((read) => read.requests.every((request) => !/Leave.aspx/.test(request.path))));
console.log(JSON.stringify(result, null, 2));
