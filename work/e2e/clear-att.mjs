// Clears attendance state (keeps login + report ids unless told otherwise).
import { connect, extensionId, serviceWorker } from "./cdp.mjs";
const dropIds = process.argv.includes("--ids");
const browser = await connect();
const EXT = await extensionId(browser);
const sw = await serviceWorker(browser, EXT);
await sw.evaluate(async (dropIds) => {
  const all = await chrome.storage.local.get(null);
  const drop = Object.keys(all).filter((k) => /^attendance(?!Meta$)|^bg|^loginTab|^pageLogin|lmsLaunchAt|loginGuard/.test(k) || (dropIds && k === "attendanceMeta"));
  await chrome.storage.local.remove(drop);
}, dropIds);
await browser.disconnect();
