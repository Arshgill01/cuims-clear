import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1180, height: 700, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:8766/my/courses.php", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: new URL(".lms.png", import.meta.url).pathname });
await browser.close();
