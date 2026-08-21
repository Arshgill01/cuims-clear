const DEFAULT_SETTINGS = {
  uid: "",
  password: "",
  autoAdvanceUid: true,
  autoSolveCaptcha: true,
  autoSubmitLogin: true,
  blockEvents: true,
  blockFeedback: true,
};

const HOME_URL = "https://students.cuchd.in/StudentHome.aspx";

const MODAL_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  ".modal.in",
  ".modal.show",
  ".ui-dialog",
  ".swal-overlay",
  ".sweet-alert",
  ".swal2-container",
  "#divSubjectFeedback",
];

const EVENT_WORDS = [
  "event",
  "workshop",
  "seminar",
  "fest",
  "competition",
  "register now",
];

const FEEDBACK_WORDS = [
  "feedback",
  "survey",
  "rate your",
  "rating",
  "share your experience",
];

// Wrong captcha answers reload step 2 with a fresh image, so each auto
// submission is bounded and the whole loop gives up into manual mode.
const CAPTCHA_ATTEMPTS_KEY = "cuimsClearCaptchaAttempts";
const MAX_CAPTCHA_ATTEMPTS = 3;
const CAPTCHA_PLACEHOLDER = "Enter captcha";

let settings = { ...DEFAULT_SETTINGS };
const suppressedElements = new Map();
let scanQueued = false;
let programmaticEdit = false;
let prewarmed = false;

function dispatchFieldEvents(field) {
  programmaticEdit = true;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  programmaticEdit = false;
}

function prewarmSolver() {
  if (prewarmed) return;
  prewarmed = true;
  try {
    chrome.runtime.sendMessage({ type: "cuims-clear:prewarm" }, () => {});
  } catch {}
}

function prepareLogin() {
  const uidField = document.querySelector("#txtUserId, input[name='txtUserId']");
  const nextButton = document.querySelector("#btnNext, input[name='btnNext']");

  if (settings.autoSolveCaptcha) {
    prewarmSolver();
  }

  if (uidField) {
    uidField.autocomplete = "username";

    if (settings.uid && uidField.value !== settings.uid) {
      uidField.value = settings.uid;
      dispatchFieldEvents(uidField);
    }

    const advancedAt = Number(sessionStorage.getItem("cuimsClearAdvancedAt") || 0);
    const canAdvanceAgain = Date.now() - advancedAt > 10_000;

    if (
      settings.uid &&
      settings.autoAdvanceUid &&
      nextButton &&
      uidField.value === settings.uid &&
      canAdvanceAgain
    ) {
      sessionStorage.setItem("cuimsClearAdvancedAt", String(Date.now()));
      nextButton.click();
    }
  }

  const passwordField = document.querySelector(
    "input[type='password'], #txtPassword, input[name*='Password' i]",
  );

  if (passwordField) {
    passwordField.autocomplete = "current-password";

    if (settings.password && passwordField.value !== settings.password) {
      passwordField.value = settings.password;
      dispatchFieldEvents(passwordField);
    }
  }

  prepareCaptchaStep(passwordField);
}

function captchaAttempts() {
  return Number(sessionStorage.getItem(CAPTCHA_ATTEMPTS_KEY) || 0);
}

