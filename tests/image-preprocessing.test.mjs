import test from "node:test";
import assert from "node:assert/strict";
import {
  rgbToGrayscale,
  computeOtsuThreshold,
  isDarkBackground,
  binarizeAndDespeckle,
  contrastStretchGrayscale,
} from "./captcha-engine.mjs";

test("rgbToGrayscale correctly applies luminance weights", () => {
  assert.equal(rgbToGrayscale(255, 255, 255), 255);
  assert.equal(rgbToGrayscale(0, 0, 0), 0);
  assert.equal(rgbToGrayscale(255, 0, 0), 76); // 0.299 * 255 ≈ 76
  assert.equal(rgbToGrayscale(0, 255, 0), 150); // 0.587 * 255 ≈ 150
  assert.equal(rgbToGrayscale(0, 0, 255), 29); // 0.114 * 255 ≈ 29
});

test("computeOtsuThreshold finds optimal bimodal separation", () => {
  // Synthesize a bimodal distribution: 50 dark pixels (value 30) and 50 light pixels (value 220)
  const pixels = new Uint8ClampedArray(100);
  for (let i = 0; i < 50; i++) pixels[i] = 30;
  for (let i = 50; i < 100; i++) pixels[i] = 220;

  const threshold = computeOtsuThreshold(pixels);
  assert.ok(threshold >= 30 && threshold <= 220, `Threshold ${threshold} should be between peaks`);
});

test("isDarkBackground detects light-on-dark vs dark-on-light", () => {
  const width = 10;
  const height = 10;

  // Light background (border is 240)
  const lightBg = new Uint8ClampedArray(100).fill(240);
  // Put dark text in center
  for (let y = 3; y < 7; y++) {
    for (let x = 3; x < 7; x++) lightBg[y * width + x] = 20;
  }
  assert.equal(isDarkBackground(lightBg, width, height, 128), false);

  // Dark background (border is 20)
  const darkBg = new Uint8ClampedArray(100).fill(20);
  // Put light text in center
  for (let y = 3; y < 7; y++) {
    for (let x = 3; x < 7; x++) darkBg[y * width + x] = 240;
  }
  assert.equal(isDarkBackground(darkBg, width, height, 128), true);
});

test("binarizeAndDespeckle cleans isolated salt noise", () => {
  const width = 5;
  const height = 5;
  // 5x5 white background image (255)
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);

  // Add 1 isolated black noise speck at (2, 2)
  const centerIdx = (2 * width + 2) * 4;
  rgba[centerIdx] = 0;
  rgba[centerIdx + 1] = 0;
  rgba[centerIdx + 2] = 0;

  const result = binarizeAndDespeckle(rgba, width, height);

  // Center speck should be cleaned to white (255)
  const outCenter = (2 * width + 2) * 4;
  assert.equal(result.data[outCenter], 255, "Isolated speck should be removed");
  assert.equal(result.data[outCenter + 1], 255);
  assert.equal(result.data[outCenter + 2], 255);
});

test("contrastStretchGrayscale expands dynamic range", () => {
  const width = 10;
  const height = 10;
  const rgba = new Uint8ClampedArray(width * height * 4);

  // Fill with compressed range: 100 to 150
  for (let i = 0; i < width * height; i++) {
    const val = 100 + (i % 51);
    rgba[i * 4] = val;
    rgba[i * 4 + 1] = val;
    rgba[i * 4 + 2] = val;
    rgba[i * 4 + 3] = 255;
  }

  const stretched = contrastStretchGrayscale(rgba, width, height);
  assert.ok(stretched.pLow >= 100 && stretched.pLow <= 110);
  assert.ok(stretched.pHigh >= 140 && stretched.pHigh <= 150);

  // Values near pLow should be mapped to near 0, values near pHigh mapped to near 255
  let hasNearZero = false;
  let hasNearMax = false;
  for (let i = 0; i < width * height; i++) {
    const v = stretched.data[i * 4];
    if (v <= 15) hasNearZero = true;
    if (v >= 240) hasNearMax = true;
  }
  assert.ok(hasNearZero, "Dynamic range should include low values");
  assert.ok(hasNearMax, "Dynamic range should include high values");
});
