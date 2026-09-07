# CUIMS Clear for Chrome

Same CUIMS login helper as the Firefox build: saved UID/password, on-device
CAPTCHA OCR, and quiet mode for event/feedback overlays.

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
5. Pin **CUIMS Clear**, open the popup, save your UID and password.

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

## Comfortable install for other people

Load unpacked is fine for you. For someone who should not touch Developer
mode, the only comfortable path is a Chrome Web Store listing (private or
unlisted). That needs a one-time Chrome Web Store developer registration.

Until then, send them this folder and the five steps above.

## Privacy

- Host access is limited to `https://students.cuchd.in/*`.
- UID and password are saved in Chrome `storage.local` on this device.
- CAPTCHA images are processed on-device. Nothing is uploaded.
- Chrome extension storage is not encrypted.

See [PRIVACY.md](PRIVACY.md).
