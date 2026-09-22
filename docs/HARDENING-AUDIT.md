# CUIMS Clear hardening audit

Date: 2026-09-22  
Branch: `cursor/hardening-lockout-ocr-06ce`  
Trees reviewed: `outputs/cuims-clear-chrome` (was 0.6.3 → **0.6.4**), `outputs/cuims-clear-firefox` (was 0.6.1 → **0.6.2**)

Source inventory: `uploads/HARDENING-PROBLEM-LIST.md` (starting audit). This document verifies each item against the tree, records evidence, and marks **fixed** / **deferred**.

## Owner constraints (non-negotiable)

| Constraint | Status |
|---|---|
| UX first: fast, smooth, resilient to CUIMS flakiness | Kept: OCR fill still runs; auto-submit is gated |
| Local UID/password storage intentional — harden, don’t remove | Kept |
| CAPTCHA fully on-device (bundled Tesseract/WASM/eng); no cloud OCR | Kept |
| Do **not** bypass/spoof CUIMS lockout; prevent reaching it | **Fixed** via circuit breaker |
| Feature branch + one open PR; do not merge to main/prod | This PR only |

---

## P0 — lockout / trust

### 1. Retry budget 99 + auto-submit — **FIXED**

**Evidence (before):**  
`outputs/cuims-clear-chrome/content.js` and Firefox twin had:

- `MAX_CAPTCHA_ATTEMPTS = 99`
- `autoSubmitLogin: true` default
- `recordCaptchaAttempt()` on every OCR fill, then `loginButton.click()` with no confidence gate

**Repro:** Enable auto-solve + auto-submit, feed wrong OCR repeatedly → up to 99 Login clicks → CUIMS ~5-fail / ~20-min lock.

**Fix:**

- `MAX_AUTO_SUBMIT_ATTEMPTS = 3` (stop well before ~5)
- Budget stored in **`localStorage`** (shared across same-origin frames; `all_frames` cannot amplify)
- Count **auto-submit clicks**, not bare OCR fills
- Soft cool-down `LOCKOUT_COOLDOWN_MS = 20 * 60 * 1000` when budget opens
- Reset on UID-only step and on `StudentHome.aspx`
- Status banner explains pause

**Paths:** `outputs/cuims-clear-firefox/content.js` (source of truth), synced to Chrome via `scripts/sync-chrome-build.sh`.

### 2. No lockout / server-error detection — **FIXED** (heuristic)

**Evidence (before):** No parsing of lockout / invalid-login banners.

**Fix:** Pattern match on `#lblMessage`, `#lblError`, validation summaries, and body text:

- Lockout: “try after N minutes”, “account locked”, “too many … attempts”, …
- Errors: invalid/incorrect UID/password/captcha, login failed, …

**Fixtures:** `tests/fixtures/login/{lockout,invalid-captcha,invalid-password}.html`  
**Tests:** `tests/login-fixtures.test.mjs`, `tests/login-safety.test.mjs`

**Deferred:** Live CUIMS DOM class names may drift; expand fixtures when new banners are captured (no live creds in CI).

### 3. Attempt counter ignored portal rejects — **FIXED**

**Evidence (before):** Counter only tracked OCR solves.

**Fix:**

- Auto-submit click consumes one budget slot
- Portal error after a **recent** auto-submit does **not** double-count
- Manual Login rejects still consume budget when error UI is seen
- Lockout UI forces cool-down immediately

---

## P1 — security / privacy (keep local creds)

### 4. UID + password in `chrome.storage.local` unencrypted — **ACCEPTED / HARDENED**

**Evidence:** `popup.js` + `content.js` read/write `uid` / `password` in `storage.local` by design.

**Mitigations in this PR:**

- No credential logging added (existing code never `console.log`s password/uid values)
- Solver message path rejects non-CUIMS / non-extension senders (Firefox `background.js`; Chrome `service-worker.js` checks tab URL)

**Deferred:** OS keychain / encryption-at-rest (explicit non-goal to remove local save).

### 5. Password written into live DOM — **ACCEPTED**

**Evidence:** `prepareLogin()` sets `#txtPassword` from storage so CUIMS can submit.

**Deferred:** MAIN-world `lms-open-wrap.js` surface reduction (narrower hook) — not required for lockout safety.

### 6. `web_accessible_resources` exposes Tesseract to `students.cuchd.in` — **HARDENED**

**Evidence:** Chrome `manifest.json` WAR for `vendor/tesseract/*` + `vendor/tessdata/*` (needed for workers). Firefox loads solver in background scripts (no WAR).

