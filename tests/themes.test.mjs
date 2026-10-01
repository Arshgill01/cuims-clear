import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const root = new URL("../outputs/cuims-clear-firefox/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");

function loadThemes(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  vm.runInContext(read("themes.js"), context);
  return context.CuimsThemes;
}

const T = loadThemes();
const IDS = T.list.map((entry) => entry.id);

test("the themes are the default plus a varied Omarchy set, with no near-duplicate whites", () => {
  assert.deepEqual([...IDS], ["clear", "tokyo-night", "catppuccin", "gruvbox", "everforest", "kanagawa", "nord", "osaka-jade", "retro-82", "matte-black", "solitude", "catppuccin-latte", "flexoki-light"]);
  assert.equal(T.list.filter((entry) => entry.scheme === "light").length, 3);
});

test("status colours keep their hue when nudged for contrast", () => {
  const hue = (hex) => {
    const [r, g, b] = hex.match(/\w\w/g).map((v) => parseInt(v, 16) / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (!d) return null;
    return ((max === r ? (g - b) / d + 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60) % 360;
  };
  for (const id of ["everforest", "nord", "kanagawa", "gruvbox"]) {
    const bad = hue(T.tokens(id).badInk);
    assert.ok(bad >= 320 || bad <= 20, `${id} bad ink stays red (hue ${bad})`);
  }
});

test("every theme keeps text readable (WCAG AA) on every surface it is drawn on", () => {
  const pairs = [
    ["ink", "surface", 4.5], ["ink", "canvas", 4.5], ["muted", "surface", 4.5], ["muted", "canvas", 4.5],
    ["goodInk", "surface", 4.5], ["warnInk", "surface", 4.5], ["badInk", "surface", 4.5],
    ["goodInk", "goodBg", 4.5], ["warnInk", "warnBg", 4.5], ["badInk", "badBg", 4.5],
    ["accentInk", "accent", 4.5], ["onGood", "goodInk", 4.5], ["onBad", "badInk", 4.5],
    ["surface", "ink", 4.5], ["brandInk", "brandBg", 3], ["focus", "canvas", 3],
  ];
  for (const id of IDS) {
    const t = T.tokens(id);
    for (const [fg, bg, ratio] of pairs) {
      assert.ok(T.contrast(t[fg], t[bg]) >= ratio, `${id}: ${fg} on ${bg} is ${T.contrast(t[fg], t[bg]).toFixed(2)}`);
    }
  }
});

test("the default theme keeps the original colours exactly", () => {
  const t = T.tokens("clear");
  assert.equal(t.accent, "#b7f34a");
  assert.equal(t.goodInk, "#3a6912");
  assert.equal(t.badBg, "#fff6f4");
  assert.equal(T.lmsCss("clear"), "", "the LMS keeps its own look, including Moodle dark mode");
});

test("the popup stylesheet takes every colour from theme tokens, and every token is set by every theme", () => {
  const css = read("popup.css");
  const rootBlock = css.slice(0, css.indexOf("}") + 1);
  const rest = css.slice(css.indexOf("}") + 1);
  assert.doesNotMatch(rest.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i, "no literal colours outside :root");
  const used = new Set([...rest.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]));
  const local = new Set([...rest.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const style = new Map();
  T.applyToPopup({ style: { setProperty: (name, value) => style.set(name, value) }, dataset: {} }, "tokyo-night");
  for (const name of used) {
    if (local.has(name) || name.startsWith("--p-")) continue;
    assert.ok(style.has(name), `${name} is used by popup.css but no theme sets it`);
    assert.match(rootBlock, new RegExp(`${name}:`), `${name} has a default in :root`);
  }
});

test("dark themes restyle the LMS clear view and switch Moodle to dark", () => {
  const css = T.lmsCss("tokyo-night");
  assert.match(css, /--cc-bg:#1a1b26 !important/);
  assert.match(css, /--cc-accent-ink:/);
  const attributes = new Map();
  const appended = [];
  const documentElement = {
    classList: { add() {}, remove() {}, contains: () => true },
    style: { setProperty() {}, removeProperty() {} },
    dataset: {},
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    append: (node) => appended.push(node),
  };
  const context = vm.createContext({
    console,
    window: {},
    location: { pathname: "/course/view.php", hash: "" },
    localStorage: { getItem: () => "tokyo-night", setItem() {} },
    document: { documentElement, getElementById: () => null, createElement: () => ({ id: "", textContent: "", remove() {} }) },
    chrome: { storage: { local: { get: (defaults, callback) => (callback ? callback(defaults) : Promise.resolve({ ...defaults, theme: "tokyo-night" })) }, onChanged: { addListener() {} } } },
  });
  context.window.top = context.window;
  vm.runInContext(read("themes.js"), context);
  vm.runInContext(read("lms-boot.js").replace("if (window.top !== window) return;", ""), context);
  assert.equal(attributes.get("data-bs-theme"), "dark");
  assert.equal(documentElement.dataset.ccTheme, "tokyo-night");
  assert.match(appended[0].textContent, /--cc-surface:#24283b/);
});

test("the CUIMS login note follows the theme", () => {
  const source = read("content.js");
  assert.match(source, /globalThis\.CuimsThemes/);
  assert.match(source, /themes\.tokens\(id\)/);
  assert.match(read("lms-launch.js"), /theme\.tokens\(id\)/);
});

test("the toolbar icon is redrawn in the theme's brand colours", () => {
  const painted = [];
  class FakeCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return new Proxy({}, {
        get: (_, key) => (key === "getImageData" ? (x, y, w, h) => ({ w, h, fill: painted.at(-1) }) : key === "fillStyle" ? painted.at(-1) : () => {}),
        set: (_, key, value) => {
          if (key === "fillStyle") painted.push(value);
          return true;
        },
      });
    }
  }
  const image = T.drawIcon(32, "gruvbox", FakeCanvas);
  assert.equal(image.w, 32);
  const t = T.tokens("gruvbox");
  assert.deepEqual(painted, [t.brandBg, t.brandInk]);
});

test("an unknown or missing theme falls back to the default", () => {
  assert.equal(T.valid("nope"), "clear");
  assert.equal(T.valid(undefined), "clear");
  assert.equal(loadThemes({ localStorage: { getItem: () => "gruvbox" } }).mirrored(), "gruvbox");
});

// ---- CUIMS pages ----

function pageTheme(themeId = "tokyo-night") {
  const context = vm.createContext({
    console,
    localStorage: { getItem: (key) => (key === "cuims-clear:theme" ? themeId : "on"), setItem() {} },
    document: { documentElement: null, readyState: "complete", addEventListener() {} },
    chrome: { storage: { local: { get() {} }, onChanged: { addListener() {} } } },
    getComputedStyle: () => ({}),
  });
  vm.runInContext(read("themes.js"), context);
  vm.runInContext(read("cuims-theme.js"), context);
  return { P: context.CuimsPageTheme, t: context.CuimsThemes.tokens(themeId) };
}

test("CUIMS colours map by meaning: neutrals to surfaces, hues to the theme's own tones", () => {
  const { P, t } = pageTheme();
  const c = (r, g, b, a = 1) => ({ r, g, b, a });
  assert.equal(P.family(c(255, 255, 255)), "neutral");
  assert.equal(P.family(c(225, 15, 15)), "bad");
  assert.equal(P.family(c(40, 160, 60)), "good");
  assert.equal(P.family(c(69, 123, 157)), "accent");
  assert.equal(P.mapBackground(c(255, 255, 255), t), t.surface);
  assert.equal(P.mapText(c(51, 51, 51), t), t.ink);
  assert.equal(P.mapText(c(200, 20, 20), t), t.badInk);
});

test("CUIMS buttons take the theme accent, and glass panels stay translucent", () => {
  const { P, t } = pageTheme();
  const button = { matches: (selector) => selector.includes("input[type=submit]") && !selector.startsWith("input:not") };
  assert.equal(P.mapBackground({ r: 225, g: 15, b: 15, a: 1 }, t, button), t.accent);
  assert.match(P.mapBackground({ r: 25, g: 26, b: 32, a: 0.5 }, t, { matches: () => false }), /^rgba\(.+0\.5\)$/);
  const light = pageTheme("catppuccin-latte");
  assert.match(light.P.mapBackground({ r: 25, g: 26, b: 32, a: 0.5 }, light.t, { matches: () => false }), /^rgba\(255, 255, 255, 0\.8\)$/);
});

test("jQuery UI textures and near-white gradients are dropped; icons and coloured gradients stay", () => {
  const { P } = pageTheme();
  assert.equal(P.washedImage('url("https://students.cuchd.in/Scripts/images/ui-bg_glass_75_e6e6e6_1x400.png")', "repeat-x"), true);
  assert.equal(P.washedImage('url("strip.png")', "repeat-x"), true);
  assert.equal(P.washedImage('url("images/ui-icons_222222_256x240.png")', "no-repeat"), false);
  assert.equal(P.washedImage('url("search-icon.png")', "no-repeat"), false);
  assert.equal(P.washedImage("linear-gradient(rgb(255, 255, 255), rgb(240, 240, 240))", "repeat"), true);
  assert.equal(P.washedImage("linear-gradient(135deg, rgb(78, 115, 223), rgb(28, 200, 138))", "repeat"), false);
  assert.equal(P.washedImage("none", "repeat"), false);
});

test("CUIMS pages are repainted when they change after load, and never flash before the first paint", () => {
  const source = read("cuims-theme.js");
  // jQuery UI adds its classes after load; UpdatePanels swap markup.
  assert.match(source, /attributeOldValue: true, attributeFilter: \["class", "style"\]/);
  assert.match(source, /record\.oldValue === target\.getAttribute\(record\.attributeName\)/);
  // CUIMS's own `body{background:… !important}` beats any stylesheet rule.
  assert.match(source, /function paintRoot/);
  // Hidden until the stored choice and the first paint, with a safety reveal.
  assert.match(source, /hold\("choice"\)/);
  assert.match(source, /CLOAK_MAX_MS = \d+/);
  // A theme switch updates this site's copy, so the next load starts right.
  assert.match(source, /onChanged[\s\S]*localStorage\.setItem\("cuims-clear:theme", current\)/);
});

test("the default theme leaves CUIMS exactly as it is", () => {
  const source = read("cuims-theme.js");
  assert.match(source, /id !== themes\.DEFAULT/);
  const manifest = JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.content_scripts[0].js, ["captcha-glyphs.js", "captcha-solver.js", "themes.js", "cuims-theme.js", "content.js"]);
});
