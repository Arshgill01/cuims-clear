import puppeteer from "puppeteer-core";
import path from "node:path";
const ext = path.resolve(process.argv[2]);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true, enableExtensions: true });
const id = await browser.installExtension(ext);
const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(id));
const worker = await target.worker();
const errors = [];
worker.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const out = await worker.evaluate(async () => {
  const results = {};
  for (const theme of CuimsThemes.list.map((entry) => entry.id)) {
    await chrome.storage.local.set({ theme });
    await new Promise((r) => setTimeout(r, 150));
    const img = CuimsThemes.drawIcon(32, theme);
    // Sample the icon's corner (brand background) and a bar pixel (brand ink).
    const px = (x, y) => Array.from(img.data.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)).map((v) => v.toString(16).padStart(2, "0")).join("");
    results[theme] = { bg: `#${px(16, 4)}`, bar: `#${px(13, 16)}`, want: [CuimsThemes.tokens(theme).brandBg, CuimsThemes.tokens(theme).brandInk] };
  }
  await chrome.storage.local.set({ theme: "clear" });
  return results;
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(`chrome-extension://${id}/popup.html`);
await page.click("#tab-theme");
await page.waitForSelector("[data-theme-id='gruvbox']");
await page.click("[data-theme-id='gruvbox']");
await new Promise((r) => setTimeout(r, 300));
const applied = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, canvas: getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim(), checked: document.querySelector("[aria-checked='true']")?.dataset.themeId, stored: null }));
applied.stored = (await worker.evaluate(() => chrome.storage.local.get("theme"))).theme;
await page.reload();
await new Promise((r) => setTimeout(r, 300));
applied.afterReload = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, view: document.querySelector("#tab-theme").getAttribute("aria-selected") }));
for (const [theme, r] of Object.entries(out)) console.log(theme.padEnd(17), "icon bg", r.bg, "want", r.want[0], "| bar", r.bar, "want", r.want[1]);
console.log("popup:", JSON.stringify(applied));
console.log("errors:", JSON.stringify([...errors, ...pageErrors]));
await browser.close();
