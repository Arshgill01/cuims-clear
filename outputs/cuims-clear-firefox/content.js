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

// Whole words only: "rating" inside "generating" or "event" inside "prevent"
// would hide CUIMS's own progress and error dialogs. Fest names are one word
// ("Techfest", "Cultfest"), so -fest endings count, except "manifest".
const EVENT_WORDS = /\b(events?|workshops?|seminars?|competitions?|register now|\w*(?<!mani)fest(?:s|ivals?)?)\b/i;
const FEEDBACK_WORDS = /\b(feedback|surveys?|rate your|ratings?|share your experience)\b/i;

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
// Every CUIMS captcha is exactly four letters and digits.
const CAPTCHA_RE = /^[A-Za-z0-9]{4}$/;

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

// When the captcha on screen was issued: the image's own request time when
// the browser reports it (a background touch before that request cannot have
// replaced this captcha), else the page's start. A reload stamps its own
// time. Earlier is the safe side of the comparison.
function captchaIssuedAt(captchaImage) {
  const stamped = Number(captchaImage?.dataset?.cuimsClearIssuedAt || 0);
  if (stamped) return stamped;
  try {
    const entries = captchaImage?.src ? performance.getEntriesByName(captchaImage.src) : [];
    const entry = entries[entries.length - 1];
    if (entry?.fetchStart > 0) return Math.floor(performance.timeOrigin + entry.fetchStart);
    return Math.floor(performance.timeOrigin) || 0;
  } catch {
    return 0;
  }
}

// A login page restored from history shows a captcha CUIMS has already
// replaced: its HTML and image come from the browser's cache.
function captchaFromHistory() {
  try {
    return performance.getEntriesByType("navigation")[0]?.type === "back_forward";
  } catch {
    return false;
  }
}

function isLoginPath() {
  return /^\/(login\.aspx)?$/i.test(location.pathname);
}

// This tab is about to draw a captcha, which replaces the one a background
// sign-in may be holding. Said as early as possible, so the background can
// see it before it submits.
function stampTabLogin() {
  if (!isTopFrame() || !isLoginPath()) return;
  shareLocalStorageWrite({ tabLoginTouchAt: Date.now() });
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
  // The tab's three tries are its own: the background stands down after a
  // single refusal (attendance-daemon.js), so it can never use them up.
  if (state.budgetExhausted) return { ok: false, reason: "budget", state };
  return { ok: true, reason: "ok", state };
}

// One Enter: every four-character read is submitted, sure or not. The three
// tries are the safety net, not the solver's confidence. Anything that is not
// four characters is not a CUIMS captcha and would only be refused.
function mayAutoSubmitSolution(solution) {
  if (!solution || solution.error) return false;
  return CAPTCHA_RE.test(String(solution.text || ""));
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
    const src = captchaImage.src;
    // Chrome can report the first image complete before its load event
    // fires. That late event is not a new captcha: solving it again clicked
    // Login a second time while the page was already leaving, and the lost
    // click still used up one of the three tries.
    if (captchaImage.dataset.cuimsClearSolved === src || captchaImage.dataset.cuimsClearSolving === src) return;
    const seen = captchaImage.dataset.cuimsClearSeen;
    if (seen && seen !== src) captchaImage.dataset.cuimsClearIssuedAt = String(Date.now() - 5_000);
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
  captchaImage.dataset.cuimsClearSeen = captchaImage.src;

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

  if (captchaFromHistory() && restartLogin()) return;

  captchaImage.dataset.cuimsClearSolving = captchaImage.src;
  solveCaptchaImage(captchaImage, captchaField, passwordField);
}

