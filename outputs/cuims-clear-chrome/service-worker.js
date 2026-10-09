importScripts(
  "lms-open.js",
  "themes.js",
  "theme-bg.js",
  "captcha-glyphs.js",
  "captcha-solver.js",
  "attendance-parse.js",
  "attendance-model.js",
  "attendance-client.js",
  "marks.js",
  "timetable.js",
  "attendance-daemon.js",
  "attendance-bg.js",
);

// The captcha solver is plain JavaScript and decodes the captcha with
// createImageBitmap and OffscreenCanvas, so it runs in this worker: there is
// no offscreen page and no OCR engine.
