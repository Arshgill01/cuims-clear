# Chrome Web Store listing

## Name
CUIMS Clear

## Summary
Faster CUIMS login and a cleaner LMS, with syllabus materials and semester work paired by subject.

## Description
Get to your CUIMS dashboard and LMS courses with fewer repeated steps.

CUIMS Clear is an independent student-built extension for Chandigarh University students.

• Use Chrome’s password manager to fill your UID and password on CUIMS, or enter them directly on the portal. CUIMS Clear does not save credentials.
• Read the login CAPTCHA on your device using the bundled OCR engine.
• Choose whether to advance past the UID step and submit the completed login form automatically.
• Hide promotional event dialogs and feedback interruptions with optional quiet-mode controls.
• Open CUIMS or the LMS from the extension popup.
• Browse a cleaner LMS course directory that pairs Syllabus & Materials with Semester Work by subject. Switch back to the original LMS view when needed.

Only extension preferences are saved in local extension storage. CAPTCHA images are processed on-device, with no external OCR service. CUIMS Clear includes no analytics or advertising. Your credentials are submitted only to the university's CUIMS login service when you sign in.

Manage saved passwords in Chrome’s password manager. Uninstalling CUIMS Clear removes its preferences.

Works only on students.cuchd.in and lms.cuchd.in. A valid university account is required to use the portals. Requires Chrome 120 or newer.

CUIMS Clear is not affiliated with, endorsed by, or an official product of Chandigarh University.

## Single purpose
Help Chandigarh University students access and navigate their CUIMS and LMS portals with saved-login assistance, fewer on-page interruptions, and a clearer course directory.

## Permission justifications

### storage
Save only login-automation, quiet-mode, and LMS-view preferences in chrome.storage.local. No UID, password, browser sync, or developer backend is used. Older extension-stored credentials are removed on update.

### tabs
Find and reuse existing CUIMS and LMS tabs when the student selects Open LMS, coordinate the university's own SSO launch, and focus the resulting LMS tab. The extension does not record browsing history.

### offscreen
Run the bundled Tesseract OCR worker and WebAssembly engine in a Chrome offscreen document because the Manifest V3 service worker cannot run this document-based OCR workflow. CAPTCHA images are processed locally.

### Host permissions
students.cuchd.in: fill the university login form, process its CAPTCHA locally, apply the student's optional quiet-mode settings, and launch the university's own LMS SSO control.
lms.cuchd.in: display a cleaner course directory and course navigation, including fetching same-origin course directory pages to pair syllabus materials with semester work.

### Remote code
No remote code is executed. Tesseract.js, its worker, WebAssembly core, and English OCR model are bundled in the uploaded ZIP. Same-origin LMS fetches retrieve course page content, not executable code.

## Reviewer instructions
The popup can be inspected without a university account. Pin the extension and open CUIMS Clear to see the password-manager instructions, login automation controls, quiet-mode controls, and portal links.
Full portal functionality requires a valid Chandigarh University student account; no reviewer account is bundled. Do not use invented credentials. On an authorized account, fill the login on the university page using Chrome’s password manager or manual entry, open CUIMS, and inspect the configured login assistance. Open LMS to use the university SSO flow and inspect the paired course directory. The original LMS view remains available.

## URLs
Homepage: https://github.com/Arshgill01/cuims-clear
Support: https://github.com/Arshgill01/cuims-clear/issues
Privacy policy candidate (verify public content before submission): https://github.com/Arshgill01/cuims-clear/blob/main/outputs/cuims-clear-chrome/PRIVACY.md

## Submission status
Package prepared; dashboard upload not yet verified. Data-use declarations must accurately include locally handled credentials and page content where the form asks about handling, not only developer-side collection. Required store images remain to be uploaded.
