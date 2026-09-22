# Chrome Web Store listing

## Name
CUIMS Clear

## Summary
Faster CUIMS login and a cleaner LMS, with syllabus materials and semester work paired by subject.

## Description
Get to your CUIMS dashboard and LMS courses with fewer repeated steps.

CUIMS Clear is an independent student-built extension for Chandigarh University students.

• Optionally save your UID and password in the extension popup to fill CUIMS login automatically, or enter them directly on the portal.
• Read the login CAPTCHA on your device using the bundled OCR engine.
• Choose whether to advance past the UID step and submit the completed login form automatically.
• Hide promotional event dialogs and feedback interruptions with optional quiet-mode controls.
• Open CUIMS or the LMS from the extension popup.
• Browse a cleaner LMS course directory that pairs Syllabus & Materials with Semester Work by subject. Switch back to the original LMS view when needed.

Optional saved UID/password and extension preferences are stored locally on your device. Saved credentials are not encrypted by the extension and are not synchronized through Chrome Sync. CAPTCHA images are processed on-device, with no external OCR service. CUIMS Clear includes no analytics or advertising. Your credentials are submitted only to the university's CUIMS login service when you sign in.

Use Clear login in the popup to remove your saved UID/password. Uninstalling CUIMS Clear removes its local storage.

What changed in 0.6.3
Restores the saved-login fields and automatic UID/password filling from before 0.6.2. Restores the original CAPTCHA filling and optional auto-submit flow, reverting the Chrome password-manager-only change. If 0.6.2 cleared your saved extension login, save it again once; deleted credentials cannot be recovered. Existing Chrome password-manager entries are unaffected. The cleaner LMS view and quiet-mode features remain available.

Works only on students.cuchd.in and lms.cuchd.in. A valid university account is required to use the portals. Requires Chrome 120 or newer.

CUIMS Clear is not affiliated with, endorsed by, or an official product of Chandigarh University.

## Single purpose
Help Chandigarh University students access and navigate their CUIMS and LMS portals with login assistance, fewer on-page interruptions, and a clearer course directory.

## Permission justifications

### storage
Save optional student UID/password and login-automation, quiet-mode, and LMS-view preferences in chrome.storage.local. Credentials are not encrypted by the extension. Clear login removes saved credentials; uninstall removes local storage. No browser sync or developer backend is used.

### tabs
Find and reuse existing CUIMS and LMS tabs when the student selects Open LMS, coordinate the university's own SSO launch, and focus the resulting LMS tab. The extension does not record browsing history.

### offscreen
Run the bundled Tesseract OCR worker and WebAssembly engine in a Chrome offscreen document because the Manifest V3 service worker cannot run this document-based OCR workflow. CAPTCHA images are processed locally.

### Host permissions
students.cuchd.in: assist with the login form by filling optionally saved credentials or using credentials entered by the student, process its CAPTCHA locally, apply the student's optional quiet-mode settings, and launch the university's own LMS SSO control.
lms.cuchd.in: display a cleaner course directory and course navigation, including fetching same-origin course directory pages to pair syllabus materials with semester work.

### Remote code
No remote code is executed. Tesseract.js, its worker, WebAssembly core, and English OCR model are bundled in the uploaded ZIP. Same-origin LMS fetches retrieve course page content, not executable code.

## Reviewer instructions
Inspect the popup without an account: saved UID/password fields, Clear login, automation and quiet-mode controls. Full testing requires a university-issued student account; none is bundled. Version 0.6.3 restores optional local credential storage (not encrypted by the extension), original CAPTCHA filling and auto-submit. With an authorized account, save a login or enter it on CUIMS, then open LMS via university SSO. OCR runs locally; no remote code.

## URLs
Homepage: https://github.com/Arshgill01/cuims-clear
Support: https://github.com/Arshgill01/cuims-clear/issues
Privacy policy: https://github.com/Arshgill01/cuims-clear/blob/main/outputs/cuims-clear-chrome/PRIVACY.md

## Submission status
0.6.2 is published (dashboard verified 22 September 2026). 0.6.3 restoration is being prepared for review. Distribution remains free, public, all regions. No personal university credentials are shared.
