// Opens the real toolbar popup and clicks one of its controls.
import { connect, extensionId } from "./cdp.mjs";
const [action] = process.argv.slice(2);
const browser = await connect();
const EXT = await extensionId(browser);
// The popup UI, loaded as a page (the toolbar popup needs a focused window).
let popup = (await browser.pages()).find((p) => p.url().includes(`${EXT}/popup.html`));
if (!popup) {
  popup = await browser.newPage();
  await popup.goto(`chrome-extension://${EXT}/popup.html`);
} else {
  await popup.reload();
}
await popup.waitForSelector(".open-link");
const selectors = { cuims: ".cuims-open-link", lms: ".lms-open-link", attendance: "#tab-attendance", refresh: "#fetch-attendance" };
if (action === "refresh") { await popup.click("#tab-attendance"); await popup.waitForSelector("#fetch-attendance"); }
const t = Date.now();
await popup.click(selectors[action]);
// Watch the button label while the popup lives.
let lastLabel = "";
while (Date.now() - t < 60000) {
  let label;
  try { label = await popup.evaluate((sel) => document.querySelector(sel)?.textContent.trim() + " | " + (document.querySelector(".attendance-note, .attendance-error, .attendance-info")?.textContent || ""), selectors[action]); }
  catch { console.log(`popup closed after ${Date.now() - t}ms`); break; }
  if (label !== lastLabel) { console.log(`${Date.now() - t}ms popup: ${label}`); lastLabel = label; }
  await new Promise((r) => setTimeout(r, 200));
}
await browser.disconnect();
