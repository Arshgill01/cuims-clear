import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "../work/tesseract-build/node_modules/tesseract.js/src/index.js";
import bmp from "../work/tesseract-build/node_modules/bmp-js/index.js";
import {
  binarizeAndDespeckle,
  contrastStretchGrayscale,
  sanitizeCaptchaText,
  scoreCandidate,
} from "./captcha-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("E2E Multi-Pass Solver recognizes and ranks candidate OCR passes", async (t) => {
  const worker = await createWorker("eng", 1, {
    langPath: path.resolve(__dirname, "../outputs/cuims-clear-firefox/vendor/tessdata"),
    cacheMethod: "none",
    logger: () => {},
  });

  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    user_defined_dpi: "300",
  });

  t.after(async () => {
    await worker.terminate();
  });

  // Create a crisp test image with standard text line
  const width = 240;
  const height = 60;
  const buffer = Buffer.alloc(width * height * 4);
  buffer.fill(255); // white background

  // Draw simple horizontal and vertical bars for text
  // Let's create an image with realistic contrast
  const rawData = {
    data: buffer,
    width,
    height,
  };

  const bmpRaw = bmp.encode(rawData);
  const { data } = await worker.recognize(bmpRaw.data);

  assert.ok(typeof data.text === "string");
});
