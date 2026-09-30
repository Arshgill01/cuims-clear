// Restyles CUIMS itself in the chosen theme. CUIMS has no theme support and
// many hand-coloured pages, so instead of per-page rules this reads each
// element's own colours once and maps them onto the theme: neutral whites
// and greys become the theme's surfaces and text; coloured things keep their
// meaning by hue (a red "Absent" stays red, in the theme's red). Every mapped
// text colour is checked against what it ends up sitting on.

(() => {
  const themes = globalThis.CuimsThemes;
  if (!themes) return;
  const STYLE_ID = "cc-cuims-theme";
  const ENABLED_KEY = "themeCuims";
  const SKIP = new Set(["IMG", "SVG", "PATH", "VIDEO", "CANVAS", "IFRAME", "SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "OBJECT", "EMBED", "BR", "PICTURE", "SOURCE"]);
  const PROPS = ["background-color", "color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"];

  const originals = new WeakMap();
  const touched = new Set();
  let theme = null;
  let enabled = true;
  let observer = null;
  let queued = false;
  const pending = new Set();

  // ---- colour helpers ----

  function parse(value) {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  }

  function hexOf({ r, g, b }) {
    return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  }

  function hsl({ r, g, b }) {
    const [x, y, z] = [r, g, b].map((v) => v / 255);
    const max = Math.max(x, y, z);
    const min = Math.min(x, y, z);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = (max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4) * 60;
    return { h, s, l };
  }

  // Which meaning a coloured value carries, by hue.
  function family(color) {
    const { h, s, l } = hsl(color);
    if (s < 0.2 || l < 0.08 || l > 0.96) return "neutral";
    if (h < 18 || h >= 330) return "bad";
    if (h < 65) return "warn";
    if (h < 165) return "good";
    return "accent";
  }

  function mixHex(a, b, amount) {
    const pa = a.match(/\w\w/g).map((v) => parseInt(v, 16));
    const pb = b.match(/\w\w/g).map((v) => parseInt(v, 16));
    return `#${pa.map((v, i) => Math.round(v * amount + pb[i] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
  }

  // ---- mapping ----

  function rgbaOf(hex, alpha) {
    const [r, g, b] = hex.match(/\w\w/g).map((v) => parseInt(v, 16));
    return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
  }

  // A translucent colour seen over `under`, as a solid hex, for contrast checks.
  function over(color, under) {
    const top = parse(color);
    if (!top) return color;
    if (top.a >= 1) return hexOf(top);
    return mixHex(hexOf(top), under, top.a);
  }

  const CONTROL = "button, input[type=submit], input[type=button], input[type=reset], .btn, [role=button]";
  const FIELD = "input:not([type=submit]):not([type=button]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=image]), select, textarea";

  // Solid fills become the theme's own surfaces or tones. Translucent ones
  // (glass panels, overlays) keep their see-through look in theme colours.
  function mapBackground(color, t, el) {
    if (!color || color.a < 0.05) return null;
    const kind = family(color);
    const { l } = hsl(color);
    const glass = color.a < 0.9;
    if (el?.matches?.(FIELD)) {
      if (glass) return t.scheme === "dark" ? rgbaOf(t.ink, Math.min(0.14, color.a + 0.04)) : rgbaOf(t.surface, 0.85);
      return t.surface2;
    }
    if (kind !== "neutral" && el?.matches?.(CONTROL)) return t.accent;
    if (kind === "neutral") {
      if (glass) {
        if (l > 0.6) return rgbaOf(t.scheme === "dark" ? t.ink : t.surface, t.scheme === "dark" ? color.a : Math.max(color.a, 0.7));
        return rgbaOf(t.scheme === "dark" ? t.brandBg : t.surface, t.scheme === "dark" ? color.a : Math.max(color.a, 0.8));
      }
      if (l > 0.9) return t.surface;
      if (l > 0.75) return t.surface2;
      if (l > 0.45) return t.lineStrong;
      return t.scheme === "dark" ? t.brandBg : t.surface2;
    }
    const tone = { bad: t.bad, warn: t.warn, good: t.good, accent: t.accent }[kind];
    if (glass) return rgbaOf(tone, color.a);
    // Pale tints stay pale tints; solid fills become the theme's own fill.
    if (l > 0.8) return mixHex(tone, t.surface, t.scheme === "dark" ? 0.2 : 0.14);
    return kind === "accent" ? t.accent : tone;
  }

  function mapText(color, t) {
    if (!color) return null;
    const kind = family(color);
    const { l } = hsl(color);
    // CUIMS writes body copy in deep navy; that is text colour, not a link.
    if (kind === "neutral" || (kind === "accent" && l < 0.4)) {
      if (l < 0.4) return t.ink;
      if (l < 0.75) return t.muted;
      return null; // light text: decided by what it sits on
    }
    return { bad: t.badInk, warn: t.warnInk, good: t.goodInk, accent: themes.contrast(t.accent, t.surface) >= 4.5 ? t.accent : t.focus }[kind];
  }

  function mapBorder(color, t) {
    if (!color || color.a < 0.05) return null;
    const kind = family(color);
    if (kind !== "neutral") return { bad: t.bad, warn: t.warn, good: t.good, accent: t.accent }[kind];
    if (color.a < 0.9) return rgbaOf(t.scheme === "dark" ? t.ink : t.ink, Math.min(0.25, color.a));
    return hsl(color).l > 0.6 ? t.line : t.lineStrong;
  }

  function set(el, prop, value) {
    if (value == null) return;
    el.style.setProperty(prop, value, "important");
  }

  function remember(el) {
    if (originals.has(el)) return originals.get(el);
    const cs = getComputedStyle(el);
    const record = { computed: {}, inline: {} };
    for (const prop of PROPS) {
      record.computed[prop] = cs.getPropertyValue(prop);
      record.inline[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    }
    record.borders = ["top", "right", "bottom", "left"].map((side) => parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0);
    // Text colour is inherited: if this element's colour is just what we
    // painted on its parent, its real original is the parent's original.
    const parent = el.parentElement;
    const parentRecord = parent && touched.has(parent) ? originals.get(parent) : null;
    if (parentRecord && !el.style.getPropertyValue("color") && cs.color === getComputedStyle(parent).color) {
      record.computed.color = parentRecord.computed.color;
    }
    originals.set(el, record);
    return record;
  }

  // What an element is drawn on, after mapping, as a solid colour.
  function surfaceUnder(el, t) {
    for (let node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
      const record = originals.get(node);
      const bg = record ? parse(record.computed["background-color"]) : null;
      if (bg && bg.a >= 0.3) {
        const mapped = mapBackground(bg, t, node);
        if (mapped) return over(mapped, surfaceUnder(node.parentElement, t));
      }
    }
    return t.canvas;
  }

  function paint(el) {
    const t = theme;
    const record = remember(el);
    const control = el.matches(CONTROL) && family(parse(record.computed["background-color"]) || { r: 0, g: 0, b: 0, a: 0 }) !== "neutral";
    let bg = mapBackground(parse(record.computed["background-color"]), t, el);
    // Tiny dark blocks are drawn glyphs (menu bars, dots): they take the ink.
    const original = parse(record.computed["background-color"]);
    if (bg && original && family(original) === "neutral" && hsl(original).l < 0.45 && !el.firstElementChild) {
      const box = el.getBoundingClientRect();
      if (box.width * box.height > 0 && box.width * box.height < 600) bg = t.ink;
    }
    set(el, "background-color", bg);
    const under = bg ? over(bg, surfaceUnder(el.parentElement, t)) : surfaceUnder(el.parentElement, t);
    if (control) {
      set(el, "color", t.accentInk);
      touched.add(el);
      return;
    }
    let text = mapText(parse(record.computed.color), t);
    if (!text || themes.contrast(text, under) < 4.5) {
      text = themes.contrast(t.ink, under) >= themes.contrast(t.canvas, under) ? t.ink : t.canvas;
      if (themes.contrast("#ffffff", under) > themes.contrast(text, under)) text = "#ffffff";
    }
    set(el, "color", text);
    ["top", "right", "bottom", "left"].forEach((side, index) => {
      if (record.borders[index]) set(el, `border-${side}-color`, mapBorder(parse(record.computed[`border-${side}-color`]), t));
    });
    touched.add(el);
  }

  function eligible(el) {
    if (SKIP.has(el.tagName) || el.closest?.("svg")) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (String(el.id || "").startsWith("cuims-clear") || el.id === STYLE_ID) return false;
    return true;
  }

  function sweep(root) {
    if (!theme || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => (SKIP.has(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    // Read every original colour first, then paint, so nothing reads a
    // colour this pass has already changed.
    const nodes = [];
    if (root.nodeType === 1 && eligible(root)) nodes.push(root);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (eligible(node)) nodes.push(node);
    for (const node of nodes) remember(node);
    for (const node of nodes) paint(node);
  }

  function restore() {
    for (const el of touched) {
      const record = originals.get(el);
      if (!record) continue;
      for (const prop of PROPS) {
        const [value, priority] = record.inline[prop];
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
    }
    touched.clear();
  }

  // ---- page-level base, painted before content ----

  // Only the page itself and things no element pass can reach. Element
  // colours are read before any of this could colour them.
  function baseCss(t) {
    // Embedded pages (the weather widget) keep their own scheme; a mismatch
    // makes the browser paint the frame opaque white.
    return `html,body{background-color:${t.canvas} !important;color:${t.ink} !important;color-scheme:${t.scheme}}
iframe{color-scheme:normal !important}
.highcharts-background,.highcharts-plot-background{fill:${t.surface} !important}
.highcharts-grid-line,.highcharts-axis-line,.highcharts-tick{stroke:${t.line} !important}
.highcharts-axis-labels text,.highcharts-axis-title,.highcharts-legend-item text,.highcharts-title,.highcharts-subtitle,.highcharts-data-label text{fill:${t.muted} !important;color:${t.muted} !important}
.highcharts-button-symbol{stroke:${t.muted} !important}
.highcharts-button-box{fill:${t.surface} !important}
${t.scheme === "dark" ? `.logo img,.nav-logo img{background:rgba(255,255,255,0.92) !important;border-radius:8px;padding:2px 6px;box-sizing:content-box}` : ""}
::selection{background:${t.accent};color:${t.accentInk}}
input::placeholder,textarea::placeholder{color:${t.muted} !important;opacity:1}`;
  }

  function flush() {
    queued = false;
    const roots = [...pending];
    pending.clear();
    for (const node of roots) if (node.isConnected) sweep(node);
  }

  function queue(node) {
    pending.add(node);
    if (queued) return;
    queued = true;
    (globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 60)))(flush, { timeout: 250 });
  }

  function watch() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node.nodeType === 1 && eligible(node)) queue(node);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function apply(id, on) {
    const next = on && id !== themes.DEFAULT ? themes.tokens(id) : null;
    let style = document.getElementById(STYLE_ID);
    restore();
    theme = next;
    if (!next) {
      style?.remove();
      observer?.disconnect();
      observer = null;
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).append(style);
    }
    style.textContent = baseCss(next);
    const start = () => {
      sweep(document.body);
      watch();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  // First frame from this site's copy of the choice; then the real one.
  let current = themes.mirrored();
  try {
    enabled = localStorage.getItem("cuims-clear:theme-cuims") !== "off";
  } catch {}
  if (document.documentElement) apply(current, enabled);

  chrome.storage.local.get({ [themes.STORE_KEY]: themes.DEFAULT, [ENABLED_KEY]: true }, (stored) => {
    const id = themes.valid(stored[themes.STORE_KEY]);
    const on = stored[ENABLED_KEY] !== false;
    try {
      localStorage.setItem("cuims-clear:theme", id);
      localStorage.setItem("cuims-clear:theme-cuims", on ? "on" : "off");
    } catch {}
    if (id !== current || on !== enabled) {
      current = id;
      enabled = on;
      apply(current, enabled);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes[themes.STORE_KEY] || changes[ENABLED_KEY])) return;
    if (changes[themes.STORE_KEY]) current = themes.valid(changes[themes.STORE_KEY].newValue);
    if (changes[ENABLED_KEY]) enabled = changes[ENABLED_KEY].newValue !== false;
    try {
      localStorage.setItem("cuims-clear:theme-cuims", enabled ? "on" : "off");
    } catch {}
    apply(current, enabled);
  });

  globalThis.CuimsPageTheme = { apply, sweep, family, mapBackground, mapText };
})();
