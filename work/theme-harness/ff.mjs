// Firefox run of the same replica: headless Firefox over WebDriver BiDi, the
// unpacked add-on installed into a throwaway profile.
// usage: node ff.mjs <extensionDir> <themeId> [page]
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import path from "node:path";

const [extDir, themeId = "gruvbox", page = "marks"] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const URL_ = "https://students.cuchd.in/frmStudentMarksView.aspx";
const UUID = "6f1c9a2e-3b7d-4c55-9e0a-1d2b3c4d5e6f";

const browser = await puppeteer.launch({
  browser: "firefox",
  executablePath: "/Applications/Firefox.app/Contents/MacOS/firefox",
  headless: true,
  extraPrefsFirefox: { "extensions.webextensions.uuids": JSON.stringify({ "cuims-clear@arshgill01": UUID }) },
});
await browser.installExtension(extDir);
const tab = await browser.newPage();
await new Promise((done) => setTimeout(done, 800));

await tab.setRequestInterception(true);
tab.on("request", async (request) => {
  const url = request.url();
  if (url === URL_) return request.respond({ contentType: "text/html", body: readFileSync(path.join(here, `${page}.html`), "utf8") });
  if (url.includes("/__fixture/late.css")) {
    await new Promise((done) => setTimeout(done, 400));
    return request.respond({ contentType: "text/css", body: ".late-card{background:#fff;color:#333;padding:10px;border:1px solid #ccc}" });
  }
  if (/^https:\/\/students\.cuchd\.in\//.test(url) && !/\.(css|js|png|gif|jpg|woff2?|ttf|svg)(\?|$)/.test(url)) return request.respond({ status: 204, body: "" });
  return request.continue();
});
await tab.evaluateOnNewDocument(() => {
  window.__visibleAt = null;
  const t0 = performance.now();
  const tick = () => {
    if (document.body && getComputedStyle(document.body).opacity !== "0" && window.__visibleAt == null) window.__visibleAt = Math.round(performance.now() - t0);
    if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await tab.goto(URL_, { waitUntil: "load" });
await new Promise((done) => setTimeout(done, 3500));

const report = await tab.evaluate(() => {
  const parse = (v) => {
    const m = String(v).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255 };
  };
  const name = (el) => `${el.tagName}#${el.id}.${String(el.className).slice(0, 40)}`;
  const light = [];
  const unreadable = [];
  for (const el of document.querySelectorAll("html, body, body *")) {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (cs.display === "none" || !box.width || !box.height) continue;
    const own = parse(cs.backgroundColor);
    if (el.tagName !== "IMG" && own && own.a > 0.5 && lum(own) > 0.6 && box.width * box.height > 1500) light.push([name(el), cs.backgroundColor]);
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = ratio(parse(cs.color), bgOf(el));
    if (r < 4.5) unreadable.push([name(el), el.textContent.trim().slice(0, 30), cs.color, r.toFixed(2)]);
  }
  const link = document.querySelector("#top a");
  return {
    accordion: document.querySelectorAll(".ui-accordion-header").length,
    eased: getComputedStyle(link).transitionProperty.slice(0, 80),
    light,
    unreadable,
    visibleAt: window.__visibleAt,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
});
console.log(JSON.stringify({ browser: await browser.version(), themeId, page, ...report }, null, 1));
await browser.close();
