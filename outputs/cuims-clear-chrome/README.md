# CUIMS Clear for Chrome

Same CUIMS login helper as the Firefox build: Chrome password-manager filling, on-device
CAPTCHA OCR, quiet mode for event/feedback overlays, and a cleaner LMS course
directory that pairs syllabus materials with semester work.

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
5. Pin **CUIMS Clear** and choose your automation preferences in the popup.
6. Open CUIMS and use Chrome’s password manager to fill your UID/password, or enter them directly on the portal. The extension does not save credentials.

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

Version 0.6.2 uses Chrome’s password manager instead of storing login credentials.
Updating from an older unpacked build removes its saved UID and password;
Chrome’s password-manager entries are unaffected. You may need to select a saved
login on the university page before automatic submission can proceed.

The Chrome Web Store listing is being prepared; it is not yet published.

The content script and popup are Chrome-specific. `scripts/sync-chrome-build.sh`
syncs the shared solver and LMS files without overwriting these files.

## Privacy

- Host access is limited to `https://students.cuchd.in/*` and `https://lms.cuchd.in/*`.
- Only preferences are saved in extension storage; UID/password are not saved.
- CAPTCHA images are processed on-device. Nothing is uploaded to an OCR service.
- Open LMS uses CUIMS’s own SSO control and does not store SSO URLs or tokens.

See [PRIVACY.md](PRIVACY.md).
