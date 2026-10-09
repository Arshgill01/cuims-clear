// Hunts UI glitches in the real popup at its real size (440x600), in Chrome
// or Firefox, across every scenario in popup-stub.mjs and every theme:
//   - nothing pokes outside the frame that clips it; chart labels never
//     collide or leave the chart; the crosshair label stays in its card
//   - a redraw (half-minute tick, background update, Refresh coming back)
//     keeps the scroll position, open sections and focus, and never scrolls
//   - every planner, subject and calendar control works by mouse and keys
//   - text contrast in every theme, tap targets, smallest text
//   node work/e2e/forecast-glitches.mjs <chrome|firefox> [package dir]
// Writes a JSON report and failure screenshots to work/e2e/results/glitches/.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { launchBrowser } from "./browser-launch.mjs";
import { preparePopup, scenarios } from "./popup-stub.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const name = process.argv[2] || "chrome";
const source = path.resolve(process.argv[3] || path.join(here, "../../outputs/cuims-clear-firefox"));
const out = path.join(here, "results/glitches", name);
mkdirSync(out, { recursive: true });
const pkg = preparePopup(source, path.join(here, "results/glitches/.popup"));

// In-page checks, installed into every page as window.__glitch.
function checks() {
  const describe = (el) => {
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal || "";
    const data = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).join("");
    return `${el.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join(".")}` : ""}${data} "${(el.textContent || "").trim().slice(0, 30)}"`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
    }
    return true;
  };
  // The nearest ancestor that clips horizontally (or vertically).
  const clipper = (el, axis) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const value = axis === "x" ? cs.overflowX : cs.overflowY;
      if (/hidden|clip|auto|scroll/.test(value)) return node;
    }
    return document.documentElement;
  };
  function overflow(root) {
    const issues = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cx = clipper(el, "x").getBoundingClientRect();
      if (r.left < cx.left - 1 || r.right > cx.right + 1) issues.push(`out of frame (x): ${describe(el)} ${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(cx.left)}–${Math.round(cx.right)}`);
      const yc = clipper(el, "y");
      if (!/auto|scroll/.test(getComputedStyle(yc).overflowY)) {
        const cy = yc.getBoundingClientRect();
        if (r.top < cy.top - 1 || r.bottom > cy.bottom + 1) issues.push(`out of frame (y): ${describe(el)}`);
      }
      // Text cut without an ellipsis.
      const cs = getComputedStyle(el);
      if (el.classList.contains("sr-only")) continue;
      if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis") issues.push(`text cut: ${describe(el)}`);
    }
    return issues;
  }
  function svgText(root) {
    const issues = [];
    for (const svg of root.querySelectorAll("svg.fc-svg")) {
      const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
      const boxes = [...svg.querySelectorAll("text")].map((t) => ({ t, b: t.getBBox() }));
      for (const { t, b } of boxes) {
        if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > w + 0.5 || b.y + b.height > h + 0.5) issues.push(`svg label leaves chart: "${t.textContent}"`);
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i].b;
          const b = boxes[j].b;
          const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (ix > 1 && iy > 1) issues.push(`svg labels collide: "${boxes[i].t.textContent}" / "${boxes[j].t.textContent}"`);
        }
      }
    }
    return issues;
  }
  const parse = (value) => {
    let m = value.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4])];
    m = value.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] == null ? 1 : Number(m[4])];
    return null;
  };
  const blend = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  function background(el) {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] > 0) layers.push(bg);
      if (bg && bg[3] >= 1) break;
    }
    let color = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    for (const layer of layers.reverse()) color = blend(layer, color);
    return color;
  }
  function contrast(root) {
    const issues = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg") || el.closest("[aria-hidden='true']") || el.disabled || el.closest(":disabled")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || !visible(el)) continue;
      const cs = getComputedStyle(el);
      let fg = parse(cs.color);
      if (!fg) continue;
      let opacity = 1;
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const bg = background(el);
      fg = blend([fg[0], fg[1], fg[2], fg[3] * opacity], bg);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const value = ratio(fg, bg);
      if (value < (large ? 3 : 4.5) - 0.05) issues.push(`contrast ${value.toFixed(2)}: ${describe(el)}`);
    }
    return issues;
  }
  function targets(root) {
    const issues = [];
    for (const el of root.querySelectorAll("button, a, summary, [tabindex='0']")) {
      if (!visible(el) || el.closest(".fc-legend")) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 24 - 0.5 || r.width < 24 - 0.5) issues.push(`small target ${Math.round(r.width)}x${Math.round(r.height)}: ${describe(el)}`);
    }
    return issues;
  }
  function tiny(root) {
    const sizes = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own && visible(el) && parseFloat(getComputedStyle(el).fontSize) < 10) sizes.push(`${getComputedStyle(el).fontSize}: ${describe(el)}`);
    }
    return sizes;
  }
  window.__glitch = { overflow, svgText, contrast, targets, tiny, describe };
}

const browser = await launchBrowser(name);
const page = await browser.newPage();
await page.setViewport({ width: 440, height: 600, deviceScaleFactor: 1 });
const report = { browser: name, failures: [], notes: [] };
let pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => message.type() === "error" && pageErrors.push(message.text()));
const settle = (ms = 120) => new Promise((done) => setTimeout(done, ms));
let shot = 0;

async function open(query) {
  pageErrors = [];
  await page.goto(`file://${pkg}/popup.html?${query}`);
  await page.evaluate(checks);
  await settle(250);
}

