# 1.0.0 release validation — 17 October 2026

Prepared in `/Users/arshdeepsingh/Developer/cuims-clear-1.0`, branch
`feat/1.0-celebration`, based on `0c19d7b` plus the pending release-preparation edits.
No store publishing, main merge, push, or authenticated CUIMS activity was performed.
The deferred leave feature work is not included; the existing Duty Leave External-tab
compatibility fix is retained.

## Commands and results

Run from that checkout:

- `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' npm test` — PASS: 367 passed, zero skipped, zero failed. Includes both browser-dependent tidy checks and all 530 CAPTCHA samples.
- `node work/e2e/conservative-smoke.mjs` — PASS: packaged Chrome worker/popup, cached attendance, 30-second pause, Retry-After, LMS tab intent without a background LMS request, duty-leave read and approval update; no page errors.
- `node work/e2e/updates-chrome.mjs outputs/cuims-clear-chrome` — PASS: real unpacked extension; Check now, future-version banner, Update response, CUIMS bar and one-day snooze; no page errors. Chrome answered "Still downloading. Try again in a minute." for the seeded future update; this does not demonstrate an actual store upgrade.
- `node work/e2e/updates-firefox.mjs outputs/cuims-clear-firefox` — PASS: real temporary extension; AMO reached (listed 0.10.6), future banner, What's new and Got it, Update opens CUIMS, Firefox's install-allow prompt observed and declined.
- `node work/e2e/forecast-glitches.mjs chrome outputs/cuims-clear-chrome` — PASS: zero failures, zero notes.
- `node work/e2e/forecast-glitches.mjs firefox outputs/cuims-clear-firefox` — PASS: zero failures, zero notes.
- `node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome` — PASS: actual extension with intercepted portal requests, no page errors.
- `node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox` — PASS: actual extension with intercepted portal requests, no page errors.
- `node work/e2e/release-1.0.mjs chrome outputs/cuims-clear-chrome` — PASS.
- `node work/e2e/release-1.0.mjs firefox outputs/cuims-clear-firefox` — PASS. Both runs use the existing offline popup/storage fixture in a real browser: founder receipt and heatmap; actual PNG blob at 1080×1920; seal and two-step early opening of a time capsule; Wrapped navigation and Escape dismissal; actual ICS blob with events; launch Proxy Run; founder-theme availability and fresh-install lock. Zero HTTP requests and zero page errors. Downloads are intercepted; clipboard and calendar-app import were not exercised.
- `/Users/arshdeepsingh/.npm/_npx/35252c8d98e7cc35/node_modules/.bin/web-ext lint --source-dir outputs/cuims-clear-firefox --output json` — PASS: zero errors, zero notices, ten warnings. Same command against main's 0.10.6: six warnings. Four additional innerHTML warnings are in celebrate.js (three) and wrapped.js (one); remaining warning categories are the existing lms-open-wrap.js eval and Chrome-only requestUpdateCheck API. Dynamic receipt/capsule text is escaped; Wrapped's overlay markup is static. Warnings are disclosed, not suppressed.
- `for file in outputs/cuims-clear-chrome/*.js outputs/cuims-clear-firefox/*.js; do node --check "$file" || exit 1; done` — PASS.
- `sh scripts/package.sh` — PASS: synchronizes shared files, reruns the unit suite, checks matching versions and rebuilds both ZIPs.
- `python3 /tmp/cuims-verify-1.0.py` — PASS: one-off Python standard-library ZipFile verification of CRCs, exact file inventory and bytes against source, root manifest version 1.0.0, every manifest/popup asset reference, unchanged permissions and host permissions against main, and all 43 shared runtime files identical. Chrome: 52 files; Firefox: 47. Hidden files and AMO upload metadata excluded.
- `shasum -a 256 outputs/dist/cuims-clear-chrome-1.0.0.zip outputs/dist/cuims-clear-firefox-1.0.0.zip > outputs/dist/SHA256SUMS-1.0.0.txt` — PASS; hashes below.
- `git diff --check` — PASS.

Browsers: Chrome 155.0.8059.80; Firefox 158.0. Evidence is under ignored
`work/e2e/results/`, including `release-1.0/{chrome,firefox}/report.json` and screenshots.
Earlier failed attempts of the new harness were harness issues (fixture reset on reload,
Firefox's lack of CDP media emulation, and its Space key spelling); fixed and rerun.
The update harnesses now derive a future version from the package instead of seeding
0.10.7, which is older than 1.0.

## Final archives

| Browser | ZIP | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Chrome | outputs/dist/cuims-clear-chrome-1.0.0.zip | 241982 | 183de805934d53302aebb1a5a509a0ec7f87747cfa21346e27ccff29b107cb50 |
| Firefox | outputs/dist/cuims-clear-firefox-1.0.0.zip | 238117 | b46c7faedd3a3f922dce80840a7700035244a3ae762f9ce4e9db32088120fb08 |

## Remaining publication checks

1. Merge/push the reviewed 1.0 branch so the public privacy-policy URL used by the
   store listings contains the new 1.0 disclosures. Main is still 0.10.6. The ZIPs
   already contain the updated policies.
2. With your account, do one ordinary login, Attendance/Forecast refresh, LMS opening,
   and timetable/date-sheet/marks check in each browser. Automated coverage uses
   mocked portal data, except the public login/update pages; no authenticated live
   check was performed during this release preparation. Import one generated ICS
   into your calendar if you want to verify app-specific behavior.
3. Submit the ZIP for the matching store, using store/RELEASE-NOTES-1.0.0.md and
   store/chrome/listing.md; AMO reviewer copy is in the Firefox amo-metadata.json.
4. After approval, verify an actual signed 0.10.x → 1.0.0 update preserves saved
   login and unlocks founder themes. A fresh install must keep those themes locked.
   Store-delivered installation/restart cannot be proven with an unpacked build.
