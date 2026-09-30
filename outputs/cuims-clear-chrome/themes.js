// Colour themes for the popup, the LMS clear view, and the CUIMS helpers.
// Each theme is a small palette taken from Omarchy's own theme files; every
// other colour is derived from it and checked for contrast, so text stays
// readable in all of them. One source of truth for every surface.

(function (root) {
  const STORE_KEY = "theme";
  const MIRROR_KEY = "cuims-clear:theme";
  const DEFAULT = "clear";

  // canvas: page, surface: cards, ink: text. good/warn/bad carry meaning.
  const PALETTES = [
    {
      id: "clear", name: "CUIMS Clear", scheme: "light",
      canvas: "#f2f3ee", surface: "#ffffff", ink: "#181a17", muted: "#63685f", line: "#d6dad1", lineStrong: "#aeb4aa",
      accent: "#b7f34a", good: "#7aaf2c", warn: "#d49e2a", bad: "#c9553f", brandBg: "#181a17", brandInk: "#b7f34a",
      // The original look, kept exact.
      fixed: {
        accentHover: "#a7e13e", accentInk: "#18200d", accentLine: "#92c62f", focus: "#527f17", success: "#28633a",
        goodInk: "#3a6912", goodBg: "#f1f8e6", goodLine: "#cfe4b3", warnInk: "#6f520f", warnBg: "#fffaf0", warnLine: "#eedfb9",
        badInk: "#93331f", badBg: "#fff6f4", badLine: "#f0d3cc", neutral: "#8d9388", track: "#ebede6", surface2: "#ebede6", inkHover: "#30332e",
      },
    },
    {
      id: "tokyo-night", name: "Tokyo Night", scheme: "dark",
      canvas: "#1a1b26", surface: "#24283b", ink: "#c0caf5", muted: "#8b93b8", line: "#292e42", lineStrong: "#414868",
      accent: "#7aa2f7", good: "#9ece6a", warn: "#e0af68", bad: "#f7768e", brandBg: "#13141c", brandInk: "#7aa2f7",
    },
    {
      id: "catppuccin", name: "Catppuccin", scheme: "dark",
      canvas: "#1e1e2e", surface: "#28283c", ink: "#cdd6f4", muted: "#a6adc8", line: "#3a3b52", lineStrong: "#585b70",
      accent: "#89b4fa", good: "#a6e3a1", warn: "#f9e2af", bad: "#f38ba8", brandBg: "#161622", brandInk: "#cba6f7",
    },
    {
      id: "gruvbox", name: "Gruvbox", scheme: "dark",
      canvas: "#282828", surface: "#32302f", ink: "#d4be98", muted: "#a89984", line: "#45403d", lineStrong: "#665c54",
      accent: "#7daea3", good: "#a9b665", warn: "#d8a657", bad: "#ea6962", brandBg: "#1e1e1e", brandInk: "#d8a657",
    },
    {
      id: "everforest", name: "Everforest", scheme: "dark",
      canvas: "#2d353b", surface: "#343f44", ink: "#d3c6aa", muted: "#9da9a0", line: "#3d484d", lineStrong: "#4f585e",
      accent: "#7fbbb3", good: "#a7c080", warn: "#dbbc7f", bad: "#e67e80", brandBg: "#21272c", brandInk: "#a7c080",
    },
    {
      id: "kanagawa", name: "Kanagawa", scheme: "dark",
      canvas: "#1f1f28", surface: "#2a2a37", ink: "#dcd7ba", muted: "#c8c093", line: "#363646", lineStrong: "#54546d",
      accent: "#7e9cd8", good: "#98bb6c", warn: "#e6c384", bad: "#e82424", brandBg: "#17171e", brandInk: "#dcd7ba",
    },
    {
      id: "nord", name: "Nord", scheme: "dark",
      canvas: "#2e3440", surface: "#3b4252", ink: "#d8dee9", muted: "#adb5c4", line: "#434c5e", lineStrong: "#4c566a",
      accent: "#88c0d0", good: "#a3be8c", warn: "#ebcb8b", bad: "#bf616a", brandBg: "#222730", brandInk: "#88c0d0",
    },
    {
      id: "osaka-jade", name: "Osaka Jade", scheme: "dark",
      canvas: "#111c18", surface: "#18261f", ink: "#d6d5bc", muted: "#81b8a8", line: "#23372b", lineStrong: "#53685b",
      accent: "#509475", good: "#63b07a", warn: "#e5c736", bad: "#ff5345", brandBg: "#0c1512", brandInk: "#2dd5b7",
    },
    {
      id: "retro-82", name: "Retro-82", scheme: "dark",
      canvas: "#05182e", surface: "#0a2540", ink: "#f6dcac", muted: "#a7c9c6", line: "#123150", lineStrong: "#2a6b78",
      accent: "#faa968", good: "#8cbfb8", warn: "#e97b3c", bad: "#f85525", brandBg: "#031222", brandInk: "#faa968",
    },
    {
      // Monochrome with an orange signal; no green of its own.
      id: "matte-black", name: "Matte Black", scheme: "dark",
      canvas: "#121212", surface: "#1e1e1e", ink: "#d4d4d4", muted: "#8a8a8d", line: "#2a2a2a", lineStrong: "#3a3a3a",
      accent: "#e68e0d", good: "#9a9a9a", warn: "#f59e0b", bad: "#d35f5f", brandBg: "#0d0d0d", brandInk: "#e68e0d",
    },
    {
      // Monochrome; its one warm red marks what needs attention.
      id: "solitude", name: "Solitude", scheme: "dark",
      canvas: "#101315", surface: "#171b1e", ink: "#cacccc", muted: "#8e9499", line: "#22282b", lineStrong: "#343d41",
      accent: "#798186", good: "#7a8186", warn: "#c9c2b4", bad: "#de6145", brandBg: "#0c0e10", brandInk: "#cacccc",
    },
    {
      id: "catppuccin-latte", name: "Catppuccin Latte", scheme: "light",
      canvas: "#eff1f5", surface: "#ffffff", ink: "#4c4f69", muted: "#6c6f85", line: "#ccd0da", lineStrong: "#acb0be",
      accent: "#1e66f5", good: "#40a02b", warn: "#df8e1d", bad: "#d20f39", brandBg: "#4c4f69", brandInk: "#eff1f5",
    },
    {
      id: "flexoki-light", name: "Flexoki Light", scheme: "light",
      canvas: "#f2f0e5", surface: "#fffcf0", ink: "#100f0f", muted: "#6f6e69", line: "#e6e4d9", lineStrong: "#cecdc3",
      accent: "#205ea6", good: "#879a39", warn: "#d0a215", bad: "#d14d41", brandBg: "#100f0f", brandInk: "#fffcf0",
    },
  ];

  // ---- colour math ----

  function rgb(hex) {
    const value = String(hex).replace("#", "");
    const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.slice(0, 6);
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
  }

  function hex([r, g, b]) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
  }

  // `amount` of a, the rest b.
  function mix(a, b, amount) {
    const left = rgb(a);
    const right = rgb(b);
    return hex(left.map((channel, index) => channel * amount + right[index] * (1 - amount)));
  }

  function luminance(color) {
    const [r, g, b] = rgb(color).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }

  function toHsl(color) {
    const [r, g, b] = rgb(color).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hue * 60, sat, l];
  }

  function fromHsl([h, sat, l]) {
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return hex([r, g, b].map((v) => (v + m) * 255));
  }

  // Lighten or darken `color`, keeping its hue, until it reads at `ratio` on
  // `background`. `toward` only says which way: toward light or dark text.
  function readable(color, background, ratio, toward) {
    if (contrast(color, background) >= ratio) return color;
    const up = luminance(toward) > luminance(background);
    const [h, sat, l] = toHsl(color);
    for (let step = 1; step <= 40; step += 1) {
      const next = fromHsl([h, sat, Math.max(0, Math.min(1, l + (up ? 1 : -1) * step * 0.02))]);
      if (contrast(next, background) >= ratio) return next;
    }
    return toward;
  }

  function onColor(background, light, dark) {
    return contrast(light, background) >= contrast(dark, background) ? light : dark;
  }

  function alpha(color, opacity) {
    const [r, g, b] = rgb(color);
    return `rgb(${r} ${g} ${b} / ${Math.round(opacity * 100)}%)`;
  }

  // ---- tokens ----

  const cache = new Map();

  function tokens(id) {
    const palette = PALETTES.find((entry) => entry.id === id) || PALETTES[0];
    if (cache.has(palette.id)) return cache.get(palette.id);
    const dark = palette.scheme === "dark";
    const { canvas, surface, ink } = palette;
    // Text colours move toward the ink until they read on both backgrounds.
    const text = (color) => readable(readable(color, surface, 4.5, ink), canvas, 4.5, ink);
    const tint = dark ? 0.16 : 0.1;
    // Meaning colours: a tinted card, and text that reads on it and on plain cards.
    const tone = (color) => {
      const bg = mix(color, surface, tint);
      return { bg, ink: readable(text(color), bg, 4.5, ink), line: mix(color, surface, 0.35) };
    };
    const good = tone(palette.good);
    const warn = tone(palette.warn);
    const bad = tone(palette.bad);
    // Primary buttons: if neither light nor dark text reads on the accent,
    // deepen the button until light text does.
    const lightText = dark ? canvas : "#ffffff";
    const darkText = dark ? surface : ink;
    let button = palette.accent;
    let buttonInk = onColor(button, lightText, darkText);
    if (contrast(buttonInk, button) < 4.5) {
      button = readable(palette.accent, "#ffffff", 4.5, dark ? canvas : ink);
      buttonInk = "#ffffff";
    }
    const derived = {
      surface2: mix(ink, surface, dark ? 0.08 : 0.06),
      inkHover: mix(ink, surface, 0.86),
      muted: text(palette.muted),
      accent: button,
      accentHover: mix(button, ink, 0.88),
      accentInk: buttonInk,
      accentLine: mix(button, ink, 0.75),
      focus: readable(palette.accent, canvas, 3, ink),
      goodInk: good.ink,
      goodBg: good.bg,
      goodLine: good.line,
      warnInk: warn.ink,
      warnBg: warn.bg,
      warnLine: warn.line,
      badInk: bad.ink,
      badBg: bad.bg,
      badLine: bad.line,
      neutral: mix(palette.muted, surface, 0.7),
      track: mix(ink, surface, 0.1),
    };
    const merged = { ...palette, ...derived, ...(palette.fixed || {}) };
    merged.success = merged.success || merged.goodInk;
    merged.onGood = onColor(merged.goodInk, "#ffffff", dark ? canvas : ink);
    merged.onBad = onColor(merged.badInk, "#ffffff", dark ? canvas : ink);
    merged.meterMark = mix(ink, surface, 0.45);
    merged.focusRing = alpha(merged.focus, 0.17);
    merged.focusOutline = alpha(merged.focus, 0.3);
    merged.shadow = dark ? "rgb(0 0 0 / 45%)" : "rgb(24 26 23 / 18%)";
    merged.brandInk = contrast(palette.brandInk, palette.brandBg) >= 3 ? palette.brandInk : onColor(palette.brandBg, "#ffffff", ink);
    cache.set(palette.id, merged);
    return merged;
  }

  // CSS custom properties for the popup.
  const POPUP_VARS = {
    "--canvas": "canvas", "--surface": "surface", "--surface-2": "surface2", "--ink": "ink", "--ink-hover": "inkHover",
    "--muted": "muted", "--line": "line", "--line-strong": "lineStrong", "--accent": "accent", "--accent-hover": "accentHover",
    "--accent-ink": "accentInk", "--accent-line": "accentLine", "--focus": "focus", "--focus-ring": "focusRing",
    "--focus-outline": "focusOutline", "--success": "success", "--good": "good", "--good-ink": "goodInk", "--good-bg": "goodBg",
    "--good-line": "goodLine", "--on-good": "onGood", "--warn": "warn", "--warn-ink": "warnInk", "--warn-bg": "warnBg",
    "--warn-line": "warnLine", "--bad": "bad", "--bad-ink": "badInk", "--bad-bg": "badBg", "--bad-line": "badLine",
    "--on-bad": "onBad", "--neutral": "neutral", "--track": "track", "--meter-mark": "meterMark", "--brand-bg": "brandBg",
    "--brand-ink": "brandInk", "--shadow": "shadow",
  };

  function applyToPopup(documentElement, id) {
    const t = tokens(id);
    for (const [name, key] of Object.entries(POPUP_VARS)) documentElement.style.setProperty(name, t[key]);
    documentElement.style.setProperty("color-scheme", t.scheme);
    documentElement.dataset.theme = t.id;
  }

  // The LMS clear view's own variables. The default keeps its original look,
  // including following Moodle's dark mode.
  function lmsCss(id) {
    const t = tokens(id);
    if (t.id === DEFAULT) return "";
    const vars = {
      "--cc-bg": t.canvas, "--cc-surface": t.surface, "--cc-ink": t.ink, "--cc-muted": t.muted, "--cc-line": t.line,
      "--cc-hover": t.surface2, "--cc-accent": t.accent, "--cc-accent-ink": t.accentInk,
      "--cc-link": readable(t.accent, t.surface, 4.5, t.ink), "--cc-focus": t.focus,
    };
    const body = Object.entries(vars).map(([name, value]) => `${name}:${value} !important;`).join("");
    return `html[data-cc-theme] body.cc-lms,html[data-cc-theme] #cc-toolbar,html[data-cc-theme] .cc-sign-in{${body}}
html[data-cc-theme].cc-lms-pending{background:${t.canvas} !important}`;
  }

  // The toolbar icon: the "//" mark in the theme's brand colours.
  function drawIcon(size, id, Canvas = root.OffscreenCanvas) {
    const t = tokens(id);
    const canvas = new Canvas(size, size);
    const ctx = canvas.getContext("2d");
    const s = size / 96;
    const radius = 22 * s;
    ctx.fillStyle = t.brandBg;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.arcTo(size, 0, size, size, radius);
    ctx.arcTo(size, size, 0, size, radius);
    ctx.arcTo(0, size, 0, 0, radius);
    ctx.arcTo(0, 0, size, 0, radius);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = t.brandInk;
    for (const [x1, x2, x3, x4] of [[24, 42, 55, 37], [48, 66, 79, 61]]) {
      ctx.beginPath();
      ctx.moveTo(x1 * s, 67 * s);
      ctx.lineTo(x2 * s, 29 * s);
      ctx.lineTo(x3 * s, 29 * s);
      ctx.lineTo(x4 * s, 67 * s);
      ctx.closePath();
      ctx.fill();
    }
    return ctx.getImageData(0, 0, size, size);
  }

  // ---- choice ----

  function valid(id) {
    return PALETTES.some((entry) => entry.id === id) ? id : DEFAULT;
  }

  // A synchronous copy in the page's own storage, so the first frame already
  // has the right colours. chrome.storage stays the source of truth.
  function mirrored() {
    try {
      return valid(root.localStorage?.getItem(MIRROR_KEY));
    } catch {
      return DEFAULT;
    }
  }

  function mirror(id) {
    try {
      root.localStorage?.setItem(MIRROR_KEY, valid(id));
    } catch {}
  }

  async function load() {
    try {
      const stored = await root.chrome.storage.local.get({ [STORE_KEY]: DEFAULT });
      const id = valid(stored[STORE_KEY]);
      mirror(id);
      return id;
    } catch {
      return mirrored();
    }
  }

  function save(id) {
    mirror(id);
    try {
      return root.chrome.storage.local.set({ [STORE_KEY]: valid(id) });
    } catch {
      return Promise.resolve();
    }
  }

  function onChange(callback) {
    try {
      root.chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[STORE_KEY]) return;
        const id = valid(changes[STORE_KEY].newValue);
        mirror(id);
        callback(id);
      });
    } catch {}
  }

  root.CuimsThemes = {
    DEFAULT,
    STORE_KEY,
    list: PALETTES.map(({ id, name, scheme }) => ({ id, name, scheme })),
    tokens,
    contrast,
    applyToPopup,
    lmsCss,
    drawIcon,
    valid,
    mirrored,
    load,
    save,
    onChange,
  };
})(globalThis);
