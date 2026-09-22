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

const CAPTCHA_PLACEHOLDER = "Enter captcha";
// Hard stop auto-submit well before CUIMS's ~5-fail / ~20-min lockout.
const MAX_AUTO_SUBMIT_ATTEMPTS = 3;
const LOCKOUT_COOLDOWN_MS = 20 * 60 * 1000;
const LOGIN_FAILURE_KEY = "cuimsClear.loginFailures";
const LOCKOUT_UNTIL_KEY = "cuimsClear.lockoutUntil";
const LAST_SUBMIT_AT_KEY = "cuimsClear.lastAutoSubmitAt";
const STATUS_ID = "cuims-clear-login-status";
const MIN_CAPTCHA_FILL_LEN = 3;
const MAX_CAPTCHA_FILL_LEN = 7;
const MIN_AUTO_SUBMIT_LEN = 4;
const MAX_AUTO_SUBMIT_LEN = 6;
const MIN_AUTO_SUBMIT_CONFIDENCE = 65;
const MIN_CONSENSUS_CONFIDENCE = 55;
const MIN_AUTO_SUBMIT_SCORE = 90;

const LOCKOUT_PATTERNS = [
  /try\s+after\s+\d+\s*min/i,
  /try\s+again\s+after\s+\d+/i,
  /account\s+(has\s+been\s+)?lock/i,
  /locked\s+(out|for\s+\d+)/i,
  /too\s+many\s+(failed\s+)?(login|attempt)/i,
  /temporarily\s+(disabled|locked|blocked)/i,
  /login\s+disabled\s+for/i,
];

const LOGIN_ERROR_PATTERNS = [
  /invalid\s+(user(\s*id)?|uid|password|captcha|login|credentials)/i,
  /incorrect\s+(user(\s*id)?|uid|password|captcha|credentials)/i,
  /wrong\s+(password|captcha|uid|user)/i,
  /login\s+failed/i,
  /authentication\s+failed/i,
  /captcha\s+(code\s+)?(is\s+)?(invalid|incorrect|wrong|mismatch)/i,
  /user\s*id\s+or\s+password/i,
];

let settings = { ...DEFAULT_SETTINGS };
const suppressedElements = new Map();
let scanQueued = false;
let programmaticEdit = false;
let prewarmed = false;
let solveGeneration = 0;
let lastErrorFingerprint = "";

function dispatchFieldEvents(field) {
  if (!field) return;
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

// Prefer origin-shared localStorage so all_frames cannot amplify the budget.
// Fall back for restricted / test VM contexts without a Window.
function failureStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {}
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {}
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage) return sessionStorage;
  } catch {}
  const root = typeof globalThis !== "undefined" ? globalThis : {};
  if (!root.__cuimsClearFailureMemory) {
    const map = new Map();
    root.__cuimsClearFailureMemory = {
      getItem(key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem(key, value) {
        map.set(key, String(value));
      },
      removeItem(key) {
        map.delete(key);
      },
    };
  }
  return root.__cuimsClearFailureMemory;
}

function readFailureState(now = Date.now()) {
  const store = failureStore();
  const lockoutUntil = Number(store.getItem(LOCKOUT_UNTIL_KEY) || 0);
  const failures = Number(store.getItem(LOGIN_FAILURE_KEY) || 0);
  const locked = lockoutUntil > now;
  return {
    failures: Number.isFinite(failures) ? Math.max(0, failures) : 0,
    lockoutUntil: Number.isFinite(lockoutUntil) ? lockoutUntil : 0,
    locked,
    budgetExhausted: failures >= MAX_AUTO_SUBMIT_ATTEMPTS,
  };
}

function recordAutoSubmit(now = Date.now()) {
  const store = failureStore();
  const state = readFailureState(now);
  const failures = state.failures + 1;
  store.setItem(LOGIN_FAILURE_KEY, String(failures));
  store.setItem(LAST_SUBMIT_AT_KEY, String(now));
  // Soft cool-down once the circuit opens — do not wait for CUIMS lockout text.
  if (failures >= MAX_AUTO_SUBMIT_ATTEMPTS) {
    const until = now + LOCKOUT_COOLDOWN_MS;
    store.setItem(LOCKOUT_UNTIL_KEY, String(Math.max(state.lockoutUntil, until)));
    return { failures, lockoutUntil: Math.max(state.lockoutUntil, until), locked: true, budgetExhausted: true };
  }
  return {
    failures,
    lockoutUntil: state.lockoutUntil,
    locked: state.locked,
    budgetExhausted: failures >= MAX_AUTO_SUBMIT_ATTEMPTS,
  };
}

