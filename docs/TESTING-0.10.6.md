# 0.10.6: telling students a new version is out, and updating from it

0.10.6 is 0.10.5 plus update notices. Nothing about attendance, CUIMS
requests or the login changed.

## Why

Students ran old builds for weeks without knowing. Three things make that
easy:

- Browsers check for add-on updates on their own schedule: Firefox once a
  day while it runs, Chrome every few hours, both after store review.
- **Neither store's page can update an installed add-on.** With an older
  version installed, AMO's listing shows only "Remove" (its versions page
  too); the newest version has no install button there at all.
- A Firefox profile that automation software once attached to can keep
  `extensions.update.enabled = false` (one of the settings Marionette and
  WebDriver BiDi apply while they run). That browser never updates any
  add-on. The developer's own daily Firefox profile had it.

## What a browser lets an extension do (tested 14 Oct 2026, Firefox 157)

In a throwaway Firefox profile with the signed AMO 0.10.4 installed, AMO
serving 0.10.5:

| How AMO's latest.xpi was opened | Result |
| --- | --- |
| A tab the extension opens by itself | Refused: "install cancelled because of missing user gesture activation" |
| `tabs.create` from a click in an extension page | Refused: same |
| A link clicked in an extension page | Refused: "Firefox prevented this site from asking you to install software" |
| `tabs.create({ url: "about:addons" })` | "Illegal URL" |
| A link on a web page, including one a content script added | "Allow <site> to install an add-on?", then "Add CUIMS Clear?": **0.10.4 → 0.10.5 in place**, same extension ID, saved UID still there |

And from Firefox's own source (XPIInstall.sys.mjs, `checkForBlockers`): if an
extension listens to `runtime.onUpdateAvailable`, Firefox postpones its
updates until the browser restarts. So the Firefox build never listens.

Chrome has `chrome.runtime.requestUpdateCheck()` (asks the Web Store and
downloads) and `chrome.runtime.reload()` (installs a downloaded update), so
Chrome can update from inside the extension.

## What changed

- **update-check.js:** version comparison, when to check (six hours on its
  own; Check now a minute apart), What's new notes per version.
- **update-bg.js:** the check. Chrome: `requestUpdateCheck`. Firefox: AMO's
  public API (`/api/v5/addons/addon/cuims-clear/`, which allows any origin;
  no new permission, no cookies), ignoring a version this Firefox is too old
  for. Sets a "↑" badge on the toolbar icon while an update is out. Chrome's
  Update waits for the download (a second ask within minutes is "throttled")
  and for any CUIMS read or sign-in to finish, then restarts. The update
  landing clears the notice and leaves What's new. It cannot throw while
  loading (one failing script stops Chrome's whole service worker).
- **update-bar.js:** a bar on CUIMS pages (closed shadow root, theme
  colours): "CUIMS Clear X is out · Update". Firefox: a link to AMO's
  latest.xpi, with "Firefox asks twice: Allow, then Add". Chrome: a button
  that updates and reloads the page. × hides it for a day in every tab.
- **Popup:** a banner at the top while an update is out (Chrome: Update now
  installs it; Firefox: Update now clears the bar's × and opens CUIMS, where
  the bar's link is); a "What's new" card after an update, until Got it or
  three days; Settings → Updates: the version, when it last checked, Check
  now. The rating ask waits while either is showing.
- No new permission or host access in either build.
- PRIVACY.md (both) and AMO's reviewer notes describe the check.

## Not changed

CUIMS requests, their budgets and spacing; sign-in; Open CUIMS / Open LMS.
The check never touches CUIMS.

## Evidence

- `npm test`: 345 pass, 2 skipped. New tests/updates.test.mjs (16 tests):
  version order, check cadence, AMO compatibility, What's new, the Firefox
  and Chrome background paths with a fake clock, Chrome's throttle after a
  found update, sender checks, no `onUpdateAvailable` listener in Firefox,
  same scripts in both builds, permissions unchanged.
- `work/e2e/updates-firefox.mjs` (real Firefox 157, disposable profile, the
  unpacked 0.10.6): Check now reached AMO ("Up to date", AMO lists 0.10.5);
  banner; What's new and Got it; Update now opened CUIMS (redirected to
  Login.aspx) with the bar showing though × had hidden it; the bar's Update
  link brought up "Allow students.cuchd.in to install an add-on?".
- `work/e2e/updates-chrome.mjs` (real Chrome, unpacked): Check now through
  `requestUpdateCheck` ("Up to date"); banner; Update now answered plainly
  (an unpacked build has no store copy); the bar on CUIMS; × saved a day's
  snooze.
- `work/e2e/forecast-glitches.mjs`: 0 failures in Chrome and Firefox.
- Screenshots: work/e2e/results/{ff,chrome}-updates-*.png.

## Only the stores can test

The real thing needs a newer version in the store than the one installed:
publish 0.10.6, then 0.10.7. On 0.10.6, once 0.10.7 is live:

1. Within six hours of the store listing it (or Settings → Check now), the
   icon shows ↑ and the popup says "Version 0.10.7 is out".
2. Chrome: Update now → the popup closes, the extension restarts on 0.10.7,
   the saved login is there, the popup shows "Updated to 0.10.7".
3. Firefox: Update now → CUIMS opens with the bar → Update → Allow → Add →
   0.10.7, saved login there, "Updated to 0.10.7" in the popup.

Students on 0.10.5 or older see none of this until they reach 0.10.6.

## Merge validation — 16 October 2026

Reviewed the update scripts, popup integration, manifest/background load order,
privacy changes, sender checks, and regression tests against main at ad42e72.
Attendance and LMS implementation files are unchanged from main.

Commands run from the repository root:

- `npm test` — PASS: 345 passed, 2 skipped (browser paths unset).
- `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' node --test tests/cuims-tidy.test.mjs` — PASS: 9 passed, none skipped, including both previously skipped browser tests.
- `npm run sync` — PASS; shared sources synchronized.
- `node work/e2e/updates-chrome.mjs outputs/cuims-clear-chrome` — PASS; no page errors. The simulated future version cannot install from this unpacked build; it reported still downloading.
- `node work/e2e/updates-firefox.mjs outputs/cuims-clear-firefox` — PASS; AMO now lists 0.10.6. The install prompt was declined in the disposable profile.
- `node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome` — PASS.
- `node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox` — PASS.
- `node work/e2e/forecast-glitches.mjs chrome outputs/cuims-clear-chrome` — PASS: zero failures.
- `node work/e2e/forecast-glitches.mjs firefox outputs/cuims-clear-firefox` — PASS: zero failures.
- `node work/e2e/conservative-smoke.mjs` — initially failed because the harness still assumed the old 60-second pause and a blocked LMS launch. Updated the harness to seed the current 30-second pause after popup load and record the LMS tab intent without visiting the portal. PASS twice after correction; no product behavior changed.
- `sh scripts/package.sh` — PASS: reruns the unit suite and builds both 0.10.6 ZIPs.
- `git diff --check` — PASS.

A Python standard-library ZipFile check verified CRCs, version 0.10.6, exact
archive file lists, and every file's bytes against the source directories:
Chrome 42 files, Firefox 37 files. AMO reviewer metadata is excluded as intended.

Both forecast runs reported one informational note for the existing 9.5px
version label. Browsers used: Chrome 155.0.8059.80 and Firefox 158.0.
Actual installation of a newer store version still requires the store rollout
procedure above; it cannot be demonstrated with an unpacked build and a seeded
future version notice. No store publishing was performed.
