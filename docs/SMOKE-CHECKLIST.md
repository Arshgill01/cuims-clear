# Dual-browser smoke checklist (Chrome + Firefox)

Run after packaging changes. Do **not** commit real CUIMS credentials.

## Package

- [ ] Chrome unpacked: `outputs/cuims-clear-chrome` (manifest version matches popup)
- [ ] Firefox temporary add-on: `outputs/cuims-clear-firefox`
- [ ] After shared solver edits, ran `scripts/sync-chrome-build.sh`

## Login circuit breaker

- [ ] Auto-submit helper text mentions confident read + 3-try stop
- [ ] Uncertain OCR fills captcha but does not click Login
- [ ] Third auto-submit opens cool-down banner; fourth does not auto-click
- [ ] Lockout / invalid-login banners pause automation
- [ ] Successful StudentHome visit clears the budget

## CAPTCHA (on-device only)

- [ ] Prewarm: first captcha after install is slower; second is faster
- [ ] No outbound OCR/provider requests in network panel
- [ ] Enlarge-on-uncertainty still readable on mobile-width window

## Parity / regressions

- [ ] Saved UID/password still autofill (local storage intentional)
- [ ] Feedback / event overlay quiet mode still works
- [ ] Open CUIMS / Open LMS from popup
- [ ] LMS clear view still pairs subjects