function recordDetectedFailure({ lockout = false } = {}, now = Date.now()) {
  const store = failureStore();
  const state = readFailureState(now);
  const lastSubmit = Number(store.getItem(LAST_SUBMIT_AT_KEY) || 0);
  const recentSubmit = lastSubmit > 0 && now - lastSubmit < 20_000;

  if (lockout) {
    const until = Math.max(state.lockoutUntil, now + LOCKOUT_COOLDOWN_MS);
    store.setItem(LOCKOUT_UNTIL_KEY, String(until));
    const failures = Math.max(state.failures, MAX_AUTO_SUBMIT_ATTEMPTS);
    store.setItem(LOGIN_FAILURE_KEY, String(failures));
    return { failures, lockoutUntil: until, locked: true, budgetExhausted: true, counted: true };
  }

  // Auto-submit already reserved a budget slot; only surface messaging.
  if (recentSubmit) {
    return { ...state, counted: false };
  }

  // Manual Login (or undetected prior submit) still consumes budget once we see a reject.
  const failures = state.failures + 1;
  store.setItem(LOGIN_FAILURE_KEY, String(failures));
  if (failures >= MAX_AUTO_SUBMIT_ATTEMPTS) {
    const until = now + LOCKOUT_COOLDOWN_MS;
    store.setItem(LOCKOUT_UNTIL_KEY, String(until));
    return { failures, lockoutUntil: until, locked: true, budgetExhausted: true, counted: true };
  }
  return {
    failures,
    lockoutUntil: state.lockoutUntil,
    locked: false,
    budgetExhausted: failures >= MAX_AUTO_SUBMIT_ATTEMPTS,
    counted: true,
  };
}

function resetFailureState() {
  const store = failureStore();
  store.removeItem(LOGIN_FAILURE_KEY);
  store.removeItem(LOCKOUT_UNTIL_KEY);
  store.removeItem(LAST_SUBMIT_AT_KEY);
  lastErrorFingerprint = "";
}

function canAutoSubmit(now = Date.now()) {
  if (!settings.autoSubmitLogin) return { ok: false, reason: "disabled" };
  const state = readFailureState(now);
  if (state.locked) return { ok: false, reason: "lockout", state };
  if (state.budgetExhausted) return { ok: false, reason: "budget", state };
  return { ok: true, reason: "ok", state };
}

function mayAutoSubmitSolution(solution) {
  if (!solution || solution.error) return false;
  const text = String(solution.text || "").trim();
  const len = text.length;
  if (len < MIN_AUTO_SUBMIT_LEN || len > MAX_AUTO_SUBMIT_LEN) return false;
  const confidence = Number(solution.confidence || 0);
  const score = Number(solution.score || 0);
  const agreement = Number(solution.agreement || 1);
  if (agreement >= 2 && confidence >= MIN_CONSENSUS_CONFIDENCE) return true;
  if (confidence >= MIN_AUTO_SUBMIT_CONFIDENCE && score >= MIN_AUTO_SUBMIT_SCORE) {
    return true;
  }
  return false;
}

function loginPageHaystack() {
  const nodes = document.querySelectorAll(
    "#lblMessage, #lblError, #lblErrorMessage, .error, .errormessage, .validation-summary-errors, [id*='error' i], [id*='message' i], [class*='error' i], [class*='alert' i]",
  );
  const chunks = [];
  for (const node of nodes) {
    const text = (node.textContent || "").trim();
    if (text) chunks.push(text);
  }
  if (chunks.length === 0 && document.body) {
    chunks.push((document.body.innerText || document.body.textContent || "").slice(0, 4000));
  }
  return chunks.join("\n");
}

function detectPortalFailure() {
  const haystack = loginPageHaystack();
  if (!haystack) return null;
  if (LOCKOUT_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { kind: "lockout", haystack };
  }
  if (LOGIN_ERROR_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { kind: "error", haystack };
  }
  return null;
}

