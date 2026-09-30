// Renders the popup (attendance + theme picker) in every theme onto one sheet.
import puppeteer from "puppeteer-core";
import { readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const pkg = path.join(here, ".popup");
rmSync(pkg, { recursive: true, force: true });
cpSync(path.resolve(here, "../../../outputs/cuims-clear-chrome"), pkg, { recursive: true });
cpSync(path.join(here, "demo-chrome.js"), path.join(pkg, "demo-chrome.js"));
// The stub must exist before themes.js runs in <head>.
writeFileSync(path.join(pkg, "popup.html"), readFileSync(path.join(pkg, "popup.html"), "utf8").replace('<script src="themes.js">', '<script src="demo-chrome.js"></script><script src="themes.js">'));
const ids = ["clear", "tokyo-night", "catppuccin", "gruvbox", "rose-pine", "catppuccin-latte", "flexoki-light", "white"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
const shots = [];
for (const view of process.argv.slice(2).length ? process.argv.slice(2) : ["attendance"]) {
  for (const id of ids) {
    await page.setViewport({ width: 368, height: 620, deviceScaleFactor: 1 });
    await page.goto(`file://${pkg}/popup.html?view=${view}&theme=${id}&plan=23CSH303@780`);
    await new Promise((r) => setTimeout(r, 350));
    shots.push({ id, view, data: (await page.screenshot({ encoding: "base64" })) });
  }
}
const cells = shots.map((s) => `<figure><img src="data:image/png;base64,${s.data}"><figcaption>${s.id} · ${s.view}</figcaption></figure>`).join("");
await page.setViewport({ width: 4 * 380, height: 800, deviceScaleFactor: 1 });
await page.setContent(`<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(4,368px);gap:12px;padding:12px;font:12px system-ui}figure{margin:0}img{display:block;border-radius:6px}figcaption{color:#fff;padding:4px 0}</style>${cells}`);
await page.screenshot({ path: path.join(here, `.themes-${process.argv[2] || "attendance"}.png`), fullPage: true });
await browser.close();
