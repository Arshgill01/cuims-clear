// Real browser, real extension, a mocked students.cuchd.in that refuses every
// login with "Invalid Captcha" and a fresh login page, as CUIMS does. The
// extension must submit three times by itself, then stop and say so.
//   node e2e-retries.mjs <chrome|firefox> <package dir>
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { launchFirefox } from "./ff-launch.mjs";

const [browserName, extDir] = process.argv.slice(2);
const CAPTCHA = readFileSync(new URL("../corpus/live/a001.jpg", import.meta.url));
const page = (error) => `<!doctype html><html><body>
<form method="get" action="./Login.aspx" id="form1">
<input name="txtLoginPassword" type="password" id="txtLoginPassword" value="fixture-pass" />
<img id="imgCaptcha" src="GenerateCaptcha.aspx?${Date.now()}" />
<input name="txtcaptcha" type="text" id="txtcaptcha" placeholder="Enter captcha" />
<input type="submit" name="btnLogin" value="LOGIN" id="btnLogin" />
<span id="lblError">${error ? "Invalid Captcha" : ""}</span>
</form></body></html>`;

const browser = browserName === "firefox"
  ? await launchFirefox()
  : await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true, enableExtensions: true });
await browser.installExtension(path.resolve(extDir));
await new Promise((r) => setTimeout(r, 2500));
const tab = await browser.newPage();
const settle = (p) => p?.catch?.(() => {});
let submits = 0;
await tab.setRequestInterception(true);
tab.on("request", (req) => {
  const url = req.url();
  if (!url.startsWith("https://students.cuchd.in/")) return settle(req.continue());
  if (/GenerateCaptcha/i.test(url)) return settle(req.respond({ status: 200, contentType: "image/jpeg", body: CAPTCHA }));
  if (/StudentHome/i.test(url)) return settle(req.respond({ status: 200, contentType: "text/html", body: "<html><body>home</body></html>" }));
  const refused = new URL(url).searchParams.has("txtcaptcha");
  if (refused) submits += 1;
  return settle(req.respond({ status: 200, contentType: "text/html", body: page(refused) }));
});
// A fresh session: StudentHome clears any earlier run's counters.
await settle(tab.goto("https://students.cuchd.in/StudentHome.aspx", { waitUntil: "domcontentloaded" }));
await settle(tab.goto("https://students.cuchd.in/Login.aspx", { waitUntil: "domcontentloaded" }));
await new Promise((r) => setTimeout(r, 8000));
const status = await tab.evaluate(() => document.querySelector("#cuims-clear-login-status")?.textContent || "").catch(() => "");
console.log(`${browserName}: automatic submits ${submits} (want 3); status: "${status}"`);
await browser.close().catch(() => {});
browser.__kill?.();
process.exit(submits === 3 && /3 tries/.test(status) ? 0 : 1);
