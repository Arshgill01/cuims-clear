// Long-running recorder: every cuchd.in request from every tab and the
// extension service worker, plus the extension's shared login/attendance state.
import { appendFileSync } from "node:fs";
import { connect, extensionId } from "./cdp.mjs";
const LOG = process.argv[2];
const t0 = Date.now();
const log = (line) => appendFileSync(LOG, `${new Date().toISOString().slice(11, 23)} ${line}\n`);
const browser = await connect();
const EXT = await extensionId(browser);
const watched = new WeakSet();
async function watch(target) {
  if (watched.has(target)) return;
  watched.add(target);
  const type = target.type();
  if (!["page", "service_worker", "background_page", "other"].includes(type)) return;
  let session;
  try { session = await target.createCDPSession(); } catch { return; }
  const who = () => (type === "page" ? `tab:${(target.url() || "").replace(/^https?:\/\//, "").slice(0, 45)}` : type === "service_worker" ? "SW" : `${type}:${target.url().split("/").pop()}`);
  const ids = new Map();
  session.on("Network.requestWillBeSent", (e) => {
    if (!/cuchd\.in/.test(e.request.url)) return;
    if (type === "page" && /\.(css|js|png|gif|jpg|woff2?|ico|svg)(\?|$)|\.axd\?/i.test(e.request.url)) return;
    if (e.redirectResponse) log(`   ↳ ${e.redirectResponse.status} redirect → ${e.request.url}`);
    ids.set(e.requestId, e.request.url);
    log(`${who().padEnd(52)} ${e.request.method.padEnd(4)} ${e.request.url.replace("https://", "").slice(0, 110)}`);
  });
  session.on("Network.responseReceived", (e) => {
    if (!ids.has(e.requestId)) return;
    const u = e.response.url;
    if (e.response.status !== 200 || /Login|GenerateCaptcha|GetReport|lbtn|StudentHome/i.test(u)) log(`   ← ${e.response.status} ${u.replace("https://", "").slice(0, 100)}`);
  });
  session.on("Network.loadingFailed", (e) => {
    if (ids.has(e.requestId)) log(`   ✕ ${e.canceled ? "canceled" : e.errorText} ${ids.get(e.requestId).replace("https://", "").slice(0, 90)}`);
  });
  session.on("Network.loadingFinished", (e) => {
    if (ids.has(e.requestId) && /Login\.aspx$/i.test(ids.get(e.requestId))) log(`   ✓ finished ${ids.get(e.requestId).replace("https://", "")} (${e.encodedDataLength} bytes)`);
  });
  session.on("Runtime.consoleAPICalled", (e) => {
    const text = e.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (type !== "page" || /CUIMS Clear/.test(text)) log(`${who()} console.${e.type}: ${text.slice(0, 200)}`);
  });
  session.on("Runtime.exceptionThrown", (e) => log(`${who()} EXCEPTION ${e.exceptionDetails?.exception?.description?.slice(0, 200) || e.exceptionDetails?.text}`));
  try { await session.send("Network.enable"); } catch {}
  try { await session.send("Runtime.enable"); } catch {}
  if (type === "service_worker") { try { await session.send("Runtime.runIfWaitingForDebugger"); } catch {} }
}
browser.on("targetcreated", watch);
browser.on("targetchanged", (t) => {});
for (const t of browser.targets()) await watch(t);
// State poller through the service worker.
const KEYS = ["loginTabAt", "bgLoginTouchAt", "bgSignInUntil", "bgSignInOkAt", "sessionAlive", "sessionCheckedAt", "attendanceStatus", "attendanceBackoffUntil", "attendanceFailStreak", "attendanceAfterTab", "loginGuard", "lmsLaunchAt", "attendanceAuto", "pageLoginAt"];
let last = "";
setInterval(async () => {
  const sw = browser.targets().find((t) => t.type() === "service_worker" && t.url().includes(EXT));
  if (!sw) return;
  try {
    const worker = await sw.worker();
    const state = await worker.evaluate((keys) => chrome.storage.local.get(keys), KEYS);
    const now = Date.now();
    for (const k of ["loginTabAt", "bgLoginTouchAt", "bgSignInUntil", "bgSignInOkAt", "sessionCheckedAt", "attendanceBackoffUntil", "attendanceAfterTab", "lmsLaunchAt", "pageLoginAt"]) if (state[k]) state[k] = `${Math.round((state[k] - now) / 1000)}s`;
    if (state.attendanceStatus) state.attendanceStatus = `${state.attendanceStatus.working ? "WORKING " + state.attendanceStatus.phase : ""}${state.attendanceStatus.code ? " code=" + state.attendanceStatus.code : ""}${state.attendanceStatus.error ? " err=" + state.attendanceStatus.error.slice(0, 90) : ""}`;
    if (state.loginGuard) state.loginGuard = `fails=${(state.loginGuard.failures || []).map((f) => f.by).join(",")} lock=${state.loginGuard.lockoutUntil ? Math.round((state.loginGuard.lockoutUntil - now) / 1000) + "s" : 0}`;
    const text = JSON.stringify(state).replace(/-?\d+s/g, (m) => m); 
    const shape = JSON.stringify({ ...state, loginTabAt: !!state.loginTabAt, sessionCheckedAt: !!state.sessionCheckedAt, bgLoginTouchAt: state.bgLoginTouchAt, attendanceBackoffUntil: !!state.attendanceBackoffUntil });
    if (shape !== last) { last = shape; log(`STATE ${text}`); }
  } catch {}
}, 1000);
log(`recorder started`);
