// 0.10.6 update notices in a real Firefox, disposable profile, over
// Marionette (BiDi cannot reach extension pages or the browser's own
// prompts). Network: AMO's public version API and CUIMS's login page, no
// sign-in. Screenshots go to work/e2e/results.
//   node work/e2e/updates-firefox.mjs outputs/cuims-clear-firefox
import assert from "node:assert/strict";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const packageDir = path.resolve(process.argv[2] || "outputs/cuims-clear-firefox");
const out = path.resolve("work/e2e/results");
mkdirSync(out, { recursive: true });
const PORT = 28000 + Math.floor(Math.random() * 900);
const profile = mkdtempSync(path.join(os.tmpdir(), "cc-updates-ff-"));
writeFileSync(path.join(profile, "user.js"), [
  `user_pref("marionette.port", ${PORT});`,
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
].join("\n"));
const firefox = spawn(process.env.FIREFOX_BIN || "/Applications/Firefox.app/Contents/MacOS/firefox",
  ["--profile", profile, "--no-remote", "--marionette", "--remote-allow-system-access", ...(process.env.HEADED ? [] : ["--headless"])], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let buffer = "";
let nextId = 0;
const waiting = new Map();

async function connect() {
  for (let i = 0; i < 80 && !socket; i += 1) {
    socket = await new Promise((resolve) => {
      const s = net.connect(PORT, "127.0.0.1", () => resolve(s));
      s.on("error", () => resolve(null));
    });
    if (!socket) await sleep(500);
  }
  assert.ok(socket, "Firefox's Marionette port");
  let hello;
  const greeted = new Promise((resolve) => (hello = resolve));
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const colon = buffer.indexOf(":");
      if (colon < 0) return;
      const length = Number(buffer.slice(0, colon));
      if (buffer.length < colon + 1 + length) return;
      const message = JSON.parse(buffer.slice(colon + 1, colon + 1 + length));
      buffer = buffer.slice(colon + 1 + length);
      if (!Array.isArray(message)) {
        hello();
        continue;
      }
      const [, id, error, result] = message;
      const entry = waiting.get(id);
      waiting.delete(id);
      if (error) entry.reject(new Error(`${error.error}: ${error.message}`.slice(0, 300)));
      else entry.resolve(result);
    }
  });
  await greeted;
}

function send(name, params = {}) {
  if (process.env.TRACE) process.stderr.write(`→ ${name} ${JSON.stringify(params).slice(0, 90)}\n`);
  const id = ++nextId;
  const body = JSON.stringify([0, id, name, params]);
  socket.write(`${Buffer.byteLength(body)}:${body}`);
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}

const context = (value) => send("Marionette:SetContext", { value });
const run = async (script, args = []) => (await send("WebDriver:ExecuteScript", { script, args })).value;
const runAsync = async (script, args = []) => (await send("WebDriver:ExecuteAsyncScript", { script, args })).value;
const ref = (found) => {
  const value = found.value || found;
  return value["element-6066-11e4-a52e-4f735466cecf"] || Object.values(value)[0];
};
async function shot(name, element) {
  const { value } = await send("WebDriver:TakeScreenshot", element ? { id: element } : { full: false });
  writeFileSync(path.join(out, name), Buffer.from(value, "base64"));
}
async function waitFor(script, label, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await run(script).catch(() => null);
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`timed out: ${label}`);
}

// Extension storage from the popup page itself: objects built by the page's
// own JSON, so they belong to the page.
const storageSet = (values) =>
  runAsync(
    "const [json, done] = arguments; const w = window.wrappedJSObject || window; w.chrome.storage.local.set(w.JSON.parse(json)).then(() => done(true), (e) => done(String(e)));",
    [JSON.stringify(values)],
  );
const storageGet = (keys) =>
  runAsync(
    "const [json, done] = arguments; const w = window.wrappedJSObject || window; w.chrome.storage.local.get(w.JSON.parse(json)).then((v) => done(w.JSON.stringify(v)), (e) => done(String(e)));",
    [JSON.stringify(keys)],
  ).then((text) => JSON.parse(text));