async function fail(where, issues) {
  if (!issues.length) return;
  const file = `fail-${String(++shot).padStart(3, "0")}.png`;
  await page.screenshot({ path: path.join(out, file) });
  report.failures.push({ where, issues: [...new Set(issues)].slice(0, 12), screenshot: file });
}

// Geometry of the current view, scrolled through top to bottom.
async function geometry(where, { contrast = true } = {}) {
  const found = await page.evaluate((contrast) => {
    const view = document.querySelector(".view:not([hidden])");
    const views = document.querySelector(".views");
    const issues = [];
    for (let top = 0; ; top += views.clientHeight - 40) {
      views.scrollTop = top;
      issues.push(...__glitch.overflow(document.querySelector(".app")), ...__glitch.svgText(view));
      if (contrast) issues.push(...__glitch.contrast(document.querySelector(".app")));
      if (top + views.clientHeight >= views.scrollHeight) break;
    }
    views.scrollTop = 0;
    return issues;
  }, contrast);
  await fail(where, [...found, ...pageErrors]);
}

// The crosshair label stays inside its card and off the big figure.
async function crosshair(where) {
  const charts = await page.$$(".fc-chart");
  for (const chart of charts) {
    await chart.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const box = await chart.boundingBox();
    if (!box) continue;
    const issues = [];
    for (let step = 0; step <= 20; step += 1) {
      await page.mouse.move(box.x + 1 + ((box.width - 2) * step) / 20, box.y + box.height * (step % 2 ? 0.25 : 0.75));
      const problem = await chart.evaluate((node) => {
        const tip = node.querySelector(".fc-tip");
        if (tip.hidden) return "label did not show";
        const t = tip.getBoundingClientRect();
        const card = node.closest(".fc-hero, .fc-subject, .fc-card").getBoundingClientRect();
        const f = node.getBoundingClientRect();
        if (t.left < f.left - 0.5 || t.right > f.right + 0.5 || t.top < f.top - 0.5 || t.bottom > f.bottom + 0.5) return `label leaves the chart at ${Math.round(t.left)}–${Math.round(t.right)}`;
        if (t.left < card.left || t.right > card.right) return "label leaves the card";
        const big = node.closest(".fc-hero")?.querySelector(".fc-big")?.getBoundingClientRect();
        if (big && t.top < big.bottom && t.bottom > big.top && t.left < big.right && t.right > big.left) return "label covers the big figure";
        return "";
      });
      if (problem) issues.push(`${problem} (step ${step})`);
    }
    await page.mouse.move(0, 0);
    await fail(`${where}: crosshair`, issues);
  }
  // Keys walk it too.
  const keys = await page.evaluate(() => {
    const chart = document.querySelector(".fc-hero .fc-chart");
    if (!chart) return "";
    chart.focus({ preventScroll: true });
    for (const key of ["Home", "ArrowRight", "End", "ArrowLeft"]) chart.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return chart.querySelector(".fc-tip").hidden ? "keys do not move the crosshair" : "";
  });
  if (keys) await fail(`${where}: crosshair keys`, [keys]);
}

