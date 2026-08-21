import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "../work/tesseract-build/node_modules/tesseract.js/src/index.js";
import { sanitizeCaptchaText } from "./captcha-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("Real CUIMS portal CAPTCHA ('ofh7') is recognized accurately", async (t) => {
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

  const imgBuf = fs.readFileSync(path.resolve(__dirname, "../work/real-cuims-captcha.png"));
  const { data } = await worker.recognize(imgBuf);

  const recognized = sanitizeCaptchaText(data.text || "");
  console.log("Real CAPTCHA recognized as:", recognized, "Confidence:", data.confidence);

  assert.equal(recognized.toLowerCase(), "ofh7", `Expected ofh7, got ${recognized}`);
  assert.ok(data.confidence >= 60, `Confidence should be >= 60 (got ${data.confidence})`);
});
