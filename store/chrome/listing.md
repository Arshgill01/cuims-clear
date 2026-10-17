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
• See My Time Table, Datesheet and Marks View on CUIMS redrawn: what is on now and next with a countdown, back-to-back periods as one class, holidays marked, exams as tickets counting down, and every subject's marks at a glance. Add your classes and exams to Google Calendar, Apple Calendar or Outlook with one .ics file, built on your device.
• Open the 1.0 tab for a receipt of your semester, every class day by day, a time capsule, Semester Wrapped on the last day of classes, and Proxy Run, a small game for when CUIMS makes you wait.
• Choose from twenty-two colour themes that restyle the popup, the LMS view, CUIMS itself and the toolbar icon. Two of them, Founding 100 and Black Card, are for everyone who used CUIMS Clear before 1.0.

Optional saved UID/password, attendance figures and extension preferences are stored locally on your device. Saved credentials are not encrypted by the extension and are not synchronized through Chrome Sync. CAPTCHA images are processed on-device, with no external OCR service. CUIMS Clear includes no analytics or advertising. Your credentials are submitted only to the university's CUIMS login service when you sign in.

Use Clear login in the popup to remove your saved UID/password and attendance. Uninstalling CUIMS Clear removes its local storage.

What changed in 1.0
CUIMS Clear is out of beta, with 100 students on the Chrome Web Store. A new 1.0 tab (receipt, day-by-day attendance, time capsule, Semester Wrapped, Proxy Run); redesigned My Time Table, Datesheet and Marks View on CUIMS with Add to calendar; two founders' themes. Pending duty leave shows again after CUIMS moved its history to the External tab; a lone exam set outside its test week no longer cancels that week's classes in the Forecast; absent marks now count in subject totals.

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
students.cuchd.in: assist with the login form by filling optionally saved credentials or using credentials entered by the student, process its CAPTCHA locally, apply the student's optional quiet-mode settings and theme, redraw the student's own timetable, date sheet and marks pages in a clearer layout (and build an .ics calendar file from them on the device when asked), launch the university's own LMS SSO control, and read the student's own attendance report, timetable, date sheet, and duty and medical leave applications for the Attendance and Forecast tabs.
lms.cuchd.in: display a cleaner course directory and course navigation, including fetching same-origin course directory pages to pair syllabus materials with semester work.

### Remote code
No remote code is executed. The CAPTCHA solver (captcha-solver.js) and its glyph table (captcha-glyphs.js) are plain, unminified JavaScript in the uploaded ZIP. Same-origin LMS fetches retrieve course page content, not executable code.

## Reviewer instructions
Inspect the popup without an account: the Login tab (saved UID/password fields, Clear login), the Settings tab (automation, quiet-mode and LMS switches), the Theme tab, and the 1.0 tab (a receipt of what the extension did, Proxy Run, a time capsule; everything there stays on the device and makes no network request; Proxy Run is a small game offered while the student waits for CUIMS). Calendar files are generated locally and handed to the browser's download. Full testing requires a university-issued student account; none is bundled. With an authorized account, save a login or enter it on CUIMS, fetch attendance from the Attendance tab, then open LMS via university SSO. CAPTCHA solving runs locally; no remote code.

## URLs
Homepage: https://github.com/Arshgill01/cuims-clear
Support: https://github.com/Arshgill01/cuims-clear/issues
Privacy policy: https://github.com/Arshgill01/cuims-clear/blob/main/outputs/cuims-clear-chrome/PRIVACY.md

## Submission status
1.0.0 (out of beta: 1.0 tab, redesigned CUIMS pages with calendar export, founders' themes, duty leave history after CUIMS's redesign) is being prepared for review. No new permissions since 0.10.6. Distribution remains free, public, all regions. No personal university credentials are shared.
