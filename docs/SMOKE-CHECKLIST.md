# Dual-browser smoke checklist (Chrome + Firefox)

Run after packaging changes. Do **not** commit real CUIMS credentials.

## Automated evidence (2026-09-22)

- [x] Chrome 153 loaded `outputs/cuims-clear-chrome` unpacked as version 0.6.4
- [x] Popup rendered; live CUIMS UID page received the content script
- [x] Isolated test UID filled with `autocomplete=username`; test value was removed afterward
- [x] MV3 service worker started and offscreen Tesseract document prewarmed
- [x] Chrome and Firefox shipped content scripts passed the same login-safety regression tests
- [x] No login or CAPTCHA was submitted during live smoke testing

## Package

- [ ] Chrome unpacked: `outputs/cuims-clear-chrome` (manifest version matches popup)
- [ ] Firefox temporary add-on: `outputs/cuims-clear-firefox`
- [ ] After shared solver edits, ran `scripts/sync-chrome-build.sh`

## Happy path (zero catch)

- [ ] Valid OCR (4–6 alnum) auto-fills **and** auto-clicks Login immediately
- [ ] No status banner / cool-down copy during a clean success
- [ ] No artificial pause before Login on the happy path

## Quiet safety (failures only)

- [ ] Third auto-submit exhausts budget; fourth does not auto-click
- [ ] Calm pause copy appears only when a submit is blocked or portal rejects
- [ ] Lockout / invalid-login banners pause automation
- [ ] Successful StudentHome visit clears the budget
- [ ] Junk-length OCR fills (if any) without a confidence lecture

## CAPTCHA (on-device only)

- [ ] Prewarm: first captcha after install is slower; second is faster
- [ ] No outbound OCR/provider requests in network panel

## Parity / regressions

- [ ] Saved UID/password still autofill (local storage intentional)
- [ ] Feedback / event overlay quiet mode still works
- [ ] Open CUIMS / Open LMS from popup
- [ ] LMS clear view still pairs subjects
