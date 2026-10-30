# AGENTS.md

CUIMS Clear: a Firefox + Chrome MV3 extension for students.cuchd.in and lms.cuchd.in.
Read `PRODUCT.md` and `DESIGN.md` before UI work.

## Layout

- `outputs/cuims-clear-firefox/` is the source of truth. Edit there, then run
  `npm run sync` to copy the shared files into `outputs/cuims-clear-chrome/`.
  Chrome-only files: `manifest.json`, `service-worker.js` (its `importScripts` list
  mirrors Firefox's `background.scripts`), PNG icons, README/PRIVACY wording.
- A new shared file must be added to `scripts/sync-chrome-build.sh`, both manifests
  (content scripts and/or background), and `popup.html` if the popup uses it.
- Models are DOM-free and shared by page, popup, background and tests
  (`attendance-model.js`, `marks-model.js`, `forecast-model.js`, `lms-model.js`).

## Verify

- `npm test`: every `tests/*.test.mjs` (node:test, vm-loaded sources).
- Real-browser tests run only with browsers set:
  `CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" FIREFOX_BIN=/Applications/Firefox.app/Contents/MacOS/firefox npm test`
- Browser tests serve fixtures at real CUIMS URLs through request interception;
  screenshots go to the ignored `work/e2e/results/`.
- Live checks against real CUIMS use `.env` (`CUIMS_UID`, `CUIMS_PASSWORD`) and
  disposable profiles; see `work/e2e/README.md`. Keep page loads at least six to
  eight seconds apart, never submit forms on CUIMS, and delete raw captures and
  screenshots afterwards: they hold personal data.

## CUIMS rules of thumb

- CUIMS refuses bursts of page loads (empty menu or error.html). Background page
  reads go through `attendance-daemon.js` (pacing, budgets, refusal pauses); never
  fetch CUIMS pages from anywhere else.
- Fixtures in this public repo must not contain a real student's marks, UID, name,
  photo or leave remarks: keep the markup, replace the values.
- Marks: CU weights each kind of assessment by a fixed share (theory internal 40 =
  assignment 10, surprise test 4, quiz 4, MSTs 20, attendance 2); never sum raw rows
  for a percentage. See `marks-model.js`.
- Duty Leave: Type and Next Step are async UpdatePanel postbacks; a date is a full
  page postback (fixed ids `txtDate`/`txtFromDate`). `duty-leave.js` never presses Save.
