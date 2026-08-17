# CUIMS Clear

A small Chrome/Edge extension for `https://students.cuchd.in/` that:

- fills your student UID and optionally presses **Next**;
- marks password fields for the browser's built-in password manager;
- focuses the CAPTCHA field when it is ready;
- suppresses blocking event and feedback overlays while leaving other dialogs alone.

It does not store your password or solve/bypass CAPTCHA.

## Install

1. Download and unzip `cuims-clear.zip`.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `cuims-clear` folder.
5. Pin **CUIMS Clear**, open its popup, enter your UID, and save.
6. Save the CUIMS password in Chrome/Edge when the browser offers to do so.

## Popup matching

The blocker only acts on visible dialog-style elements whose text looks like an event or feedback request. Turn either category off from the extension popup if CUIMS changes its markup or a legitimate dialog is matched.

Because the logged-in CUIMS dashboard was not available during development, the blocker uses conservative Bootstrap, jQuery UI, and SweetAlert modal selectors. If a CUIMS popup survives, inspect it or share a screenshot/HTML sample so its exact selector can be added.

## Privacy

- Host access is limited to `https://students.cuchd.in/*`.
- The only saved personal value is the UID in `chrome.storage.local`.
- No data is sent to an external service.
- Passwords remain under the browser password manager's control.
