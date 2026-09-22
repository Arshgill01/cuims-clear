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
- Three automatic submits open the circuit until a confirmed `StudentHome.aspx` landing
- Returning to the UID page does not clear the circuit
- A detected portal lockout adds a 20-minute wait window; CAPTCHA solving remains available for manual review
- **No proactive banners** while the circuit is merely open — status appears only after a portal reject/lockout or when a submit is actually blocked

**Paths:** `outputs/cuims-clear-firefox/content.js` (source of truth), synced to Chrome via `scripts/sync-chrome-build.sh`.

### 2. No lockout / server-error detection — **FIXED** (heuristic, calm UI)

**Fix:** Pattern match on `#lblMessage`, `#lblError`, validation summaries, and body text. Lockout, rejected-login, maintenance, timeout, and unavailable-service messages are handled separately. A transient CUIMS server error releases the most recent reserved auto-submit slot instead of treating the outage as a bad credential or CAPTCHA.

**Fixtures:** `tests/fixtures/login/{lockout,invalid-captcha,invalid-password}.html`  
**Tests:** `tests/login-safety.test.mjs` executes both shipped content scripts against the fixtures.

### 3. Attempt counter ignored portal rejects — **FIXED**

- Auto-submit click consumes one budget slot
- Portal error after a **recent** auto-submit does **not** double-count
- Manual Login rejects still consume budget when error UI is seen
- Lockout UI blocks automatic submission immediately

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

**Measured 2026-09-22:** 53 manually labelled, freshly fetched public CUIMS CAPTCHA images were split before tuning (26 exploration, 27 holdout). Chrome's actual canvas preprocessing plus the shipped Tesseract ranking produced 19/26 exact matches on exploration and **16/27 (59.3%)** on holdout, at about **25 ms warmed mean OCR time** in the local Node/Tesseract harness. A fixed-threshold single-pass candidate scored 22/26 on exploration but regressed to 16/27 on holdout, so it was rejected. `tessdata_best` reached 18/27 but adds roughly 12 MB compressed and remains far below target, so it was rejected too. Case-sensitive exact match is the metric.

**Deferred:** 90–95% remains a target, not a claim. Reaching it likely needs a purpose-trained local character model and a committed, independently labelled train/validation/test corpus. No unvalidated OCR experiment was shipped.

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

- `tests/login-safety.test.mjs` executes the shipped Chrome and Firefox content scripts directly, including the UID-only page, retry persistence, lockout copy, transient server errors, and login fixtures
- `tests/dom-lifecycle.test.mjs` off the old `MAX=99` contract

### 17–18. OCR corpus / dual-browser CI — **PARTIAL**

The one-off 53-image benchmark established an honest baseline but is not committed as a permanent corpus. Chrome 153 was exercised with the unpacked 0.6.4 build: extension load, popup render, real CUIMS UID-page injection, saved test UID fill, service-worker startup, and offscreen Tesseract prewarm passed. Firefox behavior is covered by direct shipped-script tests; temporary-addon browser smoke remains manual.

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