// A redraw keeps scroll, open sections and focus, and never scrolls.
async function stability(where) {
  const issues = await page.evaluate(async () => {
    const problems = [];
    const views = document.querySelector(".views");
    const method = () => document.querySelector(".fc-method");
    const tick = () => new Promise((done) => setTimeout(done, 30));
    if (!method()) return problems;
    method().open = true;
    // The block read at mid-page must not move on screen; at the very bottom
    // the browser may pull up only as far as content above shrank.
    const anchor = () => [...document.querySelector(".view:not([hidden])").children].find((node) => node.getBoundingClientRect().bottom > views.getBoundingClientRect().top + 1);
    for (const [label, focus] of [["Refresh", "[data-action='refresh']"], ["chart", ".fc-hero .fc-chart"], ["a subject", "[data-subject]"], ["nothing", null]]) {
      for (const at of ["middle", "bottom"]) {
        views.scrollTop = at === "middle" ? (views.scrollHeight - views.clientHeight) / 2 : views.scrollHeight;
        const block = anchor();
        const label = (node) => `${node.tagName}|${node.getAttribute("aria-label") || node.className}`;
        const name = label(block);
        const before = block.getBoundingClientRect().top;
        if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
        // The half-minute tick, a background update, Refresh coming back.
        paintForecast();
        __fire({ attendanceStatus: { newValue: { working: true, phase: "Reading attendance…", at: Date.now() } } });
        await tick();
        __fire({ attendanceStatus: { newValue: { working: false, at: Date.now() } }, attendanceLastAttemptAt: { newValue: Date.now() - 61_000 } });
        attendance.nextRefreshAt = 0;
        paintForecast();
        await tick();
        const same = [...document.querySelector(".view:not([hidden])").children].find((node) => label(node) === name);
        const after = same?.getBoundingClientRect().top;
        const atEnd = views.scrollTop + views.clientHeight >= views.scrollHeight - 1;
        if (after == null || (Math.abs(after - before) > 1 && !(at === "bottom" && atEnd && after > before))) problems.push(`redraw with ${label} focused (${at}) moved ${name} ${Math.round(before)} → ${Math.round(after)}`);
        if (!method()?.open) problems.push(`redraw with ${label} focused closed "How the forecast works"`);
      }
    }
    views.scrollTop = 0;
    return problems;
  });
  await fail(`${where}: redraw`, issues);
}

