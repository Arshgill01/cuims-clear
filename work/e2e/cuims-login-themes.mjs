// The live CUIMS login page (public) in several themes, with the real package.
import puppeteer from "puppeteer-core";
import path from "node:path";
const [ext, out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true, enableExtensions: true });
const id = await browser.installExtension(path.resolve(ext));
const sw = await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id))).worker();
// No saved login: the extension only restyles, it cannot submit anything.
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const cells = [];
for (const theme of ["clear", "tokyo-night", "gruvbox", "catppuccin-latte"]) {
  await sw.evaluate((theme) => chrome.storage.local.set({ theme, autoAdvanceUid: false }), theme);
  await page.setViewport({ width: 900, height: 620 });
  await page.goto("https://students.cuchd.in/", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1200));
  cells.push(`<figure><img src="data:image/png;base64,${await page.screenshot({ encoding: "base64" })}"><figcaption>${theme}</figcaption></figure>`);
}
await page.setViewport({ width: 1840, height: 1300 });
await page.setContent(`<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(2,900px);gap:12px;padding:12px;font:13px system-ui}figure{margin:0}img{width:900px;display:block}figcaption{color:#fff}</style>${cells.join("")}`);
await page.screenshot({ path: out, fullPage: true });
console.log("errors:", JSON.stringify(errors));
await browser.close();
