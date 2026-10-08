// Observe ordinary portal browsing; this is not a load/limit-finding test.
// Requests are recorded as method/path/status/timing and selected headers.
// Never records request bodies, query strings, cookies, page text or credentials.
// node work/e2e/live-observe.mjs <chrome|firefox> <packageDir> [--with-login]
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";

const [name, packageDir, option] = process.argv.slice(2);
if (option && option !== "--with-login") throw new Error("Use --with-login to load .env, or omit it for public-only observation");
const settings = { autoAdvanceUid: false, autoSolveCaptcha: false, autoSubmitLogin: false, uid: "", password: "" };
if (option === "--with-login") {
  try { process.loadEnvFile(path.resolve(".env")); } catch { throw new Error("Create .env from .env.example first"); }
  if (!process.env.CUIMS_UID || !process.env.CUIMS_PASSWORD) throw new Error("Fill CUIMS_UID and CUIMS_PASSWORD in .env before live account testing");
  Object.assign(settings, { uid: process.env.CUIMS_UID, password: process.env.CUIMS_PASSWORD, autoAdvanceUid: true, autoSolveCaptcha: true, autoSubmitLogin: true });
}
const temp = mkdtempSync(path.join(tmpdir(), "cc-live-"));
const extensionDir = path.join(temp, "extension");
let browser;
const requests = new Map();
const completed = [];
let stoppedOnRefusal = false;
const output = path.resolve("work/e2e/results/live-observation.json");
try {
  cpSync(path.resolve(packageDir), extensionDir, { recursive: true });
  // Seed local extension storage from an extension-only script. No webpage
  // bridge sees credentials. This script and the browser profile are deleted.
  writeFileSync(path.join(extensionDir, "test-config.js"), `chrome.storage.local.set(${JSON.stringify(settings)});`, { mode: 0o600 });
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.background.scripts) manifest.background.scripts.unshift("test-config.js");
  else {
    const workerPath = path.join(extensionDir, manifest.background.service_worker);
    writeFileSync(workerPath, `importScripts("test-config.js");\n${readFileSync(workerPath, "utf8")}`);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest));
  browser = await launchBrowser(name, { profileDir: path.join(temp, "profile") });
  const page = (await browser.pages())[0] || await browser.newPage();
  await browser.installExtension(extensionDir);
  await new Promise((resolve) => setTimeout(resolve, 500));
  // Match only portal traffic; do not log browser/extension internals.
  const portal = (url) => /^(students|lms)\.cuchd\.in$/.test(new URL(url).hostname);
  page.on("request", (request) => {
    if (!portal(request.url())) return;
    requests.set(request, { method: request.method(), host: new URL(request.url()).hostname, path: new URL(request.url()).pathname, startedAt: performance.now() });
  });
  page.on("response", async (response) => {
    const record = requests.get(response.request());
    if (!record) return;
    record.status = response.status();
    record.responseMs = Math.round(performance.now() - record.startedAt);
    record.headers = Object.fromEntries(Object.entries(response.headers()).filter(([key]) => /^(retry-after|ratelimit.*|x-ratelimit.*|server-timing|cache-control|content-type)$/i.test(key)).map(([key, value]) => [key, value.slice(0, 200)]));
    if ([429, 503].includes(record.status)) {
      stoppedOnRefusal = true;
      await page.setJavaScriptEnabled(false).catch(() => {});
    }
  });
  function finish(request, failed = false) {
    const record = requests.get(request);
    if (!record) return;
    requests.delete(request);
    const { startedAt, ...safe } = record;
    completed.push({ ...safe, completedMs: Math.round(performance.now() - startedAt), ...(failed ? { failed: true } : {}) });
  }
  page.on("requestfinished", (request) => finish(request));
  page.on("requestfailed", (request) => finish(request, true));
  await page.goto("https://students.cuchd.in/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Observe one normal page/login flow. No artificial retries or bursts.
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const report = {
    browser: await browser.version(),
    accountLoginEnabled: option === "--with-login",
    observedAt: new Date().toISOString(),
    stoppedOnRefusal,
    requests: completed,
    limitation: "These observations do not establish a rate threshold, window, scope (IP/session/account), or lockout count. No stress test or intentionally invalid login was performed.",
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ requests: completed.length, statuses: completed.reduce((counts, row) => { counts[row.status || "failed"] = (counts[row.status || "failed"] || 0) + 1; return counts; }, {}), rateHeaders: completed.filter((row) => Object.keys(row.headers || {}).some((key) => /ratelimit|retry-after/i.test(key))).length, stoppedOnRefusal, report: output }));
} finally {
  await browser?.close();
  rmSync(temp, { recursive: true, force: true });
}