// Every planner day and class, the whole day, clearing; each subject.
async function interactions(where) {
  const days = await page.$$eval("[data-plan-day]", (nodes) => nodes.map((n) => n.dataset.planDay));
  for (const day of days) {
    await page.click(`[data-plan-day="${day}"]`);
    await settle(40);
    const classes = await page.$$eval("[data-plan-key]", (nodes) => nodes.map((n) => n.dataset.planKey));
    for (const key of classes) {
      const was = await page.$eval(`[data-plan-key="${key}"]`, (node) => node.getAttribute("aria-pressed"));
      await page.$eval(`[data-plan-key="${key}"]`, (node) => node.click());
      await settle(30);
      const problem = await page.evaluate((key, was) => {
        const row = document.querySelector(`[data-plan-key="${CSS.escape(key)}"]`);
        const now = row?.getAttribute("aria-pressed");
        if (now === was) return `tapping ${key} did not toggle it`;
        if (now === "true" && !document.querySelector(".fc-impact")) return `no impact panel for ${key}`;
        if (now === "true" && !/planned skip/.test(document.querySelector(".fc-eyebrow")?.textContent || "")) return "hero does not mention the plan";
        return "";
      }, key, was);
      if (problem) await fail(`${where}: plan ${day}`, [problem]);
      await geometry(`${where}: plan ${key}`, { contrast: false });
      await page.$eval(`[data-plan-key="${key}"]`, (node) => node.click());
      await settle(30);
    }
    const whole = await page.$("[data-plan-whole]");
    if (whole) {
      await whole.evaluate((node) => node.click());
      await settle(40);
      await geometry(`${where}: whole ${day}`, { contrast: false });
      const cleared = await page.evaluate(() => {
        document.querySelector("[data-plan-clear='day']")?.click();
        return document.querySelectorAll("[data-plan-key][aria-pressed='true']").length;
      });
      if (cleared) await fail(`${where}: clear ${day}`, ["clearing the day left planned classes"]);
    }
  }
  const subjects = await page.$$eval("[data-subject]", (nodes) => nodes.map((n) => n.dataset.subject));
  for (const code of subjects) {
    await page.$eval(`[data-subject="${code}"]`, (node) => node.click());
    await settle(40);
    const open = await page.$eval(`[data-subject="${code}"]`, (node) => node.getAttribute("aria-expanded"));
    if (open !== "true") await fail(`${where}: subject ${code}`, ["did not open"]);
    await geometry(`${where}: subject ${code}`, { contrast: false });
    await page.$eval(`[data-subject="${code}"]`, (node) => node.click());
    await settle(30);
  }
}

// The last-day calendar: inside the popup, mouse and keys.
async function calendar(where) {
  const issues = [];
  // The week buttons move the day a week either way, from the estimate too.
  const steps = await page.evaluate(() => {
    const label = () => document.querySelector("[data-cal-toggle]").textContent.trim();
    const start = label();
    document.querySelector("[data-end-step='7']").click();
    const later = label();
    const stored = __stored.forecastEnd;
    document.querySelector("[data-end-step='-7']").click();
    return { start, later, back: label(), stored };
  });
  if (steps.later === steps.start || !steps.stored) issues.push(`a week later did nothing (${steps.start} → ${steps.later})`);
  if (steps.back !== steps.start) issues.push(`a week back did not return (${steps.later} → ${steps.back})`);
  await page.$eval("[data-end-reset]", (node) => node.click()).catch(() => {});
  await settle(40);
  await page.$eval("[data-cal-toggle]", (node) => node.click());
  await settle(80);
  const opened = await page.evaluate(() => {
    const cal = document.querySelector(".fc-cal");
    if (!cal) return "calendar did not open";
    const r = cal.getBoundingClientRect();
    const v = document.querySelector(".views").getBoundingClientRect();
    if (r.top < v.top - 1 || r.bottom > v.bottom + 1 || r.left < v.left || r.right > v.right) return `calendar not fully in view: ${Math.round(r.top)}–${Math.round(r.bottom)} in ${Math.round(v.top)}–${Math.round(v.bottom)}`;
    if (!document.activeElement?.matches("[data-cal-day]")) return "focus did not move to a day";
    return "";
  });
  if (opened) issues.push(opened);
  if (!opened) {
    const before = await page.evaluate(() => document.activeElement.dataset.calDay);
    await page.keyboard.press("ArrowRight");
    await settle(40);
    const after = await page.evaluate(() => document.activeElement?.dataset?.calDay);
    if (!after || after <= before) issues.push(`ArrowRight moved ${before} → ${after}`);
    await page.keyboard.press("PageDown");
    await settle(40);
    const month = await page.evaluate(() => document.activeElement?.dataset?.calDay || "");
    if (month.slice(0, 7) <= after.slice(0, 7)) issues.push("PageDown did not change month");
    await page.keyboard.press("Enter");
    await settle(60);
    const picked = await page.evaluate(() => ({ cal: Boolean(document.querySelector(".fc-cal")), end: __stored.forecastEnd, focus: document.activeElement?.matches("[data-cal-toggle]") }));
    if (picked.cal) issues.push("picking a day did not close the calendar");
    if (picked.end !== month) issues.push(`picked ${month}, stored ${picked.end}`);
    if (!picked.focus) issues.push("focus did not return to the date");
    await page.$eval("[data-cal-toggle]", (node) => node.click());
    await settle(60);
    await geometry(`${where}: calendar open`);
    await page.keyboard.press("Escape");
    await settle(60);
    if (await page.$(".fc-cal")) issues.push("Escape did not close");
    await page.$eval("[data-end-reset]", (node) => node.click()).catch(() => issues.push("no way back to the estimate"));
    await settle(40);
    if ((await page.evaluate(() => __stored.forecastEnd)) !== "") issues.push("Use estimate did not clear the day");
  }
  await fail(`${where}: calendar`, issues);
}

