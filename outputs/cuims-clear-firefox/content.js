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
// A run of failures that is this old is treated as a new session and cleared, so
// yesterday's misfires never silently disable today's auto-submit. Well under
// CUIMS's own lockout window, which only cares about rapid consecutive failures.
const FAILURE_STALE_MS = 20 * 60 * 1000;
const STATUS_ID = "cuims-clear-login-status";
const MIN_CAPTCHA_FILL_LEN = 3;
const MAX_CAPTCHA_FILL_LEN = 7;
const MIN_AUTO_SUBMIT_LEN = 4;
const MAX_AUTO_SUBMIT_LEN = 6;
// Confidence ranks multi-pass OCR; it must not withhold Login on the happy path.
const CAPTCHA_CHARSET_RE = /^[A-Za-z0-9]+$/;

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

const SERVER_ERROR_PATTERNS = [
  /service\s+(is\s+)?temporarily\s+unavailable/i,
  /internal\s+server\s+error/i,
  /request\s+(has\s+)?timed?\s*out/i,
  /server\s+(is\s+)?(busy|unavailable|not\s+responding)/i,
  /under\s+maintenance/i,
  /please\s+try\s+again\s+later/i,
];

let settings = { ...DEFAULT_SETTINGS };
const suppressedElements = new Map();
let scanQueued = false;
let programmaticEdit = false;
let prewarmed = false;
let solveGeneration = 0;
let lastErrorFingerprint = "";

// Login state shared with the background attendance sign-in, so the tab and
// the background never submit at the same time or ignore each other's failures.
// CUIMS keeps one expected captcha per session, and the background shares this
// tab's session cookie: any background visit to the login flow replaces the
// captcha this tab is showing. bgLoginTouchAt says when that last happened.
const SHARED_LOGIN_DEFAULTS = { bgSignInUntil: 0, bgSignInOkAt: 0, bgLoginTouchAt: 0, loginGuard: null };
let sharedLogin = { ...SHARED_LOGIN_DEFAULTS };
let sessionShared = false;

// While a login form is open, this tab owns the CUIMS session. The heartbeat
// tells the background to keep off the login flow until the tab is done.
const LOGIN_TAB_BEAT_MS = 8_000;
const LOGIN_RESTARTS_KEY = "cuimsClear.loginRestarts";
const SUBMIT_CAPTCHA_AT_KEY = "cuimsClear.submitCaptchaAt";
const LOGIN_START_URL = "https://students.cuchd.in/";
let loginBeatTimer = 0;

function sharedFailures(now = Date.now()) {
  const failures = sharedLogin.loginGuard?.failures;
  return (Array.isArray(failures) ? failures : []).filter((item) => now - Number(item?.at || 0) < FAILURE_STALE_MS);
}

function writeSharedGuard(change) {
  const guard = sharedLogin.loginGuard || {};
  const next = change({
    failures: sharedFailures(),
    lockoutUntil: Number(guard.lockoutUntil || 0),
    rejectedUid: String(guard.rejectedUid || ""),
  });
  sharedLogin.loginGuard = next;
  try {
    chrome.storage.local.set({ loginGuard: next });
  } catch {}
}

function shareLocalStorageWrite(values) {
  try {
    chrome.storage.local.set(values);
  } catch {}
}

function isTopFrame() {
  try {
    return typeof window === "undefined" || window === window.top;
  } catch {
    return false;
  }
}

function announceLoginTab() {
  if (loginBeatTimer || !isTopFrame() || typeof setInterval !== "function") return;
  const beat = () => {
    if (!hasLoginControls()) {
      clearInterval(loginBeatTimer);
      loginBeatTimer = 0;
      return;
    }
    shareLocalStorageWrite({ loginTabAt: Date.now() });
  };
  loginBeatTimer = setInterval(beat, LOGIN_TAB_BEAT_MS);
  beat();
}

// When the captcha on screen was issued. The first image loads with the page;
// a reload stamps its own time. Earlier is the safe side of the comparison.
function captchaIssuedAt(captchaImage) {
  const stamped = Number(captchaImage?.dataset?.cuimsClearIssuedAt || 0);
  if (stamped) return stamped;
  try {
    return Math.floor(performance.timeOrigin) || 0;
  } catch {
    return 0;
  }
}

function backgroundTouchedSince(at) {
  return Number(sharedLogin.bgLoginTouchAt || 0) >= Number(at || 0) && Number(sharedLogin.bgLoginTouchAt || 0) > 0;
}

