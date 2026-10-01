// Real browser, real extension package, mocked students.cuchd.in.
// Serves labelled CUIMS captchas on the login page and records the captcha
// text the extension actually submits in the Login POST.
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { launchFirefox } from "./ff-launch.mjs";

const [browserName, extDir, labelsFile = "labels.json", limit = "999"] = process.argv.slice(2);
const CORPUS = new URL("../corpus", import.meta.url).pathname;
const labels = Object.entries(JSON.parse(readFileSync(path.join(CORPUS, labelsFile), "utf8"))).slice(0, Number(limit));

const PASSWORD_PAGE = `<!doctype html><html><head><title>CUIMS</title></head><body>
<form method="get" action="./Login.aspx" id="form1">
<input type="hidden" name="__VIEWSTATE" value="vs" />
<input name="txtLoginPassword" type="password" id="txtLoginPassword" value="fixture-pass" />
<img id="imgCaptcha" src="GenerateCaptcha.aspx?N" />
<input name="txtcaptcha" type="text" maxlength="6" id="txtcaptcha" placeholder="Enter captcha" />
<input type="submit" name="btnLogin" value="LOGIN" id="btnLogin" />
</form></body></html>`;

const browser = browserName === "firefox"
  ? await launchFirefox()
  : await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true, enableExtensions: true });
const extId = await browser.installExtension(path.resolve(extDir));
await new Promise((r) => setTimeout(r, 2500));
// Optionally run with a theme restyling the login page.
if (process.env.THEME && browserName !== "firefox") {
  const sw = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(extId))).worker();
  await sw.evaluate((theme) => chrome.storage.local.set({ theme }), process.env.THEME);
}

const page = await browser.newPage();
let current = null;
let submitted = null;
await page.setRequestInterception(true);
// A navigation can cancel an intercepted request before it is answered
// (Firefox reports "no such request"); that is the page moving on, not a
// failure.
const settle = (promise) => promise?.catch?.(() => {});
page.on("request", (rawReq) => {
  const req = { url: () => rawReq.url(), continue: () => settle(rawReq.continue()), respond: (r) => settle(rawReq.respond(r)) };
  const url = req.url();
  if (process.env.TRACE && url.includes("cuchd")) console.log("  req", current, url.replace("https://students.cuchd.in", ""));
  if (!url.startsWith("https://students.cuchd.in/")) return req.continue();
  if (/GenerateCaptcha/i.test(url)) return req.respond({ status: 200, contentType: "image/jpeg", body: readFileSync(path.join(CORPUS, current)) });
  if (new URL(url).searchParams.has("txtcaptcha")) {
    submitted = new URL(url).searchParams.get("txtcaptcha");
    return req.respond({ status: 200, contentType: "text/html", body: "<html><body>home</body></html>" });
  }
  if (/StudentHome/i.test(url)) return req.respond({ status: 200, contentType: "text/html", body: "<html><body>home</body></html>" });
  return req.respond({ status: 200, contentType: "text/html", body: PASSWORD_PAGE.replace("?N", `?${Date.now()}`) });
});

let right = 0, filledOnly = 0, missing = 0;
const misses = [];
const t0 = Date.now();
for (const [file, label] of labels) {
  current = file;
  submitted = null;
  // Land on StudentHome between samples: resets the tab's retry budget.
  try {
    await page.goto("https://students.cuchd.in/StudentHome.aspx", { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 150));
    await page.goto("https://students.cuchd.in/Login.aspx", { waitUntil: "domcontentloaded" });
  } catch (error) {
    console.log(`  ${file}: navigation failed (${error.message.split("\n")[0]})`);
  }
  const until = Date.now() + 15000;
  let field = "";
  while (Date.now() < until && submitted === null) {
    await new Promise((r) => setTimeout(r, 100));
    try { field = await page.evaluate(() => document.querySelector("#txtcaptcha")?.value || ""); } catch {}
  }
  const answer = submitted ?? field;
  if (submitted === null && field) filledOnly++;
  if (!answer) missing++;
  if (answer === label) right++;
  else misses.push(`${file} want=${label} got=${answer || "(none)"}${submitted === null ? " [not submitted]" : ""}`);
}
const n = labels.length;
console.log(`${browserName} ${path.basename(path.resolve(extDir, ".."))}/${path.basename(extDir)} [${labelsFile}] exact ${right}/${n} = ${(100 * right / n).toFixed(1)}%  not-submitted ${filledOnly}  no-answer ${missing}  ${((Date.now() - t0) / n).toFixed(0)}ms/sample`);
if (process.env.V) misses.forEach((m) => console.log("  ", m));
await browser.close().catch(() => {});
browser.__kill?.();
process.exit(0);
