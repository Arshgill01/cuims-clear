import { connect, loadExtension } from "./cdp.mjs";
const browser = await connect();
const id = await loadExtension(browser);
console.log("extension id", id);
const page = await browser.newPage();
await page.goto(`chrome-extension://${id}/popup.html`);
await browser.disconnect();