// Start the login over on a fresh page. Capped so two tabs can never loop.
function restartLogin(now = Date.now()) {
  if (!isTopFrame()) return false;
  let recent = [];
  try {
    recent = JSON.parse(sessionStorage.getItem(LOGIN_RESTARTS_KEY) || "[]").filter((at) => now - at < 120_000);
  } catch {}
  if (recent.length >= 2) return false;
  recent.push(now);
  try {
    sessionStorage.setItem(LOGIN_RESTARTS_KEY, JSON.stringify(recent));
  } catch {}
  location.assign(LOGIN_START_URL);
  return true;
}

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
  let failures = Number(store.getItem(LOGIN_FAILURE_KEY) || 0);
  const locked = lockoutUntil > now;

  // Decay a stale failure run (previous session) once its lockout has elapsed,
  // so a fresh login attempt is not blocked by old misfires.
  if (!locked && failures > 0) {
    const lastSubmit = Number(store.getItem(LAST_SUBMIT_AT_KEY) || 0);
    if (lastSubmit > 0 && now - lastSubmit > FAILURE_STALE_MS) {
      store.removeItem(LOGIN_FAILURE_KEY);
      store.removeItem(LAST_SUBMIT_AT_KEY);
      failures = 0;
    }
  }

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
  shareLocalStorageWrite({ pageLoginAt: now });
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
  return {
    failures,
    lockoutUntil: state.lockoutUntil,
    locked: false,
    budgetExhausted: failures >= MAX_AUTO_SUBMIT_ATTEMPTS,
    counted: true,
  };
}

function releaseRecentAutoSubmit(now = Date.now()) {
  const store = failureStore();
  const state = readFailureState(now);
  const lastSubmit = Number(store.getItem(LAST_SUBMIT_AT_KEY) || 0);
  if (lastSubmit <= 0 || now - lastSubmit >= 20_000 || state.failures <= 0) return state;
  store.setItem(LOGIN_FAILURE_KEY, String(state.failures - 1));
  store.removeItem(LAST_SUBMIT_AT_KEY);
  return readFailureState(now);
}

function resetFailureState() {
  const store = failureStore();
  store.removeItem(LOGIN_FAILURE_KEY);
  store.removeItem(LOCKOUT_UNTIL_KEY);
  store.removeItem(LAST_SUBMIT_AT_KEY);
  lastErrorFingerprint = "";
  const guard = sharedLogin.loginGuard;
  if (guard && (sharedFailures().length || Number(guard.lockoutUntil || 0) > 0)) {
    writeSharedGuard((current) => ({ ...current, failures: [], lockoutUntil: 0 }));
  }
}

function canAutoSubmit(now = Date.now()) {
  if (!settings.autoSubmitLogin) return { ok: false, reason: "disabled" };
  if (Number(sharedLogin.bgSignInUntil || 0) > now) return { ok: false, reason: "background" };
  const state = readFailureState(now);
  const sharedLockout = Number(sharedLogin.loginGuard?.lockoutUntil || 0);
  if (state.locked || sharedLockout > now) {
    return { ok: false, reason: "lockout", state: { ...state, lockoutUntil: Math.max(state.lockoutUntil, sharedLockout) } };
  }
  const backgroundFailures = sharedFailures(now).filter((item) => item.by === "bg").length;
  if (state.budgetExhausted || state.failures + backgroundFailures >= MAX_AUTO_SUBMIT_ATTEMPTS) {
    return { ok: false, reason: "budget", state: { ...state, failures: state.failures + backgroundFailures } };
  }
  return { ok: true, reason: "ok", state };
}

