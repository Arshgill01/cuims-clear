// Screenshots the extension popup's Attendance tab in the debug Chrome.
import { connect, extensionId } from "./cdp.mjs";

const browser = await connect();
const EXT = await extensionId(browser);
const page = await browser.newPage();
await page.setViewport({ width: 368, height: 900, deviceScaleFactor: 2 });
await page.goto(`chrome-extension://${EXT}/popup.html`);
await page.click("#tab-attendance");
await new Promise((resolve) => setTimeout(resolve, 1200));
await page.screenshot({ path: process.argv[2], fullPage: true });
await page.close();
await browser.disconnect();