const report = { checks: [] };
try {
  await connect();
  await send("WebDriver:NewSession", { capabilities: { timeouts: { script: 90_000 } } });
  await context("chrome");
  await send("WebDriver:SetWindowRect", { width: 900, height: 760 });
  const installed = await send("Addon:Install", { path: packageDir, temporary: true });
  const host = await runAsync(`const done = arguments[arguments.length - 1]; done(WebExtensionPolicy.getByID(${JSON.stringify(installed.value)}).mozExtensionHostname);`);
  const popup = `moz-extension://${host}/popup.html`;
  await context("content");
  await send("WebDriver:Navigate", { url: popup });
  await waitFor("return document.querySelector('#version')?.textContent", "popup loaded");
  report.version = await run("return document.querySelector('#version').textContent");

  // 1. Check now reaches AMO from the real background, with no new permission.
  // No saved login: the popup must not start a CUIMS read here.
  await storageSet({ popupView: "settings" });
  await send("WebDriver:Navigate", { url: popup });
  await waitFor("return !document.querySelector('#view-settings').hidden", "settings view");
  await send("WebDriver:ElementClick", { id: ref(await send("WebDriver:FindElement", { using: "css selector", value: "#update-check" })) });
  const state = await waitFor("const t = document.querySelector('#update-state').textContent; return /Checked|out|Couldn't/.test(t) && t", "check result");
  const stored = await storageGet({ updateInfo: null });
  report.amo = stored.updateInfo;
  assert.equal(stored.updateInfo.error, "", `AMO reachable: ${stored.updateInfo.error}`);
  assert.ok(stored.updateInfo.checkedAt > 0);
  report.checks.push(`Check now asked AMO: "${state}" (AMO lists ${stored.updateInfo.latest || "nothing newer"})`);
  await run("document.querySelector('#update-version').closest('fieldset').scrollIntoView({ block: 'center' })");
  await shot("ff-updates-settings.png", ref(await send("WebDriver:FindElement", { using: "css selector", value: ".app" })));

  // 2. A newer version: the banner.
  await storageSet({ updateInfo: { latest: "0.10.7", checkedAt: Date.now(), ready: false, error: "" }, popupView: "attendance" });
  await send("WebDriver:Navigate", { url: popup });
  await waitFor("return !document.querySelector('#update-banner').hidden", "update banner");
  report.banner = await run("return document.querySelector('#update-banner').innerText");
  assert.match(report.banner, /0\.10\.7 is out/);
  assert.match(report.banner, /Allow, then Add/);
  assert.equal(await run("return document.querySelector('#rate-nudge').hidden"), true, "one notice at a time");
  await shot("ff-updates-banner.png", ref(await send("WebDriver:FindElement", { using: "css selector", value: ".app" })));
  report.checks.push("banner shows the newer version and Firefox's two prompts");

  // 3. After an update: What's new, and Got it.
  await storageSet({ updateInfo: { latest: "", checkedAt: Date.now() }, updateDone: { from: "0.10.5", to: report.version.slice(1), at: Date.now(), seen: false } });
  await send("WebDriver:Navigate", { url: popup });
  await waitFor("return !document.querySelector('#update-news').hidden", "what's new");
  await sleep(400);
  report.news = await run("return document.querySelector('#update-news').innerText");
  await shot("ff-updates-news.png", ref(await send("WebDriver:FindElement", { using: "css selector", value: ".app" })));
  await send("WebDriver:ElementClick", { id: ref(await send("WebDriver:FindElement", { using: "css selector", value: "#update-news-done" })) });
  assert.equal(await run("return document.querySelector('#update-news').hidden"), true);
  assert.equal((await storageGet({ updateDone: null })).updateDone.seen, true);
  report.checks.push("What's new shows after an update and Got it hides it for good");

  // 4. Update now opens CUIMS with the bar, and the bar's link starts
  // Firefox's install prompt.
  await storageSet({ updateInfo: { latest: "0.10.7", checkedAt: Date.now() }, updateSnoozeUntil: Date.now() + 3_600_000 });
  await send("WebDriver:Navigate", { url: popup });
  await waitFor("return !document.querySelector('#update-banner').hidden", "update banner again");
  const handlesOf = (r) => (Array.isArray(r) ? r : r?.value || []);
  const before = handlesOf(await send("WebDriver:GetWindowHandles"));
  await send("WebDriver:ElementClick", { id: ref(await send("WebDriver:FindElement", { using: "css selector", value: "#update-now" })) });
  let handles = before;
  for (let i = 0; i < 40 && handles.length <= before.length; i += 1) {
    await sleep(250);
    handles = handlesOf(await send("WebDriver:GetWindowHandles"));
  }
  const opened = handles.find((handle) => !before.includes(handle));
  assert.ok(opened, "Update now opened a tab");
  await send("WebDriver:SwitchToWindow", { handle: opened });
  const url = await waitFor("return location.host === 'students.cuchd.in' && location.href", "CUIMS tab", 30_000);
  report.opened = url;
  const rect = await waitFor("const h = document.getElementById('cuims-clear-update-bar'); if (!h) return null; const r = h.getBoundingClientRect(); return r.width > 0 && { x: r.x, y: r.y, w: r.width, h: r.height };", "update bar on CUIMS", 30_000);
  report.checks.push(`Update now opened CUIMS (${new URL(url).pathname}) and the bar showed though × had hidden it`);
  await sleep(500);
  await shot("ff-updates-cuims-bar.png");
  // The bar's Update link: bottom-left of the bar, in a closed shadow root.
  const x = Math.round(rect.x + 14 + 25);
  const y = Math.round(rect.y + rect.h - 12 - 16);
  await send("WebDriver:PerformActions", { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", x, y, origin: "viewport" }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
  ] }] });
  await context("chrome");
  let prompt = "";
  for (let i = 0; i < 60 && !prompt; i += 1) {
    await sleep(500);
    prompt = await runAsync(`const done = arguments[arguments.length - 1];
      const w = Services.wm.getMostRecentWindow("navigator:browser");
      // addon-progress is the download; the question comes after it.
      const n = (w.PopupNotifications._currentNotifications || []).find((item) => /^addon-/.test(item.id) && item.id !== "addon-progress");
      done(n ? n.id : "");`);
  }
  report.prompt = prompt;
  assert.equal(prompt, "addon-install-blocked", "Firefox asks to allow students.cuchd.in to install");
  // Decline: this profile keeps the build under test.
  await runAsync(`const done = arguments[arguments.length - 1];
    const w = Services.wm.getMostRecentWindow("navigator:browser");
    const n = w.PopupNotifications.getNotification("addon-install-blocked");
    n?.remove(); done(true);`);
  report.checks.push("the bar's Update link brings up Firefox's \"Allow students.cuchd.in to install an add-on?\"");
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = String(error?.message || error);
} finally {
  try { firefox.kill("SIGKILL"); } catch {}
  await sleep(800);
  rmSync(profile, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
