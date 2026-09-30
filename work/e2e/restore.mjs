import { connect, extensionId } from "./cdp.mjs";
const browser = await connect();
const EXT = await extensionId(browser);
const page = (await browser.pages()).find((p) => /StudentHome/.test(p.url()));
const ext = await browser.newPage();
await ext.goto(`chrome-extension://${EXT}/popup.html`);
const state = () => page.evaluate(() => ({
  painted: document.querySelectorAll("[style*='!important']").length,
  style: Boolean(document.getElementById("cc-cuims-theme")),
  body: getComputedStyle(document.body).backgroundColor,
}));
const set = (values) => ext.evaluate((values) => chrome.storage.local.set(values), values);
await set({ theme: "tokyo-night", themeCuims: true });
await new Promise((r) => setTimeout(r, 1500));
console.log("tokyo-night, on:  ", JSON.stringify(await state()));
await set({ themeCuims: false });
await new Promise((r) => setTimeout(r, 1500));
console.log("switch off:       ", JSON.stringify(await state()));
await set({ themeCuims: true });
await new Promise((r) => setTimeout(r, 1500));
console.log("switch on again:  ", JSON.stringify(await state()));
await set({ theme: "clear" });
await new Promise((r) => setTimeout(r, 1500));
console.log("default theme:    ", JSON.stringify(await state()));
await ext.close();
await browser.disconnect();
