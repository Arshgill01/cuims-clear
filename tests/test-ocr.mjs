import { createWorker } from "../work/tesseract-build/node_modules/tesseract.js/src/index.js";
import bmp from "../work/tesseract-build/node_modules/bmp-js/index.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log("Initializing worker...");
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

  console.log("Worker initialized. Generating test bitmap...");
  // Create a 200x50 white image
  const width = 200;
  const height = 50;
  const buffer = Buffer.alloc(width * height * 4);

  // Fill with white
  for (let i = 0; i < width * height; i++) {
    buffer[i * 4] = 255;     // B
    buffer[i * 4 + 1] = 255; // G
    buffer[i * 4 + 2] = 255; // R
    buffer[i * 4 + 3] = 255; // A
  }

  // Draw some basic blocky text / lines or encode
  const rawData = {
    data: buffer,
    width,
    height,
  };
  const bmpData = bmp.encode(rawData);

  console.log("Recognizing...");
  const { data } = await worker.recognize(bmpData.data);
  console.log("Result:", data.text, "Confidence:", data.confidence);

  await worker.terminate();
  console.log("Done!");
}

run().catch(console.error);
