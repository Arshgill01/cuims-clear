// Lockout-safe login automation helpers.
// Mirrored in outputs/*/content.js — keep behavior in sync with tests.

export const MAX_AUTO_SUBMIT_ATTEMPTS = 3;
export const LOCKOUT_COOLDOWN_MS = 20 * 60 * 1000;
export const MIN_CAPTCHA_FILL_LEN = 3;
export const MAX_CAPTCHA_FILL_LEN = 7;
export const MIN_AUTO_SUBMIT_LEN = 4;
export const MAX_AUTO_SUBMIT_LEN = 6;
export const MIN_AUTO_SUBMIT_CONFIDENCE = 65;
export const MIN_CONSENSUS_CONFIDENCE = 55;
export const MIN_AUTO_SUBMIT_SCORE = 90;

export const LOGIN_FAILURE_KEY = "cuimsClear.loginFailures";
export const LOCKOUT_UNTIL_KEY = "cuimsClear.lockoutUntil";
export const LAST_SUBMIT_AT_KEY = "cuimsClear.lastAutoSubmitAt";

export const LOCKOUT_PATTERNS = [
  /try\s+after\s+\d+\s*min/i,
  /try\s+again\s+after\s+\d+/i,
  /account\s+(has\s+been\s+)?lock/i,
  /locked\s+(out|for\s+\d+)/i,
  /too\s+many\s+(failed\s+)?(login|attempt)/i,
  /temporarily\s+(disabled|locked|blocked)/i,
  /login\s+disabled\s+for/i,
];

export const LOGIN_ERROR_PATTERNS = [
  /invalid\s+(user(\s*id)?|uid|password|captcha|login|credentials)/i,
  /incorrect\s+(user(\s*id)?|uid|password|captcha|credentials)/i,
  /wrong\s+(password|captcha|uid|user)/i,
  /login\s+failed/i,
  /authentication\s+failed/i,
  /captcha\s+(code\s+)?(is\s+)?(invalid|incorrect|wrong|mismatch)/i,
  /user\s*id\s+or\s+password/i,
];

export function pageTextIndicatesLockout(text) {
  const haystack = String(text || "");
  return LOCKOUT_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function pageTextIndicatesLoginError(text) {
  const haystack = String(text || "");
  return LOGIN_ERROR_PATTERNS.some((pattern) => pattern.test(haystack));
}

export function captchaLengthAcceptable(text) {
  const len = String(text || "").trim().length;
  return len >= MIN_CAPTCHA_FILL_LEN && len <= MAX_CAPTCHA_FILL_LEN;
}

export function mayAutoSubmitSolution(solution) {
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

export function readFailureState(store, now = Date.now()) {
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

export function recordAutoSubmit(store, now = Date.now()) {
  const state = readFailureState(store, now);
  const failures = state.failures + 1;
  store.setItem(LOGIN_FAILURE_KEY, String(failures));
  store.setItem(LAST_SUBMIT_AT_KEY, String(now));
  if (failures >= MAX_AUTO_SUBMIT_ATTEMPTS) {
    const until = Math.max(state.lockoutUntil, now + LOCKOUT_COOLDOWN_MS);
    store.setItem(LOCKOUT_UNTIL_KEY, String(until));
    return { failures, lockoutUntil: until, locked: true, budgetExhausted: true };
  }
  return {
    failures,
    lockoutUntil: state.lockoutUntil,
    locked: state.locked,
    budgetExhausted: failures >= MAX_AUTO_SUBMIT_ATTEMPTS,
  };
}

export function recordDetectedFailure(store, { lockout = false } = {}, now = Date.now()) {
  const state = readFailureState(store, now);
  const lastSubmit = Number(store.getItem(LAST_SUBMIT_AT_KEY) || 0);
  const recentSubmit = lastSubmit > 0 && now - lastSubmit < 20_000;

  if (lockout) {
    const until = Math.max(state.lockoutUntil, now + LOCKOUT_COOLDOWN_MS);
    store.setItem(LOCKOUT_UNTIL_KEY, String(until));
    const failures = Math.max(state.failures, MAX_AUTO_SUBMIT_ATTEMPTS);
    store.setItem(LOGIN_FAILURE_KEY, String(failures));
    return { failures, lockoutUntil: until, locked: true, budgetExhausted: true, counted: true };
  }

  if (recentSubmit) {
    return { ...state, counted: false };
  }

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

export function resetFailureState(store) {
  store.removeItem(LOGIN_FAILURE_KEY);
  store.removeItem(LOCKOUT_UNTIL_KEY);
  store.removeItem(LAST_SUBMIT_AT_KEY);
}

export function canAutoSubmit(store, settings, now = Date.now()) {
  if (!settings?.autoSubmitLogin) return { ok: false, reason: "disabled" };
  const state = readFailureState(store, now);
  if (state.locked) return { ok: false, reason: "lockout", state };
  if (state.budgetExhausted) return { ok: false, reason: "budget", state };
  return { ok: true, reason: "ok", state };
}

export function formatLockoutMessage(lockoutUntil, now = Date.now()) {
  const ms = Math.max(0, lockoutUntil - now);
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `CUIMS may lock accounts after repeated failed logins. Auto-submit paused for ~${minutes} min. Enter the captcha manually when ready.`;
}

export function formatBudgetMessage(failures) {
  return `Auto-submit stopped after ${failures} attempt${failures === 1 ? "" : "s"} to avoid account lockout. Solve the captcha and click Login yourself.`;
}

export function formatLowConfidenceMessage() {
  return "CAPTCHA read is uncertain — filled for you, but Login was not pressed. Check the code, then submit.";
}

export function isTrustedCuimsSender(sender, extensionId) {
  if (!sender) return false;
  if (sender.id && extensionId && sender.id !== extensionId) return false;
  const url = String(sender.url || "");
  if (url.startsWith(`chrome-extension://${extensionId}`)) return true;
  if (url.startsWith(`moz-extension://${extensionId}`)) return true;
  if (/^https:\/\/students\.cuchd\.in\//i.test(url)) return true;
  // Chrome offscreen / extension pages sometimes omit url but include id.
  if (sender.id === extensionId && !sender.tab) return true;
  return Boolean(sender.tab && /^https:\/\/students\.cuchd\.in\//i.test(url));
}

export function shouldRunLoginAutomationInFrame({
  hasLoginControls,
  isTopFrame,
  frameCountHint = 1,
}) {
  if (!hasLoginControls) return false;
  // Prefer the top frame when it owns the controls; otherwise allow the
  // nested frame that actually hosts the login form.
  if (isTopFrame) return true;
  return frameCountHint >= 1;
}
