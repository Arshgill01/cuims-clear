# CUIMS Clear Privacy

CUIMS Clear processes portal data on your device to help you sign in to CUIMS,
reduce interruptions, and navigate LMS courses. The developer does not receive,
sell, or share your personal data. There is no developer-operated server,
analytics, advertising, or remote executable code.

## Login and preferences

Saving a login in the extension popup stores your student UID and CUIMS password
in chrome.storage.local on this device. These values are not encrypted by the
extension and are not synchronized through Chrome Sync. Saving credentials is
optional. Use Clear login in the popup to remove the stored UID and password,
or uninstall the extension to remove its local storage.

The extension fills saved credentials into the university login form and can
advance or submit it according to your automation settings. Credentials are
submitted to the university's CUIMS service as part of login, not to the developer.
You can instead enter credentials directly on the portal without saving them.
Chrome's password manager is managed separately by Chrome.

Local storage also holds login automation, quiet-mode, and LMS-view preferences.
Temporary login-attempt counters are kept in the portal tab's session storage;
they do not contain credentials. Version 0.6.2 deleted previously saved extension
credentials; version 0.6.3 cannot recover those values and requires saving them again.

## On-device page processing

CAPTCHA images and text are processed locally with the bundled Tesseract.js
engine, WebAssembly core, and English language model. Images are not uploaded.
The extension reads page text and structure to hide optional event and feedback
overlays and to organize LMS course names and links. This content is not sent
to the developer or saved in extension storage.

When you select Open CUIMS or Open LMS, the extension checks your CUIMS session
and, if it has ended, signs in with your saved UID and password in the background.
For the LMS it makes the university's own CU LMS request and opens the LMS URL
CUIMS returns, or opens CUIMS and uses its CU LMS control. SSO URLs and tokens are
not saved in extension storage. The LMS course directory may fetch
additional same-origin /my/courses.php pages using your existing university
session to pair syllabus materials with semester work.

## Attendance

When you use the Attendance tab, the extension reads your own attendance report,
timetable, and duty and medical leave applications from CUIMS with your browser's CUIMS session, signing in with your
saved UID and password in the background when needed. It talks to CUIMS only when
you use the popup; nothing runs in the background on a timer. Attendance figures are
stored only in chrome.storage.local on this device and are removed by Clear login.

Access is limited to https://students.cuchd.in/* and https://lms.cuchd.in/*.
The extension does not maintain a browsing-history record.

## Limited use

Data is used only to provide the portal features described above, in accordance
with the Chrome Web Store User Data Policy, including its Limited Use
requirements. It is not used for advertising, unrelated purposes, creditworthiness,
or lending. The developer does not have access to your portal data.

Contact: arshgill6120@gmail.com

Last updated: 30 September 2026.
