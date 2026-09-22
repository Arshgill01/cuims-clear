# PR #2 review and hardening plan

Goal: keep the Chrome and Firefox login quick while preventing repeated automatic failures, and measure any OCR accuracy change before claiming improvement.

- [x] Read project rules, release context, PR diff, and current test coverage.
- [x] Reproduce lockout and login lifecycle failures against shipped scripts, including Chrome's service worker path.
- [x] Make the smallest shared Chrome/Firefox fixes for confirmed failures; keep local credentials and local OCR.
- [x] Establish a labeled CAPTCHA baseline, improve the solver only where evidence supports it, and record speed and accuracy.
- [x] Run targeted tests, complete suite, browser smoke checks where possible, and package parity checks.
- [x] Commit scoped changes to the PR branch and report remaining limits. Leave main and deployment untouched.

Known limits: no test CUIMS credentials are available, so live successful login and server lockout behavior cannot be exercised. The repository has one labeled real CAPTCHA image; a 90–95% claim needs a larger independent labeled set.