function mayAutoSubmitSolution(solution) {
  if (!solution || solution.error) return false;
  const text = String(solution.text || "").trim();
  const len = text.length;
  // Happy path: valid length + charset → submit. Multi-pass raises accuracy.
  if (len < MIN_AUTO_SUBMIT_LEN || len > MAX_AUTO_SUBMIT_LEN) return false;
  return CAPTCHA_CHARSET_RE.test(text);
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
  if (SERVER_ERROR_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return { kind: "server", haystack };
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
  const themes = typeof globalThis !== "undefined" ? globalThis.CuimsThemes : null;
  const id = themes?.mirrored();
  if (id && id !== themes.DEFAULT) {
    // The chosen theme: its card colours, with the tone as a side stripe.
    const t = themes.tokens(id);
    el.style.background = t.scheme === "dark" ? t.surface : t.ink;
    el.style.color = t.scheme === "dark" ? t.ink : t.canvas;
    el.style.borderLeft = `4px solid ${tone === "danger" ? t.bad : tone === "warn" ? t.warn : t.accent}`;
  } else {
    el.style.background = tone === "danger" ? "#3b1418" : tone === "warn" ? "#3a2a10" : "#142033";
    el.style.color = tone === "danger" ? "#ffd7dc" : tone === "warn" ? "#ffe6b8" : "#d7e7ff";
    el.style.borderLeft = "";
  }
  el.textContent = message;
}

function clearLoginStatus() {
  document.getElementById(STATUS_ID)?.remove();
}

function formatLockoutMessage(_lockoutUntil, _now = Date.now()) {
  return "CUIMS has temporarily locked login. Wait before trying again.";
}

function formatBudgetMessage(failures) {
  const n = Number(failures) || 0;
  return `Auto-login paused after ${n} ${n === 1 ? "try" : "tries"}. Check the captcha, then Login.`;
}

function formatRejectMessage() {
  return "Login rejected. Check UID, password, and captcha.";
}

function hasLoginControls() {
  return Boolean(
    document.querySelector(
      "#txtUserId, input[name='txtUserId'], #btnNext, input[name='btnNext'], #imgCaptcha, img[src*='GenerateCaptcha' i], #btnLogin, input[name='btnLogin'], #txtPassword, #captchaCode",
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
    if (captchaImage.dataset.cuimsClearSeen) captchaImage.dataset.cuimsClearIssuedAt = String(Date.now() - 5_000);
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

  announceLoginTab();

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

  scanPortalFailureSignals();

  // Stay quiet on the happy path — status only appears after real failures
  // (portal reject / lockout) or when a submit is actually blocked.

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
    writeSharedGuard((current) => ({ ...current, lockoutUntil: Math.max(current.lockoutUntil, state.lockoutUntil) }));
    showLoginStatus(formatLockoutMessage(state.lockoutUntil), "warn");
    return;
  }

  if (detected.kind === "server") {
    releaseRecentAutoSubmit();
    showLoginStatus("CUIMS is temporarily unavailable. Try again in a moment.", "warn");
    return;
  }

  // A refusal after the background replaced the captcha says nothing about
  // the read. Give the attempt back and start the login over.
  if (detected.kind === "error" && submittedCaptchaWasReplaced()) {
    releaseRecentAutoSubmit();
    if (restartLogin()) return;
  }

  const state = recordDetectedFailure({ lockout: false });
  if (state.counted !== false) {
    writeSharedGuard((current) => ({ ...current, failures: [...current.failures, { at: Date.now(), by: "page" }] }));
  }
  if (state.locked || state.budgetExhausted) {
    showLoginStatus(
      state.locked
        ? formatLockoutMessage(state.lockoutUntil)
        : formatBudgetMessage(state.failures),
      "warn",
    );
    return;
  }

  showLoginStatus(formatRejectMessage(), "warn");
}

function submittedCaptchaWasReplaced() {
  let at = 0;
  try {
    at = Number(sessionStorage.getItem(SUBMIT_CAPTCHA_AT_KEY) || 0);
  } catch {}
  return at > 0 && backgroundTouchedSince(at);
}

function prepareCaptchaStep(passwordField) {
  const captchaImage = document.querySelector("#imgCaptcha, img[src*='GenerateCaptcha' i]");
  if (!captchaImage) return;

  bindCaptchaReload(captchaImage);
  captchaImage.dataset.cuimsClearSeen = "1";

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

  if (!settings.autoSolveCaptcha) {
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

async function solveCaptchaImage(captchaImage, captchaField, passwordField) {
  const generation = ++solveGeneration;
  captchaField.placeholder = "Solving…";

  try {
    const candidates = extractCaptchaVariants(captchaImage);
    if (!candidates || candidates.length === 0) throw new Error("Could not extract image");

    let solution = await chrome.runtime.sendMessage({
      type: "cuims-clear:solve-captcha",
      candidates,
    });

    if (generation !== solveGeneration) return;
    if (captchaField.dataset.cuimsClearUserEdited) return;
    if (solution?.error) throw new Error(solution.error);

    let text = (solution?.text || "").trim();
    if (text.length < MIN_CAPTCHA_FILL_LEN || text.length > MAX_CAPTCHA_FILL_LEN) {
      throw new Error("unconvincing read: " + text);
    }

    // Fixed-font geometry pass: fix only case (V/v, C/c, ...) and O vs 0.
    text = correctCaptchaCase(text, captchaImage);
    solution = { ...solution, text };

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

    // The background replaced this session's captcha after this one was
    // drawn, so even a perfect read would be refused. Start over instead.
    if (backgroundTouchedSince(captchaIssuedAt(captchaImage)) && restartLogin()) return;

    const gate = canAutoSubmit();
    const canSubmit = mayAutoSubmitSolution(solution);

    if (!gate.ok) {
      enlargeCaptcha(captchaImage);
      // Only surface a status when we would have submitted but the circuit is open.
      if (canSubmit && (gate.reason === "lockout" || gate.reason === "budget")) {
        showLoginStatus(
          gate.reason === "lockout"
            ? formatLockoutMessage(gate.state.lockoutUntil)
            : formatBudgetMessage(gate.state.failures),
          "warn",
        );
      }
      captchaField.focus();
      return;
    }

    if (!canSubmit) {
      // Junk length/charset — fill only, stay quiet (no confidence lectures).
      enlargeCaptcha(captchaImage);
      captchaField.focus();
      return;
    }

    if (loginButton && pwField?.value && !captchaField.dataset.cuimsClearUserEdited) {
      clearLoginStatus();
      // Zero catch on the happy path: submit as soon as the field is filled.
      if (
        captchaField.value === text &&
        pwField?.value &&
        !captchaField.dataset.cuimsClearUserEdited &&
        canAutoSubmit().ok
      ) {
        // Count before the click so a fast portal reject cannot race past the budget.
        recordAutoSubmit();
        try {
          sessionStorage.setItem(SUBMIT_CAPTCHA_AT_KEY, String(captchaIssuedAt(captchaImage)));
        } catch {}
        loginButton.click();
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
    // Tells the background the session is alive, so a refresh that gave way
    // to this tab's login can run now.
    if (!sessionShared && (typeof window === "undefined" || window === window.top)) {
      sessionShared = true;
      shareLocalStorageWrite({ sessionAlive: true, sessionCheckedAt: Date.now(), loginTabAt: 0 });
    }
  }

  prepareLogin();
  shareLeavePage();

  for (const selector of MODAL_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => {
      const category = classifyModal(element);
      if (category) suppress(element, category);
    });
  }

  scanUniqueFeedbackPrompt();
  cleanupBackdrop();
}

// Opening a leave page on CUIMS hands its application list to the
// Attendance tab, so pending leave updates without another request.
let leavePageShared = false;
function shareLeavePage() {
  if (leavePageShared || !isTopFrame()) return;
  const which = /frmStudentApplyDutyLeave\.aspx$/i.test(location.pathname) ? "dl" : /frmStudentMedicalLeaveApply\.aspx$/i.test(location.pathname) ? "ml" : "";
  if (!which || !document.getElementById(which === "dl" ? "gvHistory" : "gvMlHistory")) return;
  leavePageShared = true;
  try {
    chrome.runtime.sendMessage({ type: "cuims-clear:leave-page", which, html: document.getElementById(which === "dl" ? "gvHistory" : "gvMlHistory").outerHTML });
  } catch {}
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
  // Keeps this site's copy of the theme current for the first-frame paints.
  globalThis.CuimsThemes?.load();
  globalThis.CuimsThemes?.onChange(() => {});
  chrome.storage.local.get({ ...DEFAULT_SETTINGS, ...SHARED_LOGIN_DEFAULTS }, (storedSettings) => {
    settings = { ...DEFAULT_SETTINGS, ...storedSettings };
    for (const key of Object.keys(SHARED_LOGIN_DEFAULTS)) sharedLogin[key] = storedSettings[key];
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

// The background just signed this browser in, so a login form still open in
// a tab is stale. Go home instead of submitting a second login.
function followBackgroundSignIn(now = Date.now()) {
  if (window !== window.top || !hasLoginControls()) return;
  if (now - Number(sharedLogin.bgSignInOkAt || 0) > 60_000) {
    resumeAfterBackground();
    return;
  }
  location.assign(HOME_URL);
}

// The background stopped without signing in. If it touched the login flow
// after this tab's captcha was drawn, that captcha is dead: start over.
// Otherwise solve again, since the held read may still be good.
function resumeAfterBackground() {
  const captchaImage = document.querySelector("#imgCaptcha, img[src*='GenerateCaptcha' i]");
  if (!captchaImage) return;
  if (backgroundTouchedSince(captchaIssuedAt(captchaImage)) && restartLogin()) return;
  delete captchaImage.dataset.cuimsClearSolved;
  delete captchaImage.dataset.cuimsClearSolving;
  queueScan();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  for (const key of Object.keys(SHARED_LOGIN_DEFAULTS)) {
    if (changes[key]) sharedLogin[key] = changes[key].newValue;
  }
  if (changes.bgSignInUntil && !changes.bgSignInUntil.newValue) followBackgroundSignIn();

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
