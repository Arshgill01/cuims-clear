# CUIMS Clear for Chrome

Same CUIMS login helper as the Firefox build: optional saved UID/password filling, on-device
CAPTCHA solving, quiet mode for event/feedback overlays, a cleaner LMS course
directory that pairs syllabus materials with semester work, and an **Attendance**
tab that reads your attendance and safe-skip counts without opening CUIMS, a **Forecast**
tab that projects each subject to the last day of classes and plans skips, and twenty
colour themes that restyle the popup, LMS pages, CUIMS itself and the toolbar icon together.

Version **0.10.0** also includes:

- **Marks** for current-session examination results, cached until you press Refresh.
- **Timetable** with weekday buttons, today selected in India time, and classes sorted by time. Teacher, class type, room and group appear beside a fixed time column.
- Background sign-in for both tabs when needed, without an open CUIMS tab. Timetable is fetched once per saved UID and reused by Attendance; switching days sends no requests.
- A 30-second gap between Marks refreshes and shared backoff when CUIMS refuses requests. Clear login removes the cached marks and timetable too.

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

Version 0.10.0 packages the shared Marks, Timetable and login fixes for Chrome.
The release zip is built locally; publishing this Git branch does not submit it to the Chrome Web Store.

`scripts/sync-chrome-build.sh` synchronizes the shared login, popup, solver,
and LMS files from the Firefox build. Chrome manifest and service-worker files
remain Chrome-specific.

## Privacy

- Host access is limited to `https://students.cuchd.in/*` and `https://lms.cuchd.in/*`.
- Optional saved UID/password and preferences are stored in local extension storage. Credentials are not encrypted by the extension or sent to the developer.
- CAPTCHA images are processed on-device. Nothing is uploaded to an OCR service.
- Open LMS uses CUIMS’s own SSO control and does not store SSO URLs or tokens.

See [PRIVACY.md](PRIVACY.md).
