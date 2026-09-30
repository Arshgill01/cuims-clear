// Renders the demo popup (both tabs), then composes 1280x800 store shots.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(here, "..");
const pkg = path.join(here, ".popup");
rmSync(pkg, { recursive: true, force: true });
cpSync(path.resolve(here, "../../../outputs/cuims-clear-chrome"), pkg, { recursive: true });
cpSync(path.join(here, "demo-chrome.js"), path.join(pkg, "demo-chrome.js"));
writeFileSync(path.join(pkg, "popup.html"), readFileSync(path.join(pkg, "popup.html"), "utf8").replace("<script", '<script src="demo-chrome.js"></script><script'));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
const variants = { attendance: "view=attendance", login: "view=login", ...(process.env.PREVIEW ? { planned: "view=attendance&plan=23CSH303@780", strict: "view=attendance&goal=strict" } : {}) };
for (const [name, query] of Object.entries(variants)) {
  await page.setViewport({ width: 368, height: 760, deviceScaleFactor: 2 });
  await page.goto(`file://${pkg}/popup.html?${query}`);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(here, `.popup-${name}.png`), fullPage: true });
}
const shots = process.argv.slice(2);
for (const name of shots) {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(here, name)}.html`);
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log("wrote", `${name}.png`);
}
await browser.close();