const all = Object.keys(scenarios());
const only = process.env.SCENARIOS ? process.env.SCENARIOS.split(",") : all;
for (const scenario of only) {
  for (const goal of ["standard", "strict"]) {
    if (goal === "strict" && !["default", "struggling"].includes(scenario)) continue;
    const where = `${scenario}${goal === "strict" ? " (strict)" : ""}`;
    await open(`scenario=${scenario}&goal=${goal}`);
    await geometry(`${where}: forecast`);
    if (scenario === "empty") continue;
    await crosshair(where);
    await stability(where);
    if (["default", "planned", "long-titles", "odd-subjects", "struggling", "sunday"].includes(scenario) && goal === "standard") await interactions(where);
    if (["default", "far-end", "classes-over"].includes(scenario) && goal === "standard") await calendar(where);
    // The rest of the popup, same data.
    for (const view of ["attendance", "login", "theme", "settings"]) {
      if (scenario !== "default" && view !== "attendance") continue;
      await page.click(`#tab-${view}`);
      await settle(80);
      await geometry(`${where}: ${view} tab`);
    }
    // Nothing above may read CUIMS: only Refresh does, once per press.
    const reads = () => page.evaluate(() => __sent.filter((type) => type === "cuims-clear:attendance-refresh").length);
    if (await reads()) await fail(`${where}: refresh-only`, [`${await reads()} attendance reads without a Refresh press`]);
    await page.click("#tab-forecast");
    await settle(60);
    const button = await page.$("[data-action='refresh']:not(:disabled)");
    if (button) {
      await button.click();
      await settle(60);
      if ((await reads()) !== 1) await fail(`${where}: refresh-only`, [`Refresh sent ${await reads()} reads`]);
    }
  }
}

// Every theme: contrast and frame on Forecast and Attendance.
const themes = ["clear", "tokyo-night", "catppuccin", "gruvbox", "everforest", "kanagawa", "nord", "osaka-jade", "retro-82", "matte-black", "solitude", "ristretto", "ethereal", "lumon", "hackerman", "last-horizon", "miasma", "catppuccin-latte", "flexoki-light", "rose-pine"];
for (const theme of process.env.SCENARIOS ? [] : themes) {
  for (const scenario of ["default", "struggling"]) {
    await open(`scenario=${scenario}&theme=${theme}`);
    await geometry(`${theme} ${scenario}: forecast`);
    await page.$eval("[data-cal-toggle]", (node) => node.click());
    await settle(60);
    await geometry(`${theme} ${scenario}: calendar`);
    if (scenario === "default") {
      await page.click("#tab-attendance");
      await settle(80);
      await geometry(`${theme}: attendance`);
    }
  }
}

// Not failures, but worth a look.
await open("scenario=default");
report.notes.push(...(await page.evaluate(() => [...__glitch.targets(document.querySelector(".app")), ...__glitch.tiny(document.querySelector(".app"))])));
await browser.close();
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ browser: name, failures: report.failures.length, notes: report.notes.length }, null, 2));
for (const failure of report.failures.slice(0, 40)) console.log(`✗ ${failure.where}\n    ${failure.issues.join("\n    ")}`);
if (report.notes.length) console.log(`notes:\n  ${[...new Set(report.notes)].join("\n  ")}`);
if (report.failures.length) process.exitCode = 1;
