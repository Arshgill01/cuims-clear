import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
const shots = [];
for (const id of ["tokyo-night", "gruvbox", "flexoki-light", "white"]) {
  await page.setViewport({ width: 900, height: 520 });
  await page.goto(`http://127.0.0.1:8766/my/courses.php?theme=${id}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
  shots.push(`<figure><img src="data:image/png;base64,${await page.screenshot({ encoding: "base64" })}"><figcaption>${id}</figcaption></figure>`);
}
await page.setViewport({ width: 1840, height: 900 });
await page.setContent(`<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(2,900px);gap:12px;padding:12px;font:13px system-ui}figure{margin:0}img{display:block;width:900px}figcaption{color:#fff}</style>${shots.join("")}`);
await page.screenshot({ path: new URL(".lms-themes.png", import.meta.url).pathname, fullPage: true });
await browser.close();