function showLoginStatus(message, tone = "info") {
  if (!document.body || !message) return;
  let el = document.getElementById(STATUS_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = STATUS_ID;
    el.setAttribute("role", "status");
    el.style.cssText = [
      "position:fixed",
      "left:16px",
      "right:16px",
      "bottom:16px",
      "z-index:2147483646",
      "max-width:420px",
      "margin:0 auto",
      "padding:12px 14px",
      "border-radius:8px",
      "font:600 13px/1.4 system-ui,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.18)",
    ].join(";");
    document.body.appendChild(el);
  }
  el.dataset.tone = tone;
  el.style.background = tone === "danger" ? "#3b1418" : tone === "warn" ? "#3a2a10" : "#142033";
  el.style.color = tone === "danger" ? "#ffd7dc" : tone === "warn" ? "#ffe6b8" : "#d7e7ff";
  el.textContent = message;
}

function clearLoginStatus() {
  document.getElementById(STATUS_ID)?.remove();
}

function formatLockoutMessage(lockoutUntil, now = Date.now()) {
  const minutes = Math.max(1, Math.ceil(Math.max(0, lockoutUntil - now) / 60_000));
  return `CUIMS may lock accounts after repeated failed logins. Auto-submit paused for ~${minutes} min. Enter the captcha manually when ready.`;
}

function formatBudgetMessage(failures) {
  return `Auto-submit stopped after ${failures} attempt${failures === 1 ? "" : "s"} to avoid account lockout. Check the captcha and click Login yourself.`;
}

function hasLoginControls() {
  return Boolean(
    document.querySelector(
      "#imgCaptcha, img[src*='GenerateCaptcha' i], #btnLogin, input[name='btnLogin'], #txtPassword, #captchaCode",
    ),
  );
}

function shouldRunLoginAutomation() {
  return hasLoginControls();
}

function enlargeCaptcha(captchaImage) {
  if (!captchaImage) return;
  const height = captchaImage.naturalHeight || captchaImage.height;
  if (!height) return;
  if (captchaImage.dataset.cuimsClearEnlarged === String(height)) return;
  captchaImage.dataset.cuimsClearEnlarged = String(height);
  captchaImage.style.height = `${Math.round(height * 1.75)}px`;
  captchaImage.style.width = "auto";
  captchaImage.style.imageRendering = "pixelated";
}

function bindCaptchaReload(captchaImage) {
  if (captchaImage.dataset.cuimsClearBound) return;
  captchaImage.dataset.cuimsClearBound = "1";
  captchaImage.addEventListener("load", () => {
    solveGeneration += 1;
    delete captchaImage.dataset.cuimsClearSolved;
    delete captchaImage.dataset.cuimsClearSolving;
    delete captchaImage.dataset.cuimsClearWaiting;
    queueScan();
  });
}

function prepareLogin() {
  if (!shouldRunLoginAutomation()) {
    scanPortalFailureSignals();
    return;
  }

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
  const captchaImage = document.querySelector("#imgCaptcha, img[src*='GenerateCaptcha' i]");

  // UID-only step starts a new login, so the retry budget resets.
  if (uidField && nextButton && !passwordField && !captchaImage) {
    resetFailureState();
    clearLoginStatus();
  }

  scanPortalFailureSignals();

  const gate = canAutoSubmit();
  if (gate.reason === "lockout") {
    showLoginStatus(formatLockoutMessage(gate.state.lockoutUntil), "danger");
  } else if (gate.reason === "budget") {
    showLoginStatus(formatBudgetMessage(gate.state.failures), "warn");
  }

  if (passwordField) {
    passwordField.autocomplete = "current-password";

    if (settings.password && passwordField.value !== settings.password) {
      passwordField.value = settings.password;
      dispatchFieldEvents(passwordField);
    }
  }

  prepareCaptchaStep(passwordField);
}

function scanPortalFailureSignals() {
  const detected = detectPortalFailure();
  if (!detected) return;

  const fingerprint = `${detected.kind}:${detected.haystack.slice(0, 180)}`;
  if (fingerprint === lastErrorFingerprint) return;
  lastErrorFingerprint = fingerprint;

  if (detected.kind === "lockout") {
    const state = recordDetectedFailure({ lockout: true });
    showLoginStatus(formatLockoutMessage(state.lockoutUntil), "danger");
    return;
  }

  const state = recordDetectedFailure({ lockout: false });
  if (state.locked || state.budgetExhausted) {
    showLoginStatus(
      state.locked
        ? formatLockoutMessage(state.lockoutUntil)
        : formatBudgetMessage(state.failures),
      state.locked ? "danger" : "warn",
    );
    return;
  }

  showLoginStatus(
    `Login was rejected (${state.failures}/${MAX_AUTO_SUBMIT_ATTEMPTS} auto-submits used). Check UID, password, and captcha.`,
    "warn",
  );
}

