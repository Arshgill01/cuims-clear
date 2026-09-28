// CAPTCHA image cleanup shared by the login page and the background sign-in.
// Needs a DOM canvas: the content script has one, and so does the Firefox
// background page.

function rgbToGrayscale(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function computeOtsuThreshold(grayPixels) {
  const histogram = new Array(256).fill(0);
  const total = grayPixels.length;
  for (let i = 0; i < total; i++) histogram[grayPixels[i]]++;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

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
      weightBackground * weightForeground * (meanBackground - meanForeground) * (meanBackground - meanForeground);
    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      threshold = t;
    }
  }
  return threshold;
}

function isDarkBackground(grayPixels, width, height, threshold) {
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

function binarizeAndDespeckle(rgbaData, width, height) {
  const totalPixels = width * height;
  const grayPixels = new Uint8ClampedArray(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    grayPixels[i] = rgbToGrayscale(rgbaData[idx], rgbaData[idx + 1], rgbaData[idx + 2]);
  }

  // Enforce strict noise floor: CUIMS hatching lines are intensity 170-235.
  // Clamping threshold between 120 and 155 vaporizes 100% of hatching lines.
  let threshold = computeOtsuThreshold(grayPixels);
  if (threshold < 120) threshold = 135;
  if (threshold > 155) threshold = 155;

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
          binary[idx - width - 1] + binary[idx - width] + binary[idx - width + 1] +
          binary[idx - 1] + binary[idx + 1] +
          binary[idx + width - 1] + binary[idx + width] + binary[idx + width + 1];
        if (neighborCount === 0) cleaned[idx] = 0;
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
  return output;
}

function contrastStretchGrayscale(rgbaData, width, height) {
  const totalPixels = width * height;
  const grayPixels = new Uint8ClampedArray(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    grayPixels[i] = rgbToGrayscale(rgbaData[idx], rgbaData[idx + 1], rgbaData[idx + 2]);
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
  return output;
}

function findInkBounds(rgbaData, width, height, padding = 3) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgbaData[(y * width + x) * 4] < 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return { x: 0, y: 0, width, height };
  }

  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);

  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
  };
}

function cropRgba(rgbaData, width, height, bounds) {
  if (
    bounds.x === 0 &&
    bounds.y === 0 &&
    bounds.width === width &&
    bounds.height === height
  ) {
    return { data: rgbaData, width, height };
  }

  const output = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row++) {
    const srcOffset = ((bounds.y + row) * width + bounds.x) * 4;
    const dstOffset = row * bounds.width * 4;
    output.set(rgbaData.subarray(srcOffset, srcOffset + bounds.width * 4), dstOffset);
  }

  return { data: output, width: bounds.width, height: bounds.height };
}

function renderScaledAndPaddedCanvas(pixelData, width, height, scale = 3, padding = 12, smooth = true) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext("2d");
  const imgData = tempCtx.createImageData(width, height);
  imgData.data.set(pixelData);
  tempCtx.putImageData(imgData, 0, 0);

  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = width * scale + padding * 2;
  finalCanvas.height = height * scale + padding * 2;
  const finalCtx = finalCanvas.getContext("2d");

  finalCtx.fillStyle = "#ffffff";
  finalCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  finalCtx.imageSmoothingEnabled = smooth;
  if (smooth) finalCtx.imageSmoothingQuality = "high";
  finalCtx.drawImage(tempCanvas, padding, padding, width * scale, height * scale);

  return finalCanvas.toDataURL("image/png");
}

function extractCaptchaVariants(captchaImage) {
  const w = captchaImage.naturalWidth || captchaImage.width || 150;
  const h = captchaImage.naturalHeight || captchaImage.height || 50;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = w;
  rawCanvas.height = h;
  const rawCtx = rawCanvas.getContext("2d");
  rawCtx.drawImage(captchaImage, 0, 0, w, h);

  try {
    const rawImgData = rawCtx.getImageData(0, 0, w, h);

    const binarizedPixels = binarizeAndDespeckle(rawImgData.data, w, h);
    const contrastPixels = contrastStretchGrayscale(rawImgData.data, w, h);
    const bounds = findInkBounds(binarizedPixels, w, h, 3);
    const binCrop = cropRgba(binarizedPixels, w, h, bounds);
    const contrastCrop = cropRgba(contrastPixels, w, h, bounds);
    const rawCrop = cropRgba(rawImgData.data, w, h, bounds);

    const pass1 = renderScaledAndPaddedCanvas(
      binCrop.data,
      binCrop.width,
      binCrop.height,
      3,
      12,
      false,
    );
    const pass2 = renderScaledAndPaddedCanvas(
      contrastCrop.data,
      contrastCrop.width,
      contrastCrop.height,
      3,
      12,
      true,
    );
    const pass3 = renderScaledAndPaddedCanvas(
      rawCrop.data,
      rawCrop.width,
      rawCrop.height,
      3,
      12,
      true,
    );

    return [pass1, pass2, pass3];
  } catch (err) {
    console.warn("[CUIMS Clear] Direct canvas fallback:", err);
    return [rawCanvas.toDataURL("image/png")];
  }
}

