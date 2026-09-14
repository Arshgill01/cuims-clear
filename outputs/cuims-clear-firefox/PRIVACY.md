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

When the student asks to open the LMS, the extension clicks the university's own CUIMS
CU LMS control and follows the LMS URL that page opens. That URL is not saved. On
`lms.cuchd.in`, the courses directory may fetch additional same-origin
`/my/courses.php` pages so syllabus materials and semester work can be paired. No SSO
tokens are written to extension storage.

The user can delete the stored UID and password at any time with **Clear login** in the
extension popup, or remove all stored settings by uninstalling the extension.

The extension has access only to pages under `https://students.cuchd.in/*` and
`https://lms.cuchd.in/*`.

Firefox extension storage is not encrypted. Anyone with access to the user's Firefox
profile may be able to read locally stored values.

Last updated: 9 September 2026.
