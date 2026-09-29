# CUIMS Clear Privacy

CUIMS Clear does not collect, transmit, sell, or share user data.

The student UID, CUIMS password, and extension preferences are stored only in Firefox's
local extension storage in the user's current browser profile. They are used only to fill
the CUIMS login page and control the extension's on-page behavior, including the optional
LMS clear view.

CAPTCHA solving runs entirely on the user's device. The OCR engine (Tesseract.js), its
WebAssembly binary, and the English language model are bundled inside the extension
package. The CAPTCHA image is read and processed locally in the browser; it is never
uploaded. The extension includes no analytics, advertising, or remote code.

When the student asks to open CUIMS or the LMS, the extension first checks the browser's
CUIMS session and, if it has ended, signs in with the saved UID and password in the
background. For the LMS it then makes the university's own CU LMS request from the
background and opens the LMS URL CUIMS returns; if that is not possible it opens CUIMS and
clicks the CU LMS control there. That URL is not saved. On
`lms.cuchd.in`, the courses directory may fetch additional same-origin
`/my/courses.php` pages so syllabus materials and semester work can be paired. No SSO
tokens are written to extension storage.

When the student uses the Attendance tab, the extension signs in to `students.cuchd.in`
with the saved UID and password in the background, the same way the login page does, and
reads the student's own attendance report and timetable. It uses the browser's existing
CUIMS session when one is open. On weekdays during class hours it may send one light
request to keep that session open and one refresh after a class ends. The attendance
figures are stored only in local extension storage. Nothing is sent anywhere else.

The user can delete the stored UID, password, and attendance at any time with **Clear login** in the
extension popup, or remove all stored settings by uninstalling the extension.

The extension has access only to pages under `https://students.cuchd.in/*` and
`https://lms.cuchd.in/*`.

Firefox extension storage is not encrypted. Anyone with access to the user's Firefox
profile may be able to read locally stored values.

Last updated: 29 September 2026.