function prepareCaptchaStep(passwordField) {
  const captchaImage = document.querySelector("#imgCaptcha, img[src*='GenerateCaptcha' i]");

  if (!captchaImage) {
    // Any page without the captcha image starts a fresh attempt budget.
    sessionStorage.removeItem(CAPTCHA_ATTEMPTS_KEY);
    return;
  }

  // Handle dynamic captcha refresh / image reload
  if (
    captchaImage.dataset.cuimsClearSolved &&
    captchaImage.dataset.cuimsClearSolved !== captchaImage.src
  ) {
    delete captchaImage.dataset.cuimsClearSolved;
    delete captchaImage.dataset.cuimsClearSolving;
  }

  const captchaField = document.querySelector(
    "input[id*='captcha' i], input[name*='captcha' i], input[placeholder*='captcha' i]",
  );
  if (!captchaField) return;

  const attemptsExhausted = captchaAttempts() >= MAX_CAPTCHA_ATTEMPTS;
  const canSolve =
    settings.autoSolveCaptcha &&
    settings.password &&
    passwordField?.value &&
    !attemptsExhausted;

  if (!canSolve) {
    enhanceManualEntry(captchaImage, captchaField, attemptsExhausted);
    return;
  }

  // Ignore scans until the image has decoded, and only ever solve the image
  // currently displayed — the captcha answer is tied to it server-side.
  if (!captchaImage.complete || captchaImage.naturalWidth === 0) {
    if (!captchaImage.dataset.cuimsClearWaiting) {
      captchaImage.dataset.cuimsClearWaiting = "1";
      captchaImage.addEventListener(
        "load",
        () => queueScan(),
        { once: true },
      );
    }
    return;
  }

  const solved = captchaImage.dataset.cuimsClearSolved === captchaImage.src;
  const solving = captchaImage.dataset.cuimsClearSolving === captchaImage.src;
  if (solved || solving) return;

  captchaImage.dataset.cuimsClearSolving = captchaImage.src;
  solveCaptchaImage(captchaImage, captchaField, passwordField);
}

function enhanceManualEntry(captchaImage, captchaField, attemptsExhausted) {
  if (captchaImage.dataset.cuimsClearEnlarged) return;

  captchaImage.dataset.cuimsClearEnlarged = "1";
  captchaImage.style.setProperty("width", "220px", "important");
  captchaImage.style.setProperty("height", "66px", "important");

  if (attemptsExhausted && settings.autoSolveCaptcha) {
    captchaField.placeholder = "Auto-solve gave up — please type";
  }

  captchaField.focus();
}

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

  const threshold = computeOtsuThreshold(grayPixels);
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

function renderScaledAndPaddedCanvas(pixelData, width, height, scale = 3, padding = 12) {
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
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = "high";
  finalCtx.drawImage(tempCanvas, padding, padding, width * scale, height * scale);

  return finalCanvas.toDataURL("image/png");
}

function extractCaptchaVariants(captchaImage) {
  const w = captchaImage.naturalWidth;
  const h = captchaImage.naturalHeight;
  if (!w || !h) return [];

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = w;
  rawCanvas.height = h;
  const rawCtx = rawCanvas.getContext("2d");
  rawCtx.drawImage(captchaImage, 0, 0);
  const rawImgData = rawCtx.getImageData(0, 0, w, h);

  const binarizedPixels = binarizeAndDespeckle(rawImgData.data, w, h);
  const pass1 = renderScaledAndPaddedCanvas(binarizedPixels, w, h, 3, 12);

  const contrastPixels = contrastStretchGrayscale(rawImgData.data, w, h);
  const pass2 = renderScaledAndPaddedCanvas(contrastPixels, w, h, 3, 12);

  const pass3 = renderScaledAndPaddedCanvas(rawImgData.data, w, h, 3, 12);

  return [pass1, pass2, pass3];
}

