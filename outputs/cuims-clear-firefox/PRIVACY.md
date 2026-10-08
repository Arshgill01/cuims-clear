# CUIMS Clear Privacy

CUIMS Clear does not collect, transmit, sell, or share user data.

The student UID, CUIMS password, and extension preferences are stored only in Firefox's
local extension storage in the user's current browser profile. They are used only to fill
the CUIMS login page and control the extension's on-page behavior, including the optional
LMS clear view.

CAPTCHA solving runs entirely on the user's device, in the extension's own JavaScript.
The CAPTCHA image is read and processed locally in the browser; it is never uploaded.
The extension includes no analytics, advertising, or remote code.

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
reads the student's own attendance report, timetable, and duty and medical leave applications (to show pending leave). It uses the browser's existing
CUIMS session when one is open. It talks to CUIMS only when the student uses the popup;
nothing runs in the background on a timer. The attendance figures are stored only in
local extension storage. Nothing is sent anywhere else.

The user can delete the stored UID, password, and attendance at any time with **Clear login** in the
extension popup, or remove all stored settings by uninstalling the extension.

The Marks tab reads the signed-in student's Regular Marks page on CUIMS using
the same session and guarded sign-in as attendance. Published assessment names,
maximum marks, obtained marks, and examination session labels are saved in local
extension storage for the saved UID and current examination session. Reopening
the popup does not fetch them again; pressing **Refresh** fetches current marks
again on demand. Previous sessions are not fetched. Viewstate and other postback tokens are not saved in
the marks cache. Changing the saved UID stops the old account's marks from being
shown; **Clear login** removes the marks cache as well.

The Timetable tab reads My Time Table through the same guarded session. Class
days, times, course titles and the published class details stay in local storage
for the saved UID. A successful result is fetched once and reused, including by
attendance. Changing UID hides the old cache; Clear login removes it. No
viewstate, cookies or sign-in tokens are included in the timetable cache.

The extension has access only to pages under `https://students.cuchd.in/*` and
`https://lms.cuchd.in/*`.

Firefox extension storage is not encrypted. Anyone with access to the user's Firefox
profile may be able to read locally stored values.

Last updated: 8 October 2026.