// ---- Fixed-font glyph geometry correction ----
// The CUIMS CAPTCHA uses a fixed bold serif font. Tesseract reads glyph shapes
// well but confuses case for height-ambiguous letters (V/v, C/c, S/s, ...) and
// the letter O versus the digit 0. We rebuild a colour-aware ink mask, split it
// into per-glyph columns, and use each glyph's height and width to correct only
// those specific cases — every other character is left exactly as Tesseract read
// it, so a correct read is never made worse.
const GEOM_CASELESS = new Set("cCoOsSuUvVwWxXzZ".split(""));

function buildCaptchaMask(img) {
  const w = img.naturalWidth || img.width || 100;
  const h = img.naturalHeight || img.height || 30;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext && canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || typeof ctx.drawImage !== "function") return null;

  let data;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  if (!data || data.length < w * h * 4) return null;

  const total = w * h;
  const lum = new Float32Array(total);
  const hist = new Array(256).fill(0);
  let lowSat = 0;

  // Text is near-black (low luminance) and unsaturated; background noise is
  // usually coloured. Build the Otsu threshold only from low-saturation pixels
  // so coloured hatching/checkerboards do not drag the threshold around.
  for (let i = 0; i < total; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const S = Math.max(r, g, b) - Math.min(r, g, b);
    lum[i] = L;
    if (S < 70) {
      hist[Math.round(L)]++;
      lowSat++;
    }
  }
  if (lowSat === 0) return null;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = lowSat - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thr = t;
    }
  }
  if (thr < 120) thr = 135;
  if (thr > 170) thr = 170;

  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const S = Math.max(r, g, b) - Math.min(r, g, b);
    mask[i] = lum[i] < thr && S < 80 ? 1 : 0;
  }

  // Despeckle: drop connected components smaller than 8 px (isolated noise).
  const seen = new Uint8Array(total);
  const stack = [];
  for (let i = 0; i < total; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const comp = [i];
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const np = ny * w + nx;
          if (mask[np] && !seen[np]) {
            seen[np] = 1;
            stack.push(np);
            comp.push(np);
          }
        }
      }
    }
    if (comp.length < 8) for (const p of comp) mask[p] = 0;
  }

  return { w, h, mask };
}

function segmentGlyphColumns(w, h, mask, target) {
  const col = new Int32Array(w);
  let minx = w;
  let maxx = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        col[x]++;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
      }
    }
  }
  if (maxx < 0) return null;

  const segs = [];
  let s = -1;
  for (let x = minx; x <= maxx; x++) {
    if (col[x] > 0) {
      if (s < 0) s = x;
    } else if (s >= 0) {
      segs.push([s, x - 1]);
      s = -1;
    }
  }
  if (s >= 0) segs.push([s, maxx]);

  // Bold glyphs frequently touch, so a whole-word blob can hold several
  // characters. Split the widest segment at its lightest interior column until
  // the segment count matches the number of characters Tesseract reported.
  let guard = 0;
  while (segs.length < target && guard++ < 20) {
    let wi = 0;
    for (let i = 1; i < segs.length; i++) {
      if (segs[i][1] - segs[i][0] > segs[wi][1] - segs[wi][0]) wi = i;
    }
    const [a, b] = segs[wi];
    if (b - a < 6) break;
    let best = -1;
    let bv = Infinity;
    for (let x = a + 3; x <= b - 3; x++) {
      if (col[x] < bv) {
        bv = col[x];
        best = x;
      }
    }
    if (best < 0) break;
    segs.splice(wi, 1, [a, best - 1], [best, b]);
  }
  if (segs.length !== target) return null;

  return segs.map(([a, b]) => {
    const rows = new Int32Array(h);
    let x0 = w;
    let x1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = a; x <= b; x++) {
        if (mask[y * w + x]) {
          rows[y]++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      }
    }
    let peak = 0;
    for (let y = 0; y < h; y++) if (rows[y] > peak) peak = rows[y];
    const rthr = Math.max(1, peak * 0.15);
    let y0 = h;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      if (rows[y] >= rthr) {
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (y1 < 0) {
      y0 = 0;
      y1 = 0;
    }
    return { x0, y0, x1, y1 };
  });
}

function correctCaptchaCase(text, img) {
  if (!/^[0-9A-Za-z]+$/.test(text)) return text;
  const built = buildCaptchaMask(img);
  if (!built) return text;
  const boxes = segmentGlyphColumns(built.w, built.h, built.mask, text.length);
  if (!boxes) return text;

  const capH = Math.max(...boxes.map((b) => b.y1 - b.y0 + 1));
  if (capH < 8) return text;
  // A segment far wider than a glyph means the split failed; skip correction.
  for (const b of boxes) if (b.x1 - b.x0 + 1 > built.w * 0.5) return text;

  let out = "";
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    const b = boxes[i];
    const gh = b.y1 - b.y0 + 1;
    const gw = b.x1 - b.x0 + 1;
    const rel = gh / capH;
    const asp = gw / gh;
    if ("oO0".includes(c)) {
      if (rel <= 0.7) c = "o";
      else if (rel >= 0.85) c = asp >= 0.78 ? "O" : "0";
    } else if (GEOM_CASELESS.has(c)) {
      const upper = c.toUpperCase();
      if (rel >= 0.9) c = upper;
      else if (rel <= 0.7) c = upper.toLowerCase();
    }
    out += c;
  }
  return out;
}