async function solveCaptchaImage(captchaImage, captchaField, passwordField) {
  captchaField.placeholder = "Solving on-device…";

  try {
    const candidates = extractCaptchaVariants(captchaImage);
    if (!candidates.length) throw new Error("Could not extract image");

    const solution = await chrome.runtime.sendMessage({
      type: "cuims-clear:solve-captcha",
      candidates,
    });

    if (solution?.error) throw new Error(solution.error);

    const text = (solution?.text || "").trim();
    // 4 to 6 characters are expected; anything outside is a misread
    if (text.length < 4 || text.length > 6) throw new Error("unconvincing read");

    captchaField.value = text;
    dispatchFieldEvents(captchaField);

    const confidence = Number(solution?.confidence ?? 0);
    const loginButton = document.querySelector("#btnLogin, input[name='btnLogin']");

    if (
      settings.autoSubmitLogin &&
      confidence >= 65 &&
      loginButton &&
      passwordField?.value &&
      !captchaField.dataset.cuimsClearUserEdited
    ) {
      sessionStorage.setItem(CAPTCHA_ATTEMPTS_KEY, String(captchaAttempts() + 1));
      await delay(400 + Math.random() * 300);
      if (
        captchaField.value === text &&
        passwordField.value &&
        !captchaField.dataset.cuimsClearUserEdited
      ) {
        loginButton.click();
      }
    } else if (confidence < 65) {
      captchaField.placeholder = "Auto-solve unsure — please check";
      enhanceManualEntry(captchaImage, captchaField, false);
    }
  } catch {
    captchaField.placeholder = "Auto-solve unsure — please type";
    enhanceManualEntry(captchaImage, captchaField, false);
    return;
  }

  captchaImage.dataset.cuimsClearSolved = captchaImage.src;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyModal(element) {
  const text = (element.innerText || element.textContent || "").toLowerCase();
  const isEvent = EVENT_WORDS.some((word) => text.includes(word));
  const isFeedback = FEEDBACK_WORDS.some((word) => text.includes(word));

  if (settings.blockEvents && isEvent) return "event";
  if (settings.blockFeedback && isFeedback) return "feedback";
  return null;
}

function suppress(element, category) {
  if (element.dataset.cuimsClearSuppressed) return;

  suppressedElements.set(element, {
    display: element.style.getPropertyValue("display"),
    priority: element.style.getPropertyPriority("display"),
  });

  element.dataset.cuimsClearSuppressed = category;
  element.style.setProperty("display", "none", "important");
}

function cleanupBackdrop() {
  const visibleModal = MODAL_SELECTORS.some((selector) =>
    [...document.querySelectorAll(selector)].some(
      (element) =>
        !element.dataset.cuimsClearSuppressed &&
        getComputedStyle(element).display !== "none",
    ),
  );

  if (visibleModal) return;

  document
    .querySelectorAll(".modal-backdrop, .ui-widget-overlay, .swal2-backdrop-show")
    .forEach((backdrop) => suppress(backdrop, "backdrop"));

  document.body?.classList.remove("modal-open");
  document.body?.style.removeProperty("overflow");
  document.body?.style.removeProperty("padding-right");
}

function scanPage() {
  scanQueued = false;
  prepareLogin();

  for (const selector of MODAL_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => {
      const category = classifyModal(element);
      if (category) suppress(element, category);
    });
  }

  cleanupBackdrop();
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(scanPage);
}

function restoreSuppressed() {
  for (const [element, original] of suppressedElements) {
    if (!element.isConnected) continue;

    element.removeAttribute("data-cuims-clear-suppressed");
    if (original.display) {
      element.style.setProperty("display", original.display, original.priority);
    } else {
      element.style.removeProperty("display");
    }
  }

  suppressedElements.clear();
}

function markUserEdits() {
  document.addEventListener(
    "input",
    (event) => {
      const field = event.target;
      if (!(field instanceof HTMLElement)) return;
      if (field.id?.toLowerCase().includes("captcha") && !programmaticEdit) {
        field.dataset.cuimsClearUserEdited = "1";
        if (field.placeholder !== CAPTCHA_PLACEHOLDER) {
          field.placeholder = CAPTCHA_PLACEHOLDER;
        }
      }
    },
    true,
  );
}

function startExtension() {
  chrome.storage.local.get(DEFAULT_SETTINGS, (storedSettings) => {
    settings = storedSettings;
    markUserEdits();
    scanPage();

    new MutationObserver(queueScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  let settingsChanged = false;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (changes[key]) {
      settings[key] = changes[key].newValue;
      settingsChanged = true;
    }
  }

  if (!settingsChanged) return;
  restoreSuppressed();
  queueScan();
});

if (location.pathname.toLowerCase().endsWith("/landingpage.aspx")) {
  location.replace(HOME_URL);
} else if (document.documentElement) {
  startExtension();
} else {
  document.addEventListener("DOMContentLoaded", startExtension, { once: true });
}