**Fix:** Message allowlisting on solver entry points; WAR still contains no secrets.

### 7. `content_scripts` `all_frames: true` — **HARDENED**

**Evidence:** Both manifests set `all_frames: true` on CUIMS `content.js`.

**Fix:**

- Login automation runs only when login controls exist in the frame
- Failure budget uses `localStorage` so nested frames share one counter

---

## P1 — captcha accuracy / speed (local only)

### 8. Aim 90–95% + confidence gating — **PARTIALLY FIXED**

**Evidence (before):** Any 3–7 char OCR result could auto-click Login.

**Fix:** `mayAutoSubmitSolution()` — auto-submit only for 4–6 chars with:

- consensus (`agreement >= 2` and confidence ≥ 55), or
- confidence ≥ 65 and score ≥ 90

Calibrated against `work/real-cuims-captcha.png` (~67 confidence / length-bonus score).

**Deferred:** Larger labeled captcha corpus beyond `work/real-cuims-captcha.png` / synthetic tests. Claim of 90–95% remains a target, not a CI-proven metric.

### 9. Cold-start OCR latency — **KEPT / SLIGHTLY IMPROVED**

**Evidence:** Prewarm via `cuims-clear:prewarm`; fast-path skips later passes when first read is strong (`FAST_PATH_CONFIDENCE = 80`); agreement early-exit unchanged.

**Deferred:** Cold vs warm timing dashboard in CI.

### 10. Confusable glyphs / length gate — **CALIBRATED**

Fill gate remains 3–7; **auto-submit** tightened to 4–6. Glyph fusion repairs unchanged (`vv→w`, `rn→m`, `cl→d`).

---

## P2 — reliability

### 11. Chrome 0.6.3 vs Firefox 0.6.1 drift — **FIXED** (this release)

Shared solver files synced Firefox → Chrome. Versions bumped together conceptually: Chrome **0.6.4**, Firefox **0.6.2**. Re-run `scripts/sync-chrome-build.sh` after shared edits.

### 12. Overlay quiet-mode races — **ALREADY ON MAIN / DEFERRED further**

Main already includes TLP / style-observer hardening (`43330ba`, `f6f5833`). Stale PR #1 superseded — close in favor of this PR.

### 13. MV3 service worker / offscreen teardown — **DEFERRED**

Chrome still uses offscreen + queue recovery. No new teardown race fix in this PR beyond existing `solveQueue` recovery.

### 14. LMS pairing / partial directory HTML — **DEFERRED**

Out of lockout scope; existing LMS retry UI unchanged.

### 15. Stale open PR #1 (TLP overlay) — **RECONCILED**

PR #1 (`cursor/hide-tlp-feedback-overlay-8800`) targets 0.5.1-era overlay work already absorbed/superseded on main 0.6.x. Close #1; keep **this** hardening PR as the single open PR.

---

## P2 — tests

### 16. Circuit breaker / lockout fixtures — **FIXED**

- `tests/login-safety.mjs` + `tests/login-safety.test.mjs`
- `tests/fixtures/login/*.html` + `tests/login-fixtures.test.mjs`
- `tests/dom-lifecycle.test.mjs` updated off the old `MAX=99` contract

### 17. OCR regression set thin — **DEFERRED**

Existing preprocessing / post-processing / real-captcha tests remain; corpus expansion still needed for a 90–95% claim.

### 18. Dual-browser smoke in CI — **DEFERRED** (manual checklist below)

---

## Manual smoke (no live credentials in CI)

1. Load unpacked Chrome `outputs/cuims-clear-chrome` and Firefox `outputs/cuims-clear-firefox`.
2. Save a **test** UID/password you control; confirm popup “stops after 3 tries” copy.
3. On CUIMS login (password+captcha step): confirm captcha fills; confident reads may auto-submit.
4. Force low-confidence / wrong captcha: confirm field fills, banner warns, Login **not** pressed when uncertain.
5. Trigger 3 auto-submits: confirm auto-submit stops and cool-down banner appears; manual Login still possible.
6. If portal shows lockout copy (or use fixture mentally): auto-submit must stay off.
7. Complete a successful login: confirm StudentHome clears the circuit for the next session.
8. Confirm feedback/event overlays still suppress; Open LMS still works.
9. Confirm no network calls to OCR APIs (DevTools); only CUIMS/LMS hosts.

---

## Explicit non-goals (unchanged)

- Do not bypass, spoof, or circumvent CUIMS account lockouts.
- Do not move OCR to cloud.
- Do not remove optional local credential save.
- Do not merge to main/prod without human approval.
