# CUIMS Clear Privacy

CUIMS Clear processes portal data on your device to help you sign in to CUIMS,
reduce interruptions, and navigate LMS courses. The developer does not receive,
sell, or share your personal data. There is no developer-operated server,
analytics, advertising, or remote executable code.

## Login and preferences

CUIMS Clear does not save your UID or password. Use Chrome's password manager
or enter your credentials directly on the university's HTTPS login page. The
extension checks the login fields to advance or submit the form when your
chosen automation settings allow it. Credentials are submitted to the
university's CUIMS service as part of that login, not to the developer.
Credentials saved by older Chrome builds are removed on installation or update.
Chrome's own saved passwords are managed separately in Chrome's password manager.

Only extension preferences are stored in chrome.storage.local. These include
login automation, quiet-mode, and LMS-view settings. Uninstalling the extension
removes these preferences. Temporary login-attempt counters are kept in the
portal tab's session storage; they do not contain credentials.

## On-device page processing

CAPTCHA images and text are processed locally with the bundled Tesseract.js
engine, WebAssembly core, and English language model. Images are not uploaded.
The extension reads page text and structure to hide optional event and feedback
overlays and to organize LMS course names and links. This content is not sent
to the developer or saved in extension storage.

When you select Open LMS, the extension locates an existing CUIMS or LMS tab
and uses the university's CU LMS control to follow its SSO flow. SSO URLs and
tokens are not saved in extension storage. The LMS course directory may fetch
additional same-origin /my/courses.php pages using your existing university
session to pair syllabus materials with semester work.

Access is limited to https://students.cuchd.in/* and https://lms.cuchd.in/*.
The extension does not maintain a browsing-history record.

## Limited use

Data is used only to provide the portal features described above, in accordance
with the Chrome Web Store User Data Policy, including its Limited Use
requirements. It is not used for advertising, unrelated purposes, creditworthiness,
or lending. The developer does not have access to your portal data.

Contact: arshgill6120@gmail.com

Last updated: 21 September 2026.
