// Clicks a popup open button and records every URL the new tab shows, with timing.
import { connect, extensionId } from "./cdp.mjs";
const [which] = process.argv.slice(2);
const browser = await connect();
const EXT = await extensionId(browser);
let popup = (await browser.pages()).find((p) => p.url().includes(`${EXT}/popup.html`));
if (!popup) { popup = await browser.newPage(); await popup.goto(`chrome-extension://${EXT}/popup.html`); } else await popup.reload();
await popup.waitForSelector(".open-link");
const t0 = Date.now();
const seen = [];
browser.on("targetcreated", async (t) => {
  if (t.type() !== "page") return;
  const page = await t.page();
  const note = (u) => seen.push(`${Date.now() - t0}ms ${u.slice(0, 110)}`);
  note(t.url() || "(blank)");
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) note(f.url()); });
  // Did anything paint CUIMS? Check the document once it is interactive.
  page.on("domcontentloaded", async () => {
    try {
      const info = await page.evaluate(() => ({ url: location.href.slice(0, 70), veiled: Boolean(document.getElementById("cuims-clear-lms-cover")), title: document.title.slice(0, 50) }));
      seen.push(`${Date.now() - t0}ms   DOM ready: ${JSON.stringify(info)}`);
    } catch {}
  });
});
await popup.click(which === "lms" ? ".lms-open-link" : ".cuims-open-link");
await new Promise((r) => setTimeout(r, 9000));
console.log(seen.join("\n"));
await browser.disconnect();
