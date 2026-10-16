importScripts(
  "keep-awake.js",
  "lms-open.js",
  "themes.js",
  "theme-bg.js",
  "captcha-glyphs.js",
  "captcha-solver.js",
  "attendance-parse.js",
  "academic-calendar.js",
  "attendance-model.js",
  "attendance-client.js",
  "ledger.js",
  "attendance-daemon.js",
  "attendance-bg.js",
  "update-check.js",
  "update-bg.js",
  "celebrate-bg.js",
);

// The captcha solver is plain JavaScript and decodes the captcha with
// createImageBitmap and OffscreenCanvas, so it runs in this worker: there is
// no offscreen page and no OCR engine.
