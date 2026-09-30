// Helpers for driving the long-lived debug Chrome on :9333.
import puppeteer from "puppeteer-core";
export const EXT_DIR = new URL("../../outputs/cuims-clear-chrome", import.meta.url).pathname;
export async function connect() {
  return puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null, protocolTimeout: 120000 });
}
export async function loadExtension(browser) {
  const session = await browser.target().createCDPSession();
  const { id } = await session.send("Extensions.loadUnpacked", { path: EXT_DIR });
  return id;
}
export async function serviceWorker(browser, id) {
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().startsWith(`chrome-extension://${id}/`), { timeout: 15000 });
  return target.worker();
}

// The loaded extension's id (it depends on the folder it was loaded from).
export async function extensionId(browser) {
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && /service-worker\.js$/.test(t.url()), { timeout: 15000 });
  return new URL(target.url()).host;
}