function solveCaptchaImage(captchaImage, captchaField, passwordField) {
  try {
    // The read runs here, on the image this page shows: no message to the
    // background, no shared queue, nothing another tab can swap underneath.
    const solution = globalThis.CuimsCaptcha.readImage(captchaImage);
    const text = solution.text;
    if (!CAPTCHA_RE.test(text)) throw new Error(`unreadable captcha (${solution.reason || "no text"})`);
    if (captchaField.dataset.cuimsClearUserEdited) return;

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
      // Not sure of the read: fill it, enlarge the image, let the student check.
      enlargeCaptcha(captchaImage);
      captchaField.focus();
      return;
    }

    if (loginButton && pwField?.value && captchaField.value === text && !captchaField.dataset.cuimsClearUserEdited) {
      clearLoginStatus();
      // Count before the click so a fast portal reject cannot race past the budget.
      recordAutoSubmit();
      try {
        sessionStorage.setItem(SUBMIT_CAPTCHA_AT_KEY, String(captchaIssuedAt(captchaImage)));
      } catch {}
      loginButton.click();
    }
  } catch (err) {
    console.warn("[CUIMS Clear] CAPTCHA solve error:", err);
    captchaField.placeholder = CAPTCHA_PLACEHOLDER;
    // Once per image: the next try comes with a new captcha, not with the
    // style change below waking the page observer into a loop.
    captchaImage.dataset.cuimsClearSolved = captchaImage.src;
    enlargeCaptcha(captchaImage);
    captchaField.focus();
  }
}

// What a dialog says, without the CSS and scripts inside it: CUIMS's own
// "My Question Or Queries" modal carries a <style> with "pointer-events".
// (innerText would skip them, but it is layout-aware and misses closed nodes.)
function dialogText(element) {
  let text = element.textContent || element.innerText || "";
  for (const node of element.querySelectorAll?.("style, script, noscript, template") || []) {
    const inner = node.textContent || "";
    if (inner) text = text.replace(inner, " ");
  }
  return text.toLowerCase();
}

