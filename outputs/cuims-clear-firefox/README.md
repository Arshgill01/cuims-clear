# CUIMS Clear for Firefox

A Firefox Manifest V3 extension for `https://students.cuchd.in/` that:

- fills your student UID and optionally presses **Next**;
- fills your CUIMS password from local Firefox extension storage;
- reads the login CAPTCHA with bundled on-device OCR (Tesseract), fills the
  answer, and safely retries when a read is wrong;
- enlarges the CAPTCHA image and focuses the field whenever automatic solving
  is off, unsure, or has used up its retry budget;
- suppresses blocking event and feedback overlays while leaving other dialogs alone;
- skips the full-page `LandingPage.aspx` promotion and opens `StudentHome.aspx` directly;
- lets you erase the saved UID and password from the popup at any time.

CAPTCHA solving happens entirely inside the extension: the OCR engine, WASM
binary, and English model are bundled in the package, and the captcha image is
processed in your browser. No data is sent to any server. Automatic attempts
are capped (default 3 per login) so the loop always falls back to manual entry.

CUIMS Clear is an independent student-built project. It is not affiliated with or endorsed
by Chandigarh University.

Requires Firefox 142 or newer.

## Install the development build

This build is unsigned, so normal Firefox keeps it only until the browser restarts.

1. Download `cuims-clear-firefox.zip`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Select the downloaded ZIP, or select `manifest.json` inside the unpacked `cuims-clear-firefox` folder.
5. Open the CUIMS Clear toolbar popup, enter your UID, and save.
6. Enter the UID and password in the extension popup, then save.

## Install permanently

Standard Firefox requires a Mozilla-signed XPI. Once `cuims-clear-firefox.xpi` has been
signed:

1. Open **Add-ons and themes** in Firefox.
2. Open the settings cog and select **Install Add-on From File**.
3. Choose the signed XPI and approve the requested access.

Mozilla signing can be requested without creating a public AMO listing:

```sh
web-ext sign \
  --source-dir outputs/cuims-clear-firefox \
  --channel unlisted \
  --api-key "$WEB_EXT_API_KEY" \
  --api-secret "$WEB_EXT_API_SECRET"
```

Do not put Mozilla API credentials in the repository or send them in chat. The unsigned ZIP
is useful for review and temporary loading, but cannot remain installed in normal Firefox
after restart.

## Popup matching

The blocker only acts on dialog-style elements whose text looks like an event or feedback request. Turn either category off from the toolbar popup if CUIMS changes its markup or a legitimate dialog is matched.

Because the logged-in CUIMS dashboard was not available during development, the blocker uses conservative Bootstrap, jQuery UI, and SweetAlert modal selectors. If a CUIMS popup survives, inspect it or share a screenshot/HTML sample so its exact selector can be added.

## Privacy

- Host access is limited to `https://students.cuchd.in/*`.
- UID and password are saved in Firefox `storage.local` on this device.
- CAPTCHA images are processed on-device by bundled OCR code. No information is
  collected or transmitted.
- Firefox extension storage is not encrypted. Anyone with access to your Firefox profile may be able to read the saved values.
- Use **Clear login** in the popup to remove the saved UID and password.

See [PRIVACY.md](PRIVACY.md) for the complete privacy statement.

## Bundled third-party code

`vendor/tesseract/` contains Tesseract.js 5.1.1 and tesseract.js-core 5.1.1
(Apache-2.0). `vendor/tessdata/` contains the English `best_int` traineddata
from the @tesseract.js-data project (Apache-2.0). These files are minified as
published upstream; licenses are included in the package.
