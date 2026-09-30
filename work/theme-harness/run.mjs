// Loads an unpacked Chrome build in headless Chromium, serves a CUIMS page
// replica at its real URL, and reports (1) light blocks and unreadable text
// once the page settles, (2) frames painted with light blocks before the theme.
// usage: node run.mjs <extensionDir> <themeId> [page]
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [extDir, themeId = "gruvbox", page = "marks"] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const PAGES = { marks: "https://students.cuchd.in/frmStudentMarksView.aspx", big: "https://students.cuchd.in/frmStudentMarksView.aspx" };

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "cc-")), {
  headless: false,
  executablePath: process.env.CHROME_BIN,
  args: ["--headless=new", `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1280, height: 900 },
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent("serviceworker");
await worker.evaluate((id) => chrome.storage.local.set({ theme: id, themeCuims: true }), themeId);

await context.route("https://students.cuchd.in/**", async (route) => {
  const url = route.request().url();
  if (url === PAGES[page]) return route.fulfill({ contentType: "text/html", body: readFileSync(path.join(here, `${page}.html`), "utf8") });
  if (url.includes("/__fixture/late.css")) {
    await new Promise((done) => setTimeout(done, 400));
    return route.fulfill({ contentType: "text/css", body: ".late-card{background:#fff;color:#333;padding:10px;border:1px solid #ccc}" });
  }
  if (/\.(css|js|png|gif|jpg|woff2?|ttf|svg)(\?|$)/.test(url)) return route.continue();
  return route.fulfill({ status: 204, body: "" });
});

// Frame sampler, from document start: any visible, sizeable light block.
await context.addInitScript(() => {
  window.__frames = [];
  window.__long = [];
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true }); } catch {}
  const lum = (v) => {
    const m = String(v).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (a < 0.5) return null;
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const t0 = performance.now();
  const tick = () => {
    const body = document.body;
    if (body && getComputedStyle(body).opacity !== "0") {
      let light = 0;
      for (const el of [body, ...body.querySelectorAll("div,h3,table,tr,td,p,section")]) {
        const box = el.getBoundingClientRect();
        if (box.width * box.height < 1500 || box.bottom < 0 || box.top > innerHeight) continue;
        const l = lum(getComputedStyle(el).backgroundColor);
        if (l != null && l > 0.6) light += 1;
      }
      const fading = document.getAnimations().filter((a) => /color/.test(a.transitionProperty || "")).length;
      window.__frames.push({ t: Math.round(performance.now() - t0), light, fading });
    }
    if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const tab = await context.newPage();
const errors = [];
tab.on("pageerror", (error) => errors.push(String(error)));
tab.on("console", (msg) => (msg.type() === "error" || /CCDBG/.test(msg.text())) && errors.push(msg.text()));
const started = Date.now();
await tab.goto(PAGES[page], { waitUntil: "load" });
await tab.waitForTimeout(3500);

if (process.env.DEBUG) console.log(JSON.stringify(await tab.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => { const chain = []; for (let n = el; n; n = n.parentElement) chain.push(`${n.tagName}.${String(n.className).slice(0, 20)} bg=${getComputedStyle(n).backgroundColor} c=${getComputedStyle(n).color} inline=${n.getAttribute("style") || ""}`.slice(0, 260)); return chain; }), process.env.DEBUG), null, 1));
if (process.env.SWITCH) {
  for (const id of process.env.SWITCH.split(",")) {
    await worker.evaluate((next) => chrome.storage.local.set({ theme: next }), id);
    await tab.waitForTimeout(400);
    await tab.hover("#ui-accordion-accordion-header-1");
    await tab.waitForTimeout(150);
    const state = await tab.evaluate(() => ({
      inlineImportant: [...document.querySelectorAll("*")].filter((el) => /!important/.test(el.getAttribute("style") || "")).length,
      transitions: [...document.querySelectorAll("*")].filter((el) => /color 0s/.test(el.getAttribute("style") || "")).length,
      cloak: document.documentElement.hasAttribute("data-cc-cloak"),
      style: !!document.getElementById("cc-cuims-theme"),
      hoverBg: getComputedStyle(document.querySelector("#ui-accordion-accordion-header-1")).backgroundColor,
      hoverCls: document.querySelector("#ui-accordion-accordion-header-1").className.includes("hover"),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }));
    console.log("SWITCH", id, JSON.stringify(state));
    await tab.mouse.move(5, 5);
  }
}
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
  const frames = window.__frames;
  const firstVisible = frames[0]?.t ?? null;
  return { elements: document.querySelectorAll("*").length, longTasks: window.__long, light, unreadable, flashFrames: frames.filter((f) => f.light > 0).length, fadeFrames: frames.filter((f) => f.fading > 0).length, maxFading: Math.max(0, ...frames.map((f) => f.fading)), frames: frames.length, firstVisible };
});
console.log(JSON.stringify({ ext: path.basename(path.dirname(extDir)) + "/" + path.basename(extDir), themeId, page, ms: Date.now() - started, ...report, errors }, null, 1));
await context.close();