function classifyModal(element) {
  const text = dialogText(element);
  const isEvent = EVENT_WORDS.test(text);
  const isFeedback = FEEDBACK_WORDS.test(text);

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

const LOADER_RE = /load(?:er|ing)|spinner|progress|pleasewait/i;
const DIALOG_SELECTOR = MODAL_SELECTORS.join(", ");

// A dim layer around a dialog the page is showing is that dialog's own
// backdrop, not an orphan: SweetAlert2 draws its wash on .swal2-container,
// around short alerts like the mock test's "Are you sure to start test?".
// A dialog we hid, or one inside a hidden parent, has no boxes.
function holdsShownDialog(element) {
  const dialogs = [...(element.querySelectorAll?.(DIALOG_SELECTOR) || [])];
  if (element.matches?.(DIALOG_SELECTOR)) dialogs.push(element);
  return dialogs.some((dialog) => !dialog.dataset.cuimsClearSuppressed && dialog.getClientRects().length > 0);
}

function hideOrphanWashes() {
  if (!document.body) return;
  for (const element of document.body.querySelectorAll("div, section")) {
    if (element.dataset.cuimsClearSuppressed || hasDashboardLandmarks(element)) continue;
    if (!isCoveringLayer(element) || holdsShownDialog(element)) continue;
    const text = (element.textContent || "").replace(/\s+/g, "");
    // CUIMS's own page loader (#loader-wrapper, "Loading...") is not a wash:
    // hiding it removes the only sign that a postback is running.
    if (LOADER_RE.test(`${element.id} ${element.className} ${text}`)) continue;
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

// A dialog the student opened is never hidden: CUIMS's own queries dialog
// lists a "Give Rating" button per ticket, and keywords alone cannot tell it
// from a survey. A trusted click or key press shortly before a dialog shows
// means the student asked for it; the time survives a postback of the same
// page. A click after a dialog was already up (and hidden) asked for nothing,
// nor does one on the login page for the dashboard it leads to. CUIMS's
// class-feedback panel opens by itself and stays hidden regardless.
const KNOWN_INTERRUPTIONS = new Set(["divSubjectFeedback"]);
// CUIMS's online tests (Evening CUCAT mock tests, Online Test): every alert
// there belongs to the test, from the start confirmation to the anti-cheat
// "Strict Warning!", so quiet mode hides nothing on these pages.
const TEST_PAGE_RE = /\/(frmMockTestNew|frmTakeTest)\.aspx$/i;
const STUDENT_OPENED_MS = 15_000;
const GESTURE_KEY = "cuimsClear.gesture";
let gestureAt = 0;
// When each dialog was first seen open; forgotten once the page closes it.
const shownSince = new WeakMap();

function noteGesture(event) {
  if (!event?.isTrusted) return;
  gestureAt = Date.now();
  try {
    sessionStorage.setItem(GESTURE_KEY, JSON.stringify({ at: gestureAt, path: location.pathname }));
  } catch {}
}

// The latest click or key press; one from before a reload counts only when
// the reload was this same page (a postback).
function lastGesture() {
  let at = gestureAt;
  try {
    const saved = JSON.parse(sessionStorage.getItem(GESTURE_KEY) || "null");
    if (saved?.path === location.pathname) at = Math.max(at, Number(saved.at) || 0);
  } catch {}
  return at;
}

function studentOpened(element) {
  const at = lastGesture();
  const shown = shownSince.get(element);
  return at > 0 && shown >= at && shown - at < STUDENT_OPENED_MS;
}

// The page is showing it, or trying to (its own display write replaced ours).
function shownByPage(element) {
  if (element.classList?.contains("in") || element.classList?.contains("show")) return true;
  const inline = element.style?.getPropertyValue("display");
  if (inline && inline !== "none") return true;
  return !suppressedElements.has(element) && getComputedStyle(element).display !== "none";
}

function allow(element) {
  element.dataset.cuimsClearAllowed = "1";
  const original = suppressedElements.get(element);
  if (!original) return;
  suppressedElements.delete(element);
  element.removeAttribute("data-cuims-clear-suppressed");
  if (element.style.getPropertyValue("display") === "none" && element.style.getPropertyPriority("display") === "important") {
    if (original.display) element.style.setProperty("display", original.display, original.priority);
    else element.style.removeProperty("display");
  }
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

  // classList.remove rewrites the attribute even when the class is absent,
  // which every class observer on the page (the theme's included) sees.
  if (document.body?.classList.contains("modal-open")) document.body.classList.remove("modal-open");
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

  if (TEST_PAGE_RE.test(location.pathname)) return;

  for (const selector of MODAL_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => {
      const shown = shownByPage(element);
      if (!shown) shownSince.delete(element);
      else if (!shownSince.has(element)) shownSince.set(element, Date.now());
      // Open since the student asked for it: leave it until the page closes it.
      if (element.dataset.cuimsClearAllowed) {
        if (shown) return;
        delete element.dataset.cuimsClearAllowed;
      }
      const category = classifyModal(element);
      if (!category) return;
      if (!KNOWN_INTERRUPTIONS.has(element.id) && shown && studentOpened(element)) {
        allow(element);
        return;
      }
      suppress(element, category);
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
  document.addEventListener("pointerdown", noteGesture, true);
  document.addEventListener("keydown", noteGesture, true);
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
      settings[key] = changes[key].newValue ?? DEFAULT_SETTINGS[key];
      settingsChanged = true;
    }
  }

  if (!settingsChanged) return;
  restoreSuppressed();
  queueScan();
});

// Back/forward cache: the page comes back as it was, captcha and all.
if (typeof addEventListener === "function") {
  addEventListener("pageshow", (event) => {
    if (event.persisted && hasLoginControls()) restartLogin();
  });
}

if (location.pathname.toLowerCase().endsWith("/landingpage.aspx")) {
  location.replace(HOME_URL);
} else if (document.documentElement) {
  stampTabLogin();
  startExtension();
} else {
  document.addEventListener("DOMContentLoaded", () => {
    stampTabLogin();
    startExtension();
  }, { once: true });
}
