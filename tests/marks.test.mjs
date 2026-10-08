import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fakeCuims, memoryStorage } from "./fake-cuims.mjs";

const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
const fixture = readFileSync(new URL("fixtures/marks/regular.html", import.meta.url), "utf8");
const previous = fixture.replace('selected="selected" value="26271"', 'value="26271"').replace('value="25262"', 'selected="selected" value="25262"');
function load() {
  const context = vm.createContext({ URL, URLSearchParams, Headers, AbortSignal, Intl, Date, Math, JSON, console, setTimeout });
  for (const file of ["attendance-parse.js", "attendance-model.js", "attendance-client.js", "marks.js", "attendance-daemon.js", "attendance-view.js", "marks-view.js"]) {
    vm.runInContext(readFileSync(new URL(file, root), "utf8"), context, { filename: file });
  }
  return context;
}
const context = load();
const A = context.CuimsAttendance;
const M = context.CuimsMarks;
const NOW = Date.UTC(2026, 9, 8, 6);
const saved = () => memoryStorage({ uid: "24BCS00000", password: "secret" });
function server(options = {}) {
  const base = fakeCuims({ signedIn: true, ...options });
  const requests = [];
  let html = fixture;
  return {
    state: base.state, requests,
    setHTML(value) { html = value; },
    async fetchImpl(target, settings = {}) {
      if (new URL(target).pathname !== "/frmStudentMarksView.aspx") return base.fetchImpl(target, settings);
      requests.push({ target, ...settings });
      if (!base.state.signedIn) return base.fetchImpl("https://students.cuchd.in/StudentHome.aspx", settings);
      const body = new URLSearchParams(settings.body);
      return { url: target, status: 200, text: async () => settings.method === "POST" && body.get(M.SESSION_NAME) === "25262" ? previous : html };
    },
  };
}
const daemon = (s, storage) => A.createDaemon({ storage, fetchImpl: s.fetchImpl, solveCaptcha: async () => "Ab12", now: () => NOW, sleep: async () => {} });

test("regular marks includes collapsed subjects, decimals, zero, absent and unpublished marks", () => {
  const result = M.parseRegularMarks(fixture);
  assert.equal(result.sessionId, "26271");
  assert.equal(result.subjects.length, 3);
  assert.equal(result.subjects[1].exams[0].obtained, "15.5");
  assert.equal(result.subjects[1].exams[1].obtained, "A");
  assert.equal(result.subjects[2].exams[0].obtained, "0");
  assert.equal(result.subjects[2].exams[1].obtained, "");
  assert.equal(result.subjects[2].title, "Projects & Java (24CSH-301)");
});

test("a marks read is one GET; concurrent calls and background restarts reuse persistent cache", async () => {
  const s = server(), storage = saved(), d = daemon(s, storage);
  const reads = await Promise.all([d.fetchRegularMarks(), d.fetchRegularMarks(), d.fetchRegularMarks()]);
  assert.ok(reads.every((result) => result.cache.snapshots["26271"].subjects.length === 3));
  assert.equal(s.requests.length, 1);
  const cached = await daemon(s, storage).fetchRegularMarks();
  assert.equal(cached.cached, true);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].credentials, "include");
  assert.equal(s.state.loginPosts, 0);
});

test("previous session uses the page's ASP.NET fields once, then both sessions remain cached", async () => {
  const s = server(), storage = saved(), d = daemon(s, storage);
  await d.fetchRegularMarks();
  await d.fetchRegularMarks("25262");
  assert.equal(s.requests.length, 3);
  const post = s.requests[2];
  const fields = new URLSearchParams(post.body);
  assert.equal(post.method, "POST");
  assert.equal(fields.get("__VIEWSTATE"), "marks&state");
  assert.equal(fields.get("__EVENTVALIDATION"), "validation");
  assert.equal(fields.get("hfcurrentbackground"), "browser-token");
  assert.equal(fields.get("__EVENTTARGET"), M.SESSION_NAME);
  assert.equal(fields.get(M.SESSION_NAME), "25262");
  await d.fetchRegularMarks("26271");
  await daemon(s, storage).fetchRegularMarks("25262");
  assert.equal(s.requests.length, 3);
  assert.doesNotMatch(JSON.stringify(storage.data.marksCache), /VIEWSTATE|validation|browser-token/);
});

