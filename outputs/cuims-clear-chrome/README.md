# CUIMS Clear for Chrome

Same CUIMS login helper as the Firefox build: optional saved UID/password filling, on-device
CAPTCHA solving, quiet mode for event/feedback overlays, a cleaner LMS course
directory that pairs syllabus materials with semester work, and an **Attendance**
tab that reads your attendance and safe-skip counts without opening CUIMS, a **Forecast**
tab that projects each subject to the last day of classes and plans skips, and twenty-two
colour themes (including two reserved for pre-1.0 users) that restyle the popup, LMS pages, CUIMS itself and the toolbar icon together.

Chrome cannot load the Firefox folder. This package is the Chrome MV3 build.

Requires Chrome 120 or newer. Edge and Brave use the same steps with
`edge://extensions` or `brave://extensions`.

## Install (unpacked)

This is the fastest way to run it yourself or hand it to a classmate.

1. Use the `outputs/cuims-clear-chrome` folder from this repo, or unzip a
   copy of it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `cuims-clear-chrome` folder
   (the one that contains `manifest.json`).
5. Pin **CUIMS Clear** and choose your automation preferences under **Settings** in the popup.
   Each switch saves as you flip it.
6. Optionally enter your UID/password on the popup's **Login** tab and select **Save login**, then open CUIMS. Saved credentials are stored locally without extension-provided encryption. **Clear login** removes them. You can also enter credentials directly on the portal.

Do not load `outputs/cuims-clear` (old 0.1.0, no CAPTCHA) or
`outputs/cuims-clear-firefox` (Chrome rejects `background.scripts`).

Chrome will show a developer-mode banner while this stays unpacked. That is
normal. Reloading the extension after a code change is: `chrome://extensions`
→ CUIMS Clear → reload.

Then refresh any open CUIMS tabs so they use the updated content script.
Feedback blocking also reapplies when CUIMS tries to reopen a hidden popup.

## After Chrome restarts

Unpacked extensions stay installed. If Chrome disabled it, open
`chrome://extensions` and enable it again.

## Chrome Web Store release

Version 1.0.0 is prepared for manual store submission. Release notes and the
publication checklist are in `store/RELEASE-NOTES-1.0.0.md` in the repository.

`scripts/sync-chrome-build.sh` synchronizes the shared login, popup, solver,
and LMS files from the Firefox build. Chrome manifest and service-worker files
remain Chrome-specific.

## New in 1.0

The **1.0** tab includes a semester receipt, day-by-day attendance, Semester Wrapped,
a time capsule and Proxy Run. Existing users receive the Founding 100 stamp and the
Founding 100 and Black Card themes. Timetable, Datesheet and Marks View have new layouts;
classes and exams can be exported as local .ics calendar files. No new permissions.

## Conservative CUIMS reads

Opening Attendance or Forecast reads again when saved data is over two minutes old;
Refresh reads on demand, with a minimum 30-second gap. No periodic background polling.
Attendance report calls and session/page requests have separate local limits (60 report
calls and 10 session requests per ten minutes). These are extension safeguards, not
CUIMS's published quotas.

Optional timetable, date-sheet and leave pages are spaced and cached. A leave read never
signs in. Opening a supported CUIMS page supplies its data without a background fetch.
Duty Leave history is read from CUIMS's External tab when it is missing on Internal.

When CUIMS refuses page loads, optional pages pause while cached attendance remains
visible and report calls can continue. HTTP 429/503 honors Retry-After. The popup's
countdown makes no requests. See PRIVACY.md for the data stored and used.

## Privacy

- Host access is limited to `https://students.cuchd.in/*` and `https://lms.cuchd.in/*`.
- Optional saved UID/password and preferences are stored in local extension storage. Credentials are not encrypted by the extension or sent to the developer.
- CAPTCHA images are processed on-device. Nothing is uploaded to an OCR service.
- Open LMS uses CUIMS’s own SSO control and does not store SSO URLs or tokens.

See [PRIVACY.md](PRIVACY.md).
