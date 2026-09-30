// Live CUIMS pages in several themes, switched live on the open page.
import { connect, extensionId } from "./cdp.mjs";
const [path = "StudentHome.aspx", out, ...themes] = process.argv.slice(2);
const browser = await connect();
const EXT = await extensionId(browser);
let page = (await browser.pages()).find((p) => /students\.cuchd\.in/.test(p.url()));
if (!page) page = await browser.newPage();
await page.setViewport({ width: 1100, height: 760 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
const ext = await browser.newPage();
await ext.goto(`chrome-extension://${EXT}/popup.html`);
const setTheme = (theme) => ext.evaluate((theme) => chrome.storage.local.set({ theme }), theme);
await setTheme("clear");
await page.bringToFront();
// Always load fresh: an extension reload leaves the old content script orphaned.
await page.goto(`https://students.cuchd.in/${path}`, { waitUntil: "domcontentloaded" });
// Wait for sign-in (tab auto-login) and the page's own content.
for (let i = 0; i < 90 && !page.url().includes(path); i++) await new Promise((r) => setTimeout(r, 500));
await new Promise((r) => setTimeout(r, 5000));
const cells = [];
for (const theme of themes) {
  await setTheme(theme);
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now();
  cells.push(`<figure><img src="data:image/png;base64,${await page.screenshot({ encoding: "base64" })}"><figcaption>${theme}</figcaption></figure>`);
}
const sheet = await browser.newPage();
await sheet.setViewport({ width: 2240, height: 800 });
await sheet.setContent(`<style>body{margin:0;background:#888;display:grid;grid-template-columns:repeat(2,1100px);gap:12px;padding:12px;font:13px system-ui}figure{margin:0}img{width:1100px;display:block}figcaption{color:#fff}</style>${cells.join("")}`);
await sheet.screenshot({ path: out, fullPage: true });
await sheet.close();
await ext.close();
console.log("url:", page.url(), "errors:", JSON.stringify(errors.slice(0, 5)));
await browser.disconnect();
