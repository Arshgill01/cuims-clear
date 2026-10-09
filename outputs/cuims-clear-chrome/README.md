# CUIMS Clear for Chrome

Same CUIMS login helper as the Firefox build: optional saved UID/password filling, on-device
CAPTCHA solving, quiet mode for event/feedback overlays, a cleaner LMS course
directory that pairs syllabus materials with semester work, and an **Attendance**
tab that reads your attendance and safe-skip counts without opening CUIMS, a **Forecast**
tab that projects each subject to the last day of classes and plans skips, and twenty
colour themes that restyle the popup, LMS pages, CUIMS itself and the toolbar icon together.

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

Version 0.6.3 restores the login behavior from before 0.6.2: saved UID/password
fields, automatic filling, on-device CAPTCHA filling, and the original optional
auto-submit timing. The Chrome password-manager-only change in 0.6.2 is reverted.
If 0.6.2 removed your saved extension login, enter and save it once more;
those deleted values cannot be recovered. Chrome's own saved passwords are unaffected.

Version 0.6.2 is published. Version 0.6.3 is being prepared for store review.

`scripts/sync-chrome-build.sh` synchronizes the shared login, popup, solver,
and LMS files from the Firefox build. Chrome manifest and service-worker files
remain Chrome-specific.

## Conservative CUIMS reads

Background attendance, session checks and LMS SSO share a rolling budget of
25 explicit requests per 10 minutes. Manual attendance refreshes wait at least
60 seconds. Each permitted attendance read also fetches duty-leave status,
including the first read, so opening the CUIMS leave page is unnecessary.
An expired duty-leave session uses the existing guarded background sign-in;
medical-leave reads remain infrequent. These are extension safeguards, not
CUIMS's published UID limits;
portal tabs and browser-followed redirects can add their own traffic.

HTTP 429/503 or CUIMS's error-page redirect pauses background reads for at least
five minutes, increasing after repeated failures and honoring a longer
`Retry-After`. Optional attendance detail also stops on a refusal. Cached
attendance stays visible, with a disabled refresh button showing when it is
ready again. The countdown sends no requests.

## Privacy

- Host access is limited to `https://students.cuchd.in/*` and `https://lms.cuchd.in/*`.
- Optional saved UID/password and preferences are stored in local extension storage. Credentials are not encrypted by the extension or sent to the developer.
- CAPTCHA images are processed on-device. Nothing is uploaded to an OCR service.
- Open LMS uses CUIMS’s own SSO control and does not store SSO URLs or tokens.

See [PRIVACY.md](PRIVACY.md).
