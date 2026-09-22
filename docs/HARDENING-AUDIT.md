# CUIMS Clear hardening audit

Date: 2026-09-22  
Branch: `cursor/hardening-lockout-ocr-06ce`  
Trees reviewed: `outputs/cuims-clear-chrome` (was 0.6.3 → **0.6.4**), `outputs/cuims-clear-firefox` (was 0.6.1 → **0.6.2**)

Source inventory: `uploads/HARDENING-PROBLEM-LIST.md` (starting audit). This document verifies each item against the tree, records evidence, and marks **fixed** / **deferred**.

## Product promise

**Blazing-fast, super-accurate login with no catch on the happy path.**

| Path | Behavior |
|---|---|
| Happy path (OCR looks valid) | Auto-fill **and** auto-submit immediately — no confidence lectures, no artificial delay, no cool-down banners |
| Quiet safety (only when failing) | Circuit breaker stops auto-submit after a few real failures; portal lockout/hard errors pause automation with calm, minimal copy |

## Owner constraints (non-negotiable)

| Constraint | Status |
|---|---|
| UX first: fast, smooth; zero catch when OCR works | **Rebalanced** — length/charset gate only; multi-pass raises accuracy |
| Local UID/password storage intentional — harden, don’t remove | Kept |
| CAPTCHA fully on-device (bundled Tesseract/WASM/eng); no cloud OCR | Kept |
| Do **not** bypass/spoof CUIMS lockout; prevent reaching it | **Fixed** via quiet circuit breaker |
| Feature branch + one open PR; do not merge to main/prod | This PR only |

---

## P0 — lockout / trust

### 1. Retry budget 99 + auto-submit — **FIXED** (quiet)

**Evidence (before):**  
`MAX_CAPTCHA_ATTEMPTS = 99` + `autoSubmitLogin: true` could click Login on bad OCR until CUIMS’s ~5-fail / ~20-min lock.

**Fix:**

- `MAX_AUTO_SUBMIT_ATTEMPTS = 3` (stop well before ~5)
- Budget in **`localStorage`** (shared across same-origin frames)
- Count **auto-submit clicks**, not bare OCR fills
- Soft cool-down `LOCKOUT_COOLDOWN_MS = 20 * 60 * 1000` when budget opens
- Reset on UID-only step and on `StudentHome.aspx`
- **No proactive banners** while the circuit is merely open — status appears only after a portal reject/lockout or when a submit is actually blocked

**Paths:** `outputs/cuims-clear-firefox/content.js` (source of truth), synced to Chrome via `scripts/sync-chrome-build.sh`.

### 2. No lockout / server-error detection — **FIXED** (heuristic, calm UI)

**Fix:** Pattern match on `#lblMessage`, `#lblError`, validation summaries, and body text. Messaging is short (`Auto-login paused…` / `Login rejected…`) — no lockout lectures on success.

**Fixtures:** `tests/fixtures/login/{lockout,invalid-captcha,invalid-password}.html`  
**Tests:** `tests/login-fixtures.test.mjs`, `tests/login-safety.test.mjs`

### 3. Attempt counter ignored portal rejects — **FIXED**

- Auto-submit click consumes one budget slot
- Portal error after a **recent** auto-submit does **not** double-count
- Manual Login rejects still consume budget when error UI is seen
- Lockout UI forces cool-down immediately

---

## P1 — security / privacy (keep local creds)

### 4. UID + password in `chrome.storage.local` unencrypted — **ACCEPTED / HARDENED**

Solver message path rejects non-CUIMS / non-extension senders. No credential logging.

### 5. Password written into live DOM — **ACCEPTED**

Required for CUIMS submit; unchanged.

### 6. `web_accessible_resources` exposes Tesseract — **HARDENED**

Message allowlisting on solver entry points; WAR still contains no secrets.

### 7. `content_scripts` `all_frames: true` — **HARDENED**

Login automation only when login controls exist; shared `localStorage` budget.

---

## P1 — captcha accuracy / speed (local only)

### 8. Aim 90–95% + auto-submit gate — **REBALANCED (UX-first)**

**Earlier (too harsh):** `MIN_AUTO_SUBMIT_CONFIDENCE = 65` + score ≥ 90 blocked real samples (~67 confidence) and felt “managed.”

**Now:** `mayAutoSubmitSolution()` auto-submits when the read is **4–6 alphanumeric chars**. Confidence/score are for **multi-pass ranking and early-exit**, not for withholding Login.

- Fill gate remains 3–7 (show something even on weak reads)
- Auto-submit: valid charset + length 4–6 → submit immediately
- Artificial pre-Login delay removed on the happy path

**Deferred:** Larger labeled captcha corpus; 90–95% remains a target, not a CI-proven metric.

### 9. Cold-start OCR latency — **KEPT**

Prewarm via `cuims-clear:prewarm`; fast-path skips later passes when first read is strong (`FAST_PATH_CONFIDENCE = 80`); agreement early-exit unchanged.

### 10. Confusable glyphs / length gate — **KEPT**

Glyph fusion repairs unchanged (`vv→w`, `rn→m`, `cl→d`).

---

## P2 — reliability

### 11. Chrome 0.6.3 vs Firefox 0.6.1 drift — **FIXED**

Shared solver files synced Firefox → Chrome. Versions: Chrome **0.6.4**, Firefox **0.6.2**.

### 12–15. Overlay / MV3 / LMS / stale PR #1 — **unchanged from prior audit**

See earlier notes; lockout-safety scope unchanged.

---

## P2 — tests

### 16. Circuit breaker / lockout fixtures — **FIXED**

- `tests/login-safety.mjs` + `tests/login-safety.test.mjs` (happy-path accepts ~67 confidence)
- `tests/fixtures/login/*.html` + `tests/login-fixtures.test.mjs`
- `tests/dom-lifecycle.test.mjs` off the old `MAX=99` contract

### 17–18. OCR corpus / dual-browser CI — **DEFERRED** (manual checklist)

---

## Manual smoke (no live credentials in CI)

1. Load unpacked Chrome `outputs/cuims-clear-chrome` and Firefox `outputs/cuims-clear-firefox`.
2. Save a **test** UID/password you control.
3. On CUIMS login (password+captcha): when OCR returns a normal 4–6 char code, captcha fills **and Login clicks immediately** — no banner, no pause lecture.
4. Force junk OCR length: field may fill; Login is not pressed; **no** confidence warning banner.
5. Trigger 3 failed auto-submits: further auto-submit stops; calm pause copy only when needed; manual Login still works.
6. Portal lockout copy: auto-submit stays off with minimal UI.
7. Successful login: StudentHome clears the circuit for the next session.
8. Confirm feedback/event overlays still suppress; Open LMS still works.
9. Confirm no network calls to OCR APIs (DevTools); only CUIMS/LMS hosts.

---

## Explicit non-goals (unchanged)

- Do not bypass, spoof, or circumvent CUIMS account lockouts.
- Do not move OCR to cloud.
- Do not remove optional local credential save.
- Do not merge to main/prod without human approval.
