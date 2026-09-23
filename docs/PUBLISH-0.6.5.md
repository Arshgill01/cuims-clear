# Publishing 0.6.5 (Chrome) / 0.6.3 (Firefox)

These builds add the on-device CAPTCHA geometry corrector (dev 71.4%→90.0%,
holdout 58.3%→70.0%) and keep the reviewed login lockout hardening. Everything
stays local; no new permissions were added.

## Packages (built on this branch)

- Chrome MV3: `outputs/dist/cuims-clear-chrome-0.6.5.zip`
  - SHA-256: `59afc407352bb06cbd2e48a88de24a3d0ae1269d2d67c42d0f66d8f2680e131a`
- Firefox MV3: `outputs/dist/cuims-clear-firefox-0.6.3.zip`
  - SHA-256: `ca1152f70090361d39dcbf8011ebce3e526730bf81b4cd1dd83eb043689ec486`

Rebuild anytime:

```sh
cd outputs/cuims-clear-chrome && zip -rq ../dist/cuims-clear-chrome-0.6.5.zip . -x '*.DS_Store'
cd outputs/cuims-clear-firefox && zip -rq ../dist/cuims-clear-firefox-0.6.3.zip . -x '*.DS_Store'
```

## Before you publish — one manual check I could not do

I have no CUIMS credentials, so please load each unpacked build and do **one real
login** (UID → password → auto-solved CAPTCHA → Login):

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `outputs/cuims-clear-chrome`.
- Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → pick `outputs/cuims-clear-firefox/manifest.json`.

Confirm the CAPTCHA fills correctly and Login submits on the happy path. The
corrector never overwrites a correct read, so risk is low, but a live pass is the
one thing automated tests can't cover here.

## Chrome Web Store

1. https://chrome.google.com/webstore/devconsole (developer account
   `arshgill6120@gmail.com`), item `amlobigbjldbogimakmfndkdaekcdbkf`.
2. Package → Upload new package → `outputs/dist/cuims-clear-chrome-0.6.5.zip`.
3. Release notes suggestion: "Faster, more accurate on-device CAPTCHA reading and
   safer auto-login retries. No new permissions; everything stays on your device."
4. Submit for review (automatic publication after approval is already enabled).

## Firefox (AMO)

1. https://addons.mozilla.org/developers/ → CUIMS Clear → Upload New Version.
2. Upload `outputs/dist/cuims-clear-firefox-0.6.3.zip`.
3. Same release notes; submit for review.

No source-code upload step is required beyond the package; the build contains no
minified first-party code (only the vendored Tesseract, unchanged).
