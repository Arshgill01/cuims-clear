// Core CAPTCHA preprocessing, candidate generation, and post-processing heuristics.
// Shared logic used by content script, background worker, and test suite.

export function rgbToGrayscale(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

export function computeOtsuThreshold(grayPixels) {
  const histogram = new Array(256).fill(0);
  const total = grayPixels.length;

  for (let i = 0; i < total; i++) {
    histogram[grayPixels[i]]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumB += t * histogram[t];
    const meanBackground = sumB / weightBackground;
    const meanForeground = (sum - sumB) / weightForeground;

    const varianceBetween =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);

    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      threshold = t;
    }
  }

  return threshold;
}

export function isDarkBackground(grayPixels, width, height, threshold) {
  let darkBorderPixels = 0;
  let totalBorderPixels = 0;

  for (let x = 0; x < width; x++) {
    if (grayPixels[x] < threshold) darkBorderPixels++;
    if (grayPixels[(height - 1) * width + x] < threshold) darkBorderPixels++;
    totalBorderPixels += 2;
  }

  for (let y = 1; y < height - 1; y++) {
    if (grayPixels[y * width] < threshold) darkBorderPixels++;
    if (grayPixels[y * width + (width - 1)] < threshold) darkBorderPixels++;
    totalBorderPixels += 2;
  }

  return darkBorderPixels / totalBorderPixels > 0.5;
}

export function binarizeAndDespeckle(rgbaData, width, height) {
  const totalPixels = width * height;
  const grayPixels = new Uint8ClampedArray(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    grayPixels[i] = rgbToGrayscale(
      rgbaData[idx],
      rgbaData[idx + 1],
      rgbaData[idx + 2],
    );
  }

  let threshold = computeOtsuThreshold(grayPixels);
  if (threshold < 110) threshold = 125;

  const darkBg = isDarkBackground(grayPixels, width, height, threshold);

  const binary = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const isText = darkBg ? grayPixels[i] >= threshold : grayPixels[i] < threshold;
    binary[i] = isText ? 1 : 0;
  }

  const cleaned = new Uint8Array(binary);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (binary[idx] === 1) {
        const neighborCount =
          binary[idx - width - 1] +
          binary[idx - width] +
          binary[idx - width + 1] +
          binary[idx - 1] +
          binary[idx + 1] +
          binary[idx + width - 1] +
          binary[idx + width] +
          binary[idx + width + 1];

        if (neighborCount === 0) {
          cleaned[idx] = 0;
        }
      }
    }
  }

  const output = new Uint8ClampedArray(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const outIdx = i * 4;
    const val = cleaned[i] === 1 ? 0 : 255;
    output[outIdx] = val;
    output[outIdx + 1] = val;
    output[outIdx + 2] = val;
    output[outIdx + 3] = 255;
  }

  return { data: output, threshold, darkBg };
}

export function contrastStretchGrayscale(rgbaData, width, height) {
  const totalPixels = width * height;
  const grayPixels = new Uint8ClampedArray(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    grayPixels[i] = rgbToGrayscale(
      rgbaData[idx],
      rgbaData[idx + 1],
      rgbaData[idx + 2],
    );
  }

  const sorted = Array.from(grayPixels).sort((a, b) => a - b);
  const pLow = sorted[Math.floor(totalPixels * 0.02)] || 0;
  const pHigh = sorted[Math.floor(totalPixels * 0.98)] || 255;
  const range = Math.max(1, pHigh - pLow);

  const output = new Uint8ClampedArray(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const outIdx = i * 4;
    const rawVal = grayPixels[i];
    const stretched = Math.min(255, Math.max(0, Math.round(((rawVal - pLow) / range) * 255)));
    output[outIdx] = stretched;
    output[outIdx + 1] = stretched;
    output[outIdx + 2] = stretched;
    output[outIdx + 3] = 255;
  }

  return { data: output, pLow, pHigh };
}

export function sanitizeCaptchaText(text) {
  if (!text) return "";
  return text.replace(/[^0-9a-zA-Z]/g, "").trim();
}

export function scoreCandidate(text, confidence) {
  let score = Number(confidence || 0);
  const len = (text || "").length;

  if (len >= 4 && len <= 6) {
    score += 25;
  } else if (len > 6) {
    score -= (len - 6) * 15;
  } else if (len < 4) {
    score -= (4 - len) * 20;
  }

  return score;
}