test("signed-out marks reuses the existing guarded background sign-in", async () => {
  const s = server({ signedIn: false }), storage = saved();
  const result = await daemon(s, storage).fetchRegularMarks();
  assert.ok(result.cache);
  assert.equal(s.state.uidPosts, 1);
  assert.equal(s.state.loginPosts, 1);
  assert.equal(s.state.landingCalls, 1);
});

test("marks yields to a login tab, without replacing its CAPTCHA", async () => {
  const s = server({ signedIn: false }), storage = saved();
  storage.data.loginTabAt = NOW;
  const result = await daemon(s, storage).fetchRegularMarks();
  assert.equal(result.code, "tab-login");
  assert.equal(s.state.loginPosts, 0);
  assert.equal(s.state.captchaReads, 0);
});

test("CUIMS failure pages are not cached as empty marks; retries are rate limited", async () => {
  const s = server(), storage = saved(), d = daemon(s, storage);
  s.setHTML("<html>Please wait</html>");
  assert.equal((await d.fetchRegularMarks()).code, "marks-shape");
  assert.equal(storage.data.marksCache, undefined);
  assert.equal((await d.fetchRegularMarks()).code, "busy");
  assert.equal(s.requests.length, 1);
});

test("an explicitly empty marks session is cached, with no repeated reads", async () => {
  const s = server(), storage = saved(), d = daemon(s, storage);
  s.setHTML(fixture.replace(/<div id="accordion">[\s\S]*?<\/form>/, '<p>No Data Found</p></form>'));
  const result = await d.fetchRegularMarks();
  assert.equal(result.cache.snapshots["26271"].subjects.length, 0);
  await d.fetchRegularMarks();
  assert.equal(s.requests.length, 1);
});

test("a different signed-in UID is rejected, and marks from an old UID are never reused", async () => {
  const s = server(), storage = saved(), d = daemon(s, storage);
  await d.fetchRegularMarks();
  storage.data.uid = "24BCS00001";
  const result = await d.fetchRegularMarks();
  assert.equal(result.code, "account-mismatch");
  assert.equal(s.requests.length, 2);
  assert.equal(M.marksCacheFor(storage.data.marksCache, storage.data.uid), null);
});

test("clearing or changing login during a fetch prevents stale marks from being saved", async () => {
  const s = server(), storage = saved();
  const fetchImpl = async (...args) => {
    const result = await s.fetchImpl(...args);
    storage.data.uid = "";
    storage.data.password = "";
    return result;
  };
  const d = A.createDaemon({ storage, fetchImpl, now: () => NOW });
  assert.equal((await d.fetchRegularMarks()).code, "cancelled");
  assert.equal(storage.data.marksCache, undefined);
});

test("unoffered sessions and missing UID send no marks request", async () => {
  const s = server(), storage = saved(), d = daemon(s, storage);
  await d.fetchRegularMarks();
  assert.equal((await d.fetchRegularMarks("99999")).code, "marks-session");
  assert.equal(s.requests.length, 1);
  storage.data.uid = "";
  assert.equal((await d.fetchRegularMarks()).code, "needs-login");
  assert.equal(s.requests.length, 1);
});

test("marks view escapes portal text and preserves the published values without inventing totals", async () => {
  const s = server(), storage = saved();
  const { cache } = await daemon(s, storage).fetchRegularMarks();
  cache.snapshots["26271"].subjects[0].title = '<img src=x onerror=alert(1)>';
  const html = context.CuimsMarksView.render(cache, "26271");
  assert.doesNotMatch(html, /<img|onerror=alert\(1\)>/);
  assert.match(html, /&lt;img/);
  assert.match(html, />15.5</);
  assert.match(html, />0</);
  assert.match(html, />A</);
  assert.match(html, /Reopening this tab uses the saved marks/);
  assert.doesNotMatch(html, /id="fetch-marks"/);
});

test("Firefox alone has the Marks tab and 0.10.0 background wiring", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  assert.equal(manifest.version, "0.10.0");
  assert.ok(manifest.background.scripts.indexOf("marks.js") < manifest.background.scripts.indexOf("attendance-daemon.js"));
  const html = readFileSync(new URL("popup.html", root), "utf8");
  assert.match(html, /id="tab-marks"/);
  assert.match(html, /id="view-marks"/);
  const chromeManifest = JSON.parse(readFileSync(new URL("../cuims-clear-chrome/manifest.json", root)));
  assert.equal(chromeManifest.version, "0.9.0");
});
