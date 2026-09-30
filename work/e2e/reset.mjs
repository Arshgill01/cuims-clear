import { connect, extensionId, serviceWorker } from "./cdp.mjs";
const browser = await connect();
const EXT = await extensionId(browser);
for (const p of await browser.pages()) if (p.url().includes("/popup.html")) await p.close();
const sw = await serviceWorker(browser, EXT);
console.log(await sw.evaluate(async () => {
  const all = await chrome.storage.local.get(null);
  const drop = Object.keys(all).filter((k) => /^attendance|^bg|^loginTab|^pageLogin|lmsLaunchAt/.test(k));
  await chrome.storage.local.remove(drop);
  return { dropped: drop, kept: Object.keys(await chrome.storage.local.get(null)) };
}));
await browser.disconnect();