function prepareCaptchaStep(passwordField) {
  const captchaImage = document.querySelector("#imgCaptcha, img[src*='GenerateCaptcha' i]");
  if (!captchaImage) return;

  bindCaptchaReload(captchaImage);

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

  const state = readFailureState();
  if (!settings.autoSolveCaptcha || state.locked) {
    enlargeCaptcha(captchaImage);
    captchaField.focus();
    return;
  }

  // Wait for the captcha image to be fully decoded
  if (!captchaImage.complete || captchaImage.naturalWidth === 0) {
    if (!captchaImage.dataset.cuimsClearWaiting) {
      captchaImage.dataset.cuimsClearWaiting = "1";
      captchaImage.addEventListener(
        "load",
        () => {
          delete captchaImage.dataset.cuimsClearWaiting;
          queueScan();
        },
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

async function solveCaptchaImage(captchaImage, captchaField, passwordField) {
  const generation = ++solveGeneration;
  captchaField.placeholder = "Solving…";

  try {
    const candidates = extractCaptchaVariants(captchaImage);
    if (!candidates || candidates.length === 0) throw new Error("Could not extract image");

    const solution = await chrome.runtime.sendMessage({
      type: "cuims-clear:solve-captcha",
      candidates,
    });

    if (generation !== solveGeneration) return;
    if (captchaField.dataset.cuimsClearUserEdited) return;
    if (solution?.error) throw new Error(solution.error);

    const text = (solution?.text || "").trim();
    if (text.length < MIN_CAPTCHA_FILL_LEN || text.length > MAX_CAPTCHA_FILL_LEN) {
      throw new Error("unconvincing read: " + text);
    }

    captchaField.value = text;
    dispatchFieldEvents(captchaField);
    captchaImage.dataset.cuimsClearSolved = captchaImage.src;
    captchaField.placeholder = CAPTCHA_PLACEHOLDER;

    const pwField =
      passwordField ||
      document.querySelector("input[type='password'], #txtPassword, input[name*='Password' i]");

    const loginButton = document.querySelector(
      "#btnLogin, input[name='btnLogin'], button[type='submit'], input[type='submit'][value*='Login' i]",
    );

    const gate = canAutoSubmit();
    const confident = mayAutoSubmitSolution(solution);

    if (!gate.ok) {
      enlargeCaptcha(captchaImage);
      if (gate.reason === "lockout") {
        showLoginStatus(formatLockoutMessage(gate.state.lockoutUntil), "danger");
      } else if (gate.reason === "budget") {
        showLoginStatus(formatBudgetMessage(gate.state.failures), "warn");
      }
      captchaField.focus();
      return;
    }

    if (!confident) {
      enlargeCaptcha(captchaImage);
      showLoginStatus(
        "CAPTCHA read is uncertain — filled for you, but Login was not pressed. Check the code, then submit.",
        "warn",
      );
      captchaField.focus();
      return;
    }

    if (loginButton && pwField?.value && !captchaField.dataset.cuimsClearUserEdited) {
      await delay(250 + Math.random() * 150);
      if (
        captchaField.value === text &&
        pwField?.value &&
        !captchaField.dataset.cuimsClearUserEdited &&
        canAutoSubmit().ok
      ) {
        // Count before the click so a fast portal reject cannot race past the budget.
        const after = recordAutoSubmit();
        loginButton.click();
        if (after.budgetExhausted || after.locked) {
          showLoginStatus(
            after.locked
              ? formatLockoutMessage(after.lockoutUntil)
              : formatBudgetMessage(after.failures),
            after.locked ? "danger" : "warn",
          );
        }
      }
    }
  } catch (err) {
    if (generation !== solveGeneration) return;
    console.warn("[CUIMS Clear] CAPTCHA solve error:", err);
    captchaField.placeholder = CAPTCHA_PLACEHOLDER;
    delete captchaImage.dataset.cuimsClearSolving;
    enlargeCaptcha(captchaImage);
    captchaField.focus();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyModal(element) {
  // Chrome innerText is layout-aware and can miss closed/clipped nodes.
  const text = (element.textContent || element.innerText || "").toLowerCase();
  const isEvent = EVENT_WORDS.some((word) => text.includes(word));
  const isFeedback = FEEDBACK_WORDS.some((word) => text.includes(word));

  if (settings.blockEvents && isEvent) return "event";
  if (settings.blockFeedback && isFeedback) return "feedback";
  return null;
}

const UNIQUE_FEEDBACK_PROMPTS = [
  "filling out the feedback related to the teaching",
  "will take not more than 2 minutes",
  "click here to fill now",
];

const DASHBOARD_LANDMARKS = [
  "my course",
  "announcements",
  "student facilitation",
  "mentor details",
];

function hasDashboardLandmarks(element) {
  const text = (element.textContent || "").toLowerCase();
  return DASHBOARD_LANDMARKS.filter((landmark) => text.includes(landmark)).length >= 2;
}

function promptRoot(start) {
  let current = start;
  let best = start;

  while (current && current !== document.body && current.tagName !== "FORM") {
    if (hasDashboardLandmarks(current)) break;
    best = current;
    current = current.parentElement;
  }

  if (best === document.body || best === document.documentElement) return null;
  return best;
}

function hideHostIframe() {
  if (window === window.top) return;
  try {
    const frames = window.top.document.querySelectorAll("iframe, frame");
    for (const frame of frames) {
      if (frame.contentWindow !== window) continue;
      frame.style.setProperty("display", "none", "important");
      frame.dataset.cuimsClearSuppressed = "feedback";
      const parent = frame.parentElement;
      if (!parent) continue;
      for (const sibling of parent.children) {
        if (sibling === frame || hasDashboardLandmarks(sibling)) continue;
        if (isCoveringLayer(sibling)) {
          sibling.style.setProperty("display", "none", "important");
        }
      }
    }
  } catch {}
}

function isCoveringLayer(element) {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.position !== "fixed" && style.position !== "absolute") return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= window.innerWidth * 0.8 &&
    rect.height >= window.innerHeight * 0.55 &&
    rect.top <= 80
  );
}

function hideOrphanWashes() {
  if (!document.body) return;
  for (const element of document.body.querySelectorAll("div, section")) {
    if (element.dataset.cuimsClearSuppressed || hasDashboardLandmarks(element)) continue;
    if (!isCoveringLayer(element)) continue;
    const text = (element.textContent || "").replace(/\s+/g, "");
    const dim = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0/.test(
      getComputedStyle(element).backgroundColor || "",
    );
    if (text.length < 80 && dim) suppress(element, "backdrop");
  }
}

function scanUniqueFeedbackPrompt() {
  if (!settings.blockFeedback || !document.body) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let found = false;

  while (walker.nextNode()) {
    const value = (walker.currentNode.nodeValue || "").toLowerCase().replace(/\s+/g, " ");
    if (!UNIQUE_FEEDBACK_PROMPTS.some((prompt) => value.includes(prompt))) continue;

    const host = walker.currentNode.parentElement;
    if (!host) continue;
    const root = promptRoot(host);
    if (root) suppress(root, "feedback");
    found = true;
  }

  if (found) hideHostIframe();
  hideOrphanWashes();
}

function suppress(element, category) {
  if (!element) return;
  if (element === document.body || element === document.documentElement) return;
  if (element.tagName === "FORM") return;

  if (!suppressedElements.has(element)) {
    suppressedElements.set(element, {
      display: element.style.getPropertyValue("display"),
      priority: element.style.getPropertyPriority("display"),
    });
  }

  element.dataset.cuimsClearSuppressed = category;
  // CUIMS can reopen a modal after we hide it. Only write when needed so
  // our style observer does not continuously trigger itself.
  if (
    element.style.getPropertyValue("display") !== "none" ||
    element.style.getPropertyPriority("display") !== "important"
  ) {
    element.style.setProperty("display", "none", "important");
  }
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

function clearStaleSuppress() {
  document.getElementById("cuims-clear-blocker-style")?.remove();
  document.querySelectorAll("[data-cuims-clear-suppressed]").forEach((element) => {
    element.style.removeProperty("display");
    element.removeAttribute("data-cuims-clear-suppressed");
  });
  suppressedElements.clear();
}

function scanPage() {
  scanQueued = false;

  // Successful landing clears the login circuit so the next session starts fresh.
  if (/studenthome\.aspx$/i.test(location.pathname)) {
    resetFailureState();
    clearLoginStatus();
  }

  prepareLogin();

  for (const selector of MODAL_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => {
      const category = classifyModal(element);
      if (category) suppress(element, category);
    });
  }

  scanUniqueFeedbackPrompt();
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
    settings = { ...DEFAULT_SETTINGS, ...storedSettings };
    markUserEdits();
    clearStaleSuppress();
    scanPage();

    new MutationObserver(queueScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "open", "hidden"],
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
