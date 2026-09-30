// Restyles CUIMS itself in the chosen theme. CUIMS has no theme support and
// many hand-coloured pages, so instead of per-page rules this reads each
// element's own colours and maps them onto the theme: neutral whites and
// greys become the theme's surfaces and text; coloured things keep their
// meaning by hue (a red "Absent" stays red, in the theme's red). Every mapped
// text colour is checked against what it ends up sitting on.
//
// CUIMS keeps changing its own colours after load (jQuery UI adds classes,
// stylesheets arrive late, UpdatePanels swap markup), so an element is
// re-read whenever its class, inline colour or subtree changes. Every repaint
// runs synchronously in the mutation callback, before the browser draws.

(() => {
  const themes = globalThis.CuimsThemes;
  if (!themes) return;
  const STYLE_ID = "cc-cuims-theme";
  const ENABLED_KEY = "themeCuims";
  // The page stays hidden (the theme's canvas shows) until the first full
  // paint, so the default CUIMS look never flashes. Revealed regardless after
  // this long, in case the page never finishes loading.
  const CLOAK_ATTR = "data-cc-cloak";
  const CLOAK_ID = "cc-cuims-cloak";
  const CLOAK_MAX_MS = 2500;
  const SKIP = new Set(["IMG", "SVG", "PATH", "VIDEO", "CANVAS", "IFRAME", "SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "OBJECT", "EMBED", "BR", "PICTURE", "SOURCE"]);
  const PROPS = ["background-color", "background-image", "color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"];
  const COLOR_PROPS = ["background-color", "background-image", "background", "color", "border-color", "border"];

  let originals = new WeakMap();
  // What we wrote on each element, as the browser stored it, so a later
  // write by the page can be told apart from ours.
  const applied = new Map();
  // Elements CUIMS animates (`transition: all .4s`) would fade from the
  // original colours to the theme's on every paint. Their own transition list
  // gets our colour properties appended at 0s: a later entry wins, so colours
  // switch at once while the page's other animations keep running.
  const EASE_PROPS = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay"];
  const easing = new WeakMap();
  const eased = new Set();
  let theme = null;
  let enabled = true;
  let observer = null;
  let cloakTimer = 0;

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


  // Background images that only exist to look light: jQuery UI's ui-bg_*
  // textures (repeated strips) and gradients made of near-whites. Icon
  // sprites, photos and coloured gradients are left alone.
  function washedImage(image, repeat) {
    if (!image || image === "none") return false;
    if (/url\(/.test(image)) return /ui-bg_/i.test(image) || /repeat-[xy]/.test(repeat || "");
    if (!/gradient/.test(image)) return false;
    const stops = [...image.matchAll(/rgba?\([^)]+\)/g)].map((match) => parse(match[0])).filter(Boolean);
    return stops.length > 0 && stops.every((stop) => stop.a < 0.05 || (family(stop) === "neutral" && hsl(stop).l > 0.8));
  }

  // The colour a washed gradient stands for, when it has no fill of its own.
  function imageFill(image) {
    const stop = parse((image.match(/rgba?\([^)]+\)/) || [])[0]);
    return stop && stop.a >= 0.05 ? stop : null;
  }

  function set(el, prop, value) {
    if (value == null) return;
    el.style.setProperty(prop, value, "important");
    let mine = applied.get(el);
    if (!mine) applied.set(el, (mine = {}));
    mine[prop] = el.style.getPropertyValue(prop);
  }

  // Our writes are still in place (the page has not overwritten them).
  function intact(el) {
    const mine = applied.get(el);
    if (!mine) return false;
    for (const prop in mine) {
      if (el.style.getPropertyValue(prop) !== mine[prop] || el.style.getPropertyPriority(prop) !== "important") return false;
    }
    return true;
  }

  // Takes back what we wrote, keeping anything the page wrote since, and
  // forgets the element's colours so the next paint reads them afresh.
  function unpaint(el) {
    const mine = applied.get(el);
    const record = originals.get(el);
    originals.delete(el);
    if (!mine) return;
    applied.delete(el);
    for (const prop in mine) {
      if (el.style.getPropertyValue(prop) !== mine[prop] || el.style.getPropertyPriority(prop) !== "important") continue;
      const [value, priority] = record?.inline[prop] || ["", ""];
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
  }

  function remember(el) {
    if (originals.has(el)) return originals.get(el);
    const cs = getComputedStyle(el);
    const record = { computed: {}, inline: {} };
    for (const prop of PROPS) {
      record.computed[prop] = cs.getPropertyValue(prop);
      record.inline[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    }
    record.repeat = cs.getPropertyValue("background-repeat");
    if (!easing.has(el)) {
      easing.set(el, {
        computed: EASE_PROPS.map((prop) => cs.getPropertyValue(prop)),
        inline: EASE_PROPS.map((prop) => [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]),
      });
    }
    record.borders = ["top", "right", "bottom", "left"].map((side) => parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0);
    // Text colour is inherited: if this element's colour is just what we
    // painted on its parent, its real original is the parent's original.
    const parent = el.parentElement;
    const parentRecord = parent && applied.has(parent) ? originals.get(parent) : null;
    if (parentRecord && !el.style.getPropertyValue("color") && cs.color === getComputedStyle(parent).color) {
      record.computed.color = parentRecord.computed.color;
    }
    // Tiny dark blocks with nothing inside are drawn glyphs (menu bars,
    // dots). Measured here, while only reading, so painting never forces a
    // layout per element.
    const bg = parse(record.computed["background-color"]);
    if (bg && bg.a >= 0.05 && family(bg) === "neutral" && hsl(bg).l < 0.45 && !el.firstElementChild) {
      const box = el.getBoundingClientRect();
      record.glyph = box.width * box.height > 0 && box.width * box.height < 600;
    }
    originals.set(el, record);
    return record;
  }

  // The fill an element is drawn with once its washed-out image is gone.
  function fillOf(record) {
    const color = parse(record.computed["background-color"]);
    const image = record.computed["background-image"];
    if (!washedImage(image, record.repeat) || (color && color.a >= 0.05)) return color;
    return /gradient/.test(image) ? imageFill(image) : color;
  }

  // What an element is drawn on, after mapping, as a solid colour.
  function surfaceUnder(el, t) {
    for (let node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
      const record = originals.get(node);
      const bg = record ? fillOf(record) : null;
      if (bg && bg.a >= 0.3) {
        const mapped = mapBackground(bg, t, node);
        if (mapped) return over(mapped, surfaceUnder(node.parentElement, t));
      }
    }
    return t.canvas;
  }

  // A computed list, split on top-level commas (cubic-bezier(…) has its own).
  function list(value) {
    const items = [];
    let depth = 0;
    let item = "";
    for (const char of String(value || "")) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && !depth) {
        items.push(item.trim());
        item = "";
      } else item += char;
    }
    if (item.trim()) items.push(item.trim());
    return items;
  }

  // Longhands, not the `transition` shorthand, which not every engine
  // serialises in computed style.
  function ease(el) {
    const original = easing.get(el);
    if (!original || eased.has(el) || !/[1-9]/.test(original.computed[1])) return;
    const [names, ...rest] = original.computed.map(list);
    if (!names.length || rest.some((values) => !values.length)) return;
    // Shorter lists repeat to the property count; line them up first.
    const aligned = rest.map((values) => names.map((_, index) => values[index % values.length]));
    const extra = { "transition-duration": "0s", "transition-timing-function": "linear", "transition-delay": "0s" };
    el.style.setProperty("transition-property", [...names, ...PROPS].join(", "), "important");
    EASE_PROPS.slice(1).forEach((prop, index) => el.style.setProperty(prop, [...aligned[index], ...PROPS.map(() => extra[prop])].join(", "), "important"));
    eased.add(el);
  }

  function unease() {
    for (const el of eased) {
      (easing.get(el)?.inline || []).forEach(([value, priority], index) => {
        if (value) el.style.setProperty(EASE_PROPS[index], value, priority);
        else el.style.removeProperty(EASE_PROPS[index]);
      });
    }
    eased.clear();
  }

  function paint(el) {
    const t = theme;
    const record = remember(el);
    ease(el);
    const original = fillOf(record);
    const control = el.matches(CONTROL) && family(original || { r: 0, g: 0, b: 0, a: 0 }) !== "neutral";
    let bg = mapBackground(original, t, el);
    if (bg && record.glyph) bg = t.ink;
    if (washedImage(record.computed["background-image"], record.repeat)) set(el, "background-image", "none");
    set(el, "background-color", bg);
    const under = bg ? over(bg, surfaceUnder(el.parentElement, t)) : surfaceUnder(el.parentElement, t);
    if (control) {
      set(el, "color", t.accentInk);
      return;
    }
    let text = mapText(parse(record.computed.color), t);
    if (!text || themes.contrast(text, under) < 4.5) {
      // The theme's own ink or canvas when either reads; else plain white or
      // near-black, whichever reads best.
      const best = (colors) => colors.reduce((a, b) => (themes.contrast(b, under) > themes.contrast(a, under) ? b : a));
      text = best([t.ink, t.canvas]);
      if (themes.contrast(text, under) < 4.5) text = best([text, "#ffffff", "#111111"]);
    }
    set(el, "color", text);
    ["top", "right", "bottom", "left"].forEach((side, index) => {
      if (record.borders[index]) set(el, `border-${side}-color`, mapBorder(parse(record.computed[`border-${side}-color`]), t));
    });
  }

  function eligible(el) {
    if (SKIP.has(el.tagName) || el.closest?.("svg")) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (String(el.id || "").startsWith("cuims-clear") || el.id === STYLE_ID) return false;
    return true;
  }

  function elementsOf(root) {
    const nodes = [];
    if (!root || root.nodeType !== 1) return nodes;
    if (eligible(root)) nodes.push(root);
    if (SKIP.has(root.tagName)) return nodes;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => (SKIP.has(node.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (eligible(node)) nodes.push(node);
    return nodes;
  }

  // Paints a set of subtrees from scratch: take our paint off, read every
  // original colour, then paint, so nothing reads a colour this pass changed.
  function repaint(roots) {
    if (!theme) return;
    const nodes = [];
    const seen = new Set();
    for (const root of roots) {
      if (!root?.isConnected) continue;
      for (const node of elementsOf(root)) {
        if (seen.has(node)) continue;
        seen.add(node);
        nodes.push(node);
      }
    }
    if (!nodes.length) return;
    quietly(() => {
      for (const node of nodes) unpaint(node);
      for (const node of nodes) remember(node);
      for (const node of nodes) paint(node);
    });
  }

  // Transition overrides stay through a theme switch, so nothing fades
  // between two themes; they go when CUIMS returns to its own look.
  function unpaintAll(keepEasing) {
    quietly(() => {
      for (const el of [...applied.keys()]) unpaint(el);
      applied.clear();
      originals = new WeakMap();
      if (!keepEasing) unease();
    });
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

  // CUIMS's own `body{background:… !important}` comes later in the page and
  // wins over any stylesheet of ours, so the page roots are painted inline.
  const roots = new Map();
  const ROOT_PROPS = ["background-color", "background-image", "color"];
  function paintRoot(el) {
    if (!el || !theme) return;
    if (!roots.has(el)) roots.set(el, ROOT_PROPS.map((prop) => [prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]));
    const want = { "background-color": theme.canvas, "background-image": "none", color: theme.ink };
    for (const prop of ROOT_PROPS) {
      if (el.style.getPropertyPriority(prop) === "important" && el.dataset.ccRoot === theme.canvas) continue;
      el.style.setProperty(prop, want[prop], "important");
    }
    el.dataset.ccRoot = theme.canvas;
  }

  function unpaintRoots() {
    for (const [el, saved] of roots) {
      for (const [prop, value, priority] of saved) {
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
    }
    for (const el of roots.keys()) delete el.dataset.ccRoot;
    roots.clear();
  }

  // Reasons the page is still hidden: the stored choice has not arrived, or
  // the first paint has not run. The page shows once both are done.
  const holds = new Set();
  function hold(reason) {
    if (!document.documentElement) return;
    if (!holds.size) {
      let style = document.getElementById(CLOAK_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = CLOAK_ID;
        style.textContent = `html[${CLOAK_ATTR}] body{opacity:0 !important}`;
        (document.head || document.documentElement).append(style);
      }
      document.documentElement.setAttribute(CLOAK_ATTR, "");
      cloakTimer = setTimeout(() => {
        holds.clear();
        uncloak();
      }, CLOAK_MAX_MS);
    }
    holds.add(reason);
  }

  function release(reason) {
    if (!holds.delete(reason) || holds.size) return;
    uncloak();
  }

  function uncloak() {
    clearTimeout(cloakTimer);
    document.documentElement?.removeAttribute(CLOAK_ATTR);
    document.getElementById(CLOAK_ID)?.remove();
  }

  // ---- keeping up with the page ----

  function stylesheetsReady() {
    return [...document.querySelectorAll("link[rel~=stylesheet]")].every((link) => link.sheet || link.disabled || !link.href);
  }

  // Runs our own writes without seeing them as page changes. Anything the
  // page did before is handled first.
  function quietly(fn) {
    if (!observer) return fn();
    const earlier = observer.takeRecords();
    observer.disconnect();
    try {
      fn();
    } finally {
      observe();
    }
    if (earlier.length) handle(earlier);
  }

  function observe() {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "style"] });
  }

  // Which subtrees the page changed in a way that can change colours.
  function handle(records) {
    // Until the first paint, which reads the whole page anyway.
    if (!theme || !document.body || holds.has("paint")) return;
    const dirty = new Set();
    for (const record of records) {
      const target = record.target;
      if (record.type === "childList") {
        for (const node of record.addedNodes) if (node.nodeType === 1) dirty.add(node);
        continue;
      }
      if (target.nodeType !== 1) continue;
      // Rewritten with the same value (classList.remove of an absent class).
      if (record.oldValue === target.getAttribute(record.attributeName)) continue;
      if (target === document.body || target === document.documentElement) {
        if (record.attributeName === "class") dirty.add(document.body);
        else if (record.attributeName === "style") quietly(() => paintRoot(target));
        continue;
      }
      if (record.attributeName === "class") dirty.add(target);
      else if (applied.has(target) ? !intact(target) : COLOR_PROPS.some((prop) => target.style.getPropertyValue(prop))) dirty.add(target);
    }
    // A subtree inside another dirty one is covered by it.
    const tops = [...dirty].filter((node) => {
      for (let up = node.parentElement; up; up = up.parentElement) if (dirty.has(up)) return false;
      return true;
    });
    repaint(tops);
  }

  function watch() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(handle);
    observe();
  }

  function unwatch() {
    observer?.disconnect();
    observer = null;
  }

  // A stylesheet that arrives after the first paint changes colours we
  // already read: read the whole page again.
  function onSheetLoad(event) {
    const node = event.target;
    if (!theme || node?.tagName !== "LINK" || !/stylesheet/i.test(node.rel || "") || !document.body) return;
    if (holds.has("paint")) return; // the first paint will read it
    repaint([document.body]);
  }

  function firstPaint() {
    if (!theme || !document.body) return release("paint");
    quietly(() => {
      paintRoot(document.documentElement);
      paintRoot(document.body);
    });
    repaint([document.body]);
    if (stylesheetsReady()) return release("paint");
    // Wait for the rest of the page's CSS, then read everything once more.
    addEventListener("load", () => {
      if (theme) repaint([document.body]);
      release("paint");
    }, { once: true });
  }

  function apply(id, on) {
    const next = on && id !== themes.DEFAULT ? themes.tokens(id) : null;
    let style = document.getElementById(STYLE_ID);
    unpaintAll(Boolean(next));
    unwatch();
    unpaintRoots();
    theme = next;
    if (!next) {
      style?.remove();
      release("paint");
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).append(style);
    }
    style.textContent = baseCss(next);
    paintRoot(document.documentElement);
    watch();
    if (document.readyState === "loading") hold("paint");
    else firstPaint();
  }

  document.addEventListener("load", onSheetLoad, true);
  if (document.readyState === "loading") {
    // Hidden until the stored choice arrives, so a stale local copy of the
    // choice never shows; then until the first paint.
    hold("choice");
    document.addEventListener("DOMContentLoaded", firstPaint, { once: true });
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
    release("choice");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(changes[themes.STORE_KEY] || changes[ENABLED_KEY])) return;
    if (changes[themes.STORE_KEY]) current = themes.valid(changes[themes.STORE_KEY].newValue);
    if (changes[ENABLED_KEY]) enabled = changes[ENABLED_KEY].newValue !== false;
    try {
      localStorage.setItem("cuims-clear:theme", current);
      localStorage.setItem("cuims-clear:theme-cuims", enabled ? "on" : "off");
    } catch {}
    apply(current, enabled);
  });

  globalThis.CuimsPageTheme = { apply, repaint, family, mapBackground, mapText, washedImage };
})();
