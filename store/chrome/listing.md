# Chrome Web Store listing

## Name
CUIMS Clear

## Summary
Faster CUIMS login, attendance without opening the portal, and a cleaner LMS with materials and semester work paired by subject.

## Description
Get to your CUIMS dashboard, attendance and LMS courses with fewer repeated steps.

CUIMS Clear is an independent student-built extension for Chandigarh University students.

• Optionally save your UID and password in the extension popup to fill CUIMS login automatically, or enter them directly on the portal.
• Read the login CAPTCHA on your device with the extension's own solver, and press Login for you (up to three tries).
• See your attendance on the Attendance tab without opening CUIMS: per-subject and overall percentages, how many classes you can skip at 75% per subject and 90% overall, approved and pending leave, and today's classes.
• Hide promotional event dialogs and feedback interruptions with optional quiet-mode controls. Dialogs you open yourself, and CUIMS's online tests, are left alone.
• Open CUIMS or the LMS from the extension popup.
• Browse a cleaner LMS course directory that pairs Syllabus & Materials with Semester Work by subject, for every batch and section. Switch back to the original LMS view when needed.
• Choose from twenty colour themes that restyle the popup, the LMS view, CUIMS itself and the toolbar icon.

Optional saved UID/password, attendance figures and extension preferences are stored locally on your device. Saved credentials are not encrypted by the extension and are not synchronized through Chrome Sync. CAPTCHA images are processed on-device, with no external OCR service. CUIMS Clear includes no analytics or advertising. Your credentials are submitted only to the university's CUIMS login service when you sign in.

Use Clear login in the popup to remove your saved UID/password and attendance. Uninstalling CUIMS Clear removes its local storage.

What changed in 0.9.0
A new popup: a side rail with Attendance, Login, Theme and Settings. Every switch now lives on Settings and saves as you flip it. Seven more themes. Quiet mode no longer hides CUIMS's own loading screen, dialogs you open yourself (such as My Question Or Queries), or anything on the online test pages, and no longer mistakes words like "generating" for "rating". Semester Work is found for every batch and section in the LMS view.

Works only on students.cuchd.in and lms.cuchd.in. A valid university account is required to use the portals. Requires Chrome 120 or newer.

CUIMS Clear is not affiliated with, endorsed by, or an official product of Chandigarh University.

## Single purpose
Help Chandigarh University students access and navigate their CUIMS and LMS portals with login assistance, their own attendance at a glance, fewer on-page interruptions, and a clearer course directory.

## Permission justifications

### storage
Save optional student UID/password, login-automation, quiet-mode, theme and LMS-view preferences, and the student's own attendance figures, in chrome.storage.local. Credentials are not encrypted by the extension. Clear login removes saved credentials and attendance; uninstall removes local storage. No browser sync or developer backend is used.

### tabs
When the student selects Open CUIMS or Open LMS in the popup, open the portal in a new tab next to the current one, or focus an LMS tab that is already open instead of opening another. The extension does not record browsing history.

### Host permissions
students.cuchd.in: assist with the login form by filling optionally saved credentials or using credentials entered by the student, process its CAPTCHA locally, apply the student's optional quiet-mode settings and theme, launch the university's own LMS SSO control, and read the student's own attendance report, timetable, and duty and medical leave applications for the Attendance tab.
lms.cuchd.in: display a cleaner course directory and course navigation, including fetching same-origin course directory pages to pair syllabus materials with semester work.

### Remote code
No remote code is executed. The CAPTCHA solver (captcha-solver.js) and its glyph table (captcha-glyphs.js) are plain, unminified JavaScript in the uploaded ZIP. Same-origin LMS fetches retrieve course page content, not executable code.

## Reviewer instructions
Inspect the popup without an account: the Login tab (saved UID/password fields, Clear login), the Settings tab (automation, quiet-mode and LMS switches) and the Theme tab. Full testing requires a university-issued student account; none is bundled. With an authorized account, save a login or enter it on CUIMS, fetch attendance from the Attendance tab, then open LMS via university SSO. CAPTCHA solving runs locally; no remote code.

## URLs
Homepage: https://github.com/Arshgill01/cuims-clear
Support: https://github.com/Arshgill01/cuims-clear/issues
Privacy policy: https://github.com/Arshgill01/cuims-clear/blob/main/outputs/cuims-clear-chrome/PRIVACY.md

## Submission status
0.9.0 (new popup layout, quiet-mode fixes, LMS sections fix from 0.8.7) is being prepared for review. Distribution remains free, public, all regions. No personal university credentials are shared.
