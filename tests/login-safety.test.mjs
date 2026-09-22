import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUTO_SUBMIT_ATTEMPTS,
  LOCKOUT_COOLDOWN_MS,
  LOGIN_FAILURE_KEY,
  LOCKOUT_UNTIL_KEY,
  LAST_SUBMIT_AT_KEY,
  pageTextIndicatesLockout,
  pageTextIndicatesLoginError,
  captchaLengthAcceptable,
  mayAutoSubmitSolution,
  readFailureState,
  recordAutoSubmit,
  recordDetectedFailure,
  resetFailureState,
  canAutoSubmit,
  formatLockoutMessage,
  formatBudgetMessage,
  isTrustedCuimsSender,
  shouldRunLoginAutomationInFrame,
} from "./login-safety.mjs";

function memoryStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    raw: map,
  };
}

test("lockout copy is detected without matching ordinary login errors", () => {
  assert.equal(
    pageTextIndicatesLockout("Your account is locked. Please try after 20 minutes."),
    true,
  );
  assert.equal(pageTextIndicatesLockout("Invalid captcha code"), false);
  assert.equal(pageTextIndicatesLoginError("Invalid User Id or Password"), true);
  assert.equal(pageTextIndicatesLoginError("Welcome to CUIMS"), false);
});

test("captcha length gate accepts fillable tokens and rejects junk", () => {
  assert.equal(captchaLengthAcceptable("ab"), false);
  assert.equal(captchaLengthAcceptable("abc"), true);
  assert.equal(captchaLengthAcceptable("abcdefg"), true);
  assert.equal(captchaLengthAcceptable("abcdefgh"), false);
});

test("mayAutoSubmitSolution accepts valid length/charset without confidence gating", () => {
  // Real CUIMS sample often lands ~67 confidence — must still auto-submit.
  assert.equal(
    mayAutoSubmitSolution({ text: "ofh7", confidence: 67, score: 92, agreement: 1 }),
    true,
  );
  assert.equal(
    mayAutoSubmitSolution({ text: "ofh7", confidence: 40, score: 65, agreement: 1 }),
    true,
  );
  assert.equal(
    mayAutoSubmitSolution({ text: "ofh7", confidence: 10, score: 35, agreement: 1 }),
    true,
  );
  assert.equal(mayAutoSubmitSolution({ text: "ab", confidence: 99, score: 99 }), false);
  assert.equal(mayAutoSubmitSolution({ text: "abcdefg", confidence: 99, score: 99 }), false);
  assert.equal(mayAutoSubmitSolution({ text: "ofh!", confidence: 99, score: 99 }), false);
  assert.equal(mayAutoSubmitSolution({ error: "solver timeout" }), false);
});

test("circuit breaker stops auto-submit at 3 clicks and opens cool-down", () => {
  const store = memoryStore();
  const t0 = 1_000_000;

  assert.equal(canAutoSubmit(store, { autoSubmitLogin: true }, t0).ok, true);

  recordAutoSubmit(store, t0);
  recordAutoSubmit(store, t0 + 1);
  const third = recordAutoSubmit(store, t0 + 2);
  assert.equal(third.failures, MAX_AUTO_SUBMIT_ATTEMPTS);
  assert.equal(third.budgetExhausted, true);
  assert.equal(third.locked, true);
  assert.ok(third.lockoutUntil >= t0 + LOCKOUT_COOLDOWN_MS);

  const blocked = canAutoSubmit(store, { autoSubmitLogin: true }, t0 + 3);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "lockout");
});

test("portal error after recent auto-submit does not double-count", () => {
  const store = memoryStore();
  const t0 = 5_000_000;
  recordAutoSubmit(store, t0);
  assert.equal(readFailureState(store, t0).failures, 1);

  const detected = recordDetectedFailure(store, { lockout: false }, t0 + 500);
  assert.equal(detected.counted, false);
  assert.equal(readFailureState(store, t0 + 500).failures, 1);
});

test("manual reject without recent auto-submit still consumes budget", () => {
  const store = memoryStore();
  const t0 = 8_000_000;
  const first = recordDetectedFailure(store, { lockout: false }, t0);
  assert.equal(first.counted, true);
  assert.equal(first.failures, 1);
});

test("lockout banner forces cool-down even on first sighting", () => {
  const store = memoryStore();
  const t0 = 9_000_000;
  const state = recordDetectedFailure(store, { lockout: true }, t0);
  assert.equal(state.locked, true);
  assert.equal(state.failures, MAX_AUTO_SUBMIT_ATTEMPTS);
  assert.match(formatLockoutMessage(state.lockoutUntil, t0), /Auto-login paused/);
});

test("UID-style reset clears failure keys", () => {
  const store = memoryStore({
    [LOGIN_FAILURE_KEY]: "3",
    [LOCKOUT_UNTIL_KEY]: "999",
    [LAST_SUBMIT_AT_KEY]: "1",
  });
  resetFailureState(store);
  assert.equal(store.getItem(LOGIN_FAILURE_KEY), null);
  assert.equal(store.getItem(LOCKOUT_UNTIL_KEY), null);
});

test("budget messaging stays calm and mentions try count", () => {
  assert.match(formatBudgetMessage(3), /3 tries/);
  assert.match(formatBudgetMessage(1), /1 try/);
});

test("solver message sender allowlist rejects foreign pages", () => {
  const id = "ext-id";
  assert.equal(
    isTrustedCuimsSender({ id, url: "https://students.cuchd.in/Login.aspx", tab: { id: 1 } }, id),
    true,
  );
  assert.equal(
    isTrustedCuimsSender({ id, url: "https://evil.example/Login.aspx", tab: { id: 1 } }, id),
    false,
  );
  assert.equal(isTrustedCuimsSender({ id, tab: null }, id), true);
});

test("login automation only runs in frames that own login controls", () => {
  assert.equal(
    shouldRunLoginAutomationInFrame({ hasLoginControls: false, isTopFrame: true }),
    false,
  );
  assert.equal(
    shouldRunLoginAutomationInFrame({ hasLoginControls: true, isTopFrame: true }),
    true,
  );
  assert.equal(
    shouldRunLoginAutomationInFrame({ hasLoginControls: true, isTopFrame: false }),
    true,
  );
});

test("disabled auto-submit setting always blocks clicks", () => {
  const store = memoryStore();
  assert.deepEqual(canAutoSubmit(store, { autoSubmitLogin: false }, 1), {
    ok: false,
    reason: "disabled",
  });
});
