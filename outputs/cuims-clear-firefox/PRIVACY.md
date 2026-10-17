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

When the student opens the Attendance or Forecast tab and the last read is more than two
minutes old, or presses Refresh, the extension signs in to `students.cuchd.in` with the
saved UID and password in the background, the same way the login page does, and reads the
student's own attendance report, class-by-class attendance record, timetable, date sheet,
and duty and medical leave applications (to show pending leave). It uses the browser's
existing CUIMS session when one is open. Nothing runs on a timer in the background. The
attendance figures, class record, timetable (with rooms and teachers) and date sheet are
stored only in local extension storage, and the Forecast tab's projections are worked out
on the device from them. Nothing is sent anywhere else.

On My Time Table, Datesheet and Marks View, the extension redraws the page's own data in a
clearer layout, on the page itself. Add to calendar, on those pages or on the 1.0 tab,
builds an .ics calendar file on the device from what the page or the saved attendance
shows, and hands it to Firefox's own download. The file is not sent anywhere.

To tell the student when a newer version is out, the extension asks
`addons.mozilla.org` for CUIMS Clear's current version number, at most every six hours,
when the popup opens or a CUIMS page loads. The request carries no cookies and nothing
about the student; it is the same public listing anyone can read. The answer is kept in
local extension storage. Updating still goes through Firefox and addons.mozilla.org.

The user can delete the stored UID, password, and attendance at any time with **Clear login** in the
extension popup, or remove all stored settings by uninstalling the extension.

The extension has access only to pages under `https://students.cuchd.in/*` and
`https://lms.cuchd.in/*`.

Firefox extension storage is not encrypted. Anyone with access to the user's Firefox
profile may be able to read locally stored values.

Last updated: 17 October 2026.

## The 1.0 page

From version 1.0 the extension keeps a few counts in storage.local for the receipt on
its 1.0 tab: how many captchas it read (with the last 24 four-character codes, which
are already used up and cannot sign anyone in), how many logins it pressed, how many
event and feedback dialogs it hid, and how many attendance reads it made. It also keeps
whether you used it before 1.0 (the Founding 100 stamp, decided by the browser's own
install event), your best Proxy Run score, and, if you write one, your time-capsule note.
Semester Wrapped and the day-by-day attendance grid on the 1.0 tab are worked out on the
device from the attendance it already stores. Founders also get two themes, Founding 100 and Black Card.
None of this is sent anywhere. Saving or copying the receipt or a Wrapped card makes an
image on your device; sharing it is up to you. Uninstalling the extension removes all of it.

