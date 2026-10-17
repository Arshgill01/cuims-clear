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

CAPTCHA images and text are processed locally by the extension's own
JavaScript. Images are not uploaded.
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

When you open the Attendance or Forecast tab and the last read is more than two minutes
old, or when you press Refresh, the extension reads your own attendance report,
class-by-class attendance record, timetable, date sheet, and duty and medical leave
applications from CUIMS with your browser's CUIMS session, signing in with your saved UID
and password in the background when needed. Nothing runs on a timer in the background.
Attendance figures, the class record, the timetable (with rooms and teachers) and the date
sheet are stored only in chrome.storage.local on this device and are removed by Clear
login. The Forecast tab's projections are calculated on the device from them.

## CUIMS pages and calendar files

On My Time Table, Datesheet and Marks View, the extension redraws the page's own data in a
clearer layout, on the page itself. Add to calendar, on those pages or on the 1.0 tab,
builds an .ics calendar file on your device from what the page or the saved attendance
shows, and hands it to the browser's own download. The file is not sent anywhere; adding
it to a calendar app is up to you.

Access is limited to https://students.cuchd.in/* and https://lms.cuchd.in/*.
The extension does not maintain a browsing-history record.

## The 1.0 page

From version 1.0 the extension keeps a few counts in storage.local for the receipt on
its 1.0 tab: how many captchas it read (with the last 24 four-character codes, which
are already used up and cannot sign anyone in), how many logins it pressed, how many
event and feedback dialogs it hid, and how many attendance reads it made. It also keeps
whether you used it before 1.0 (the Founding 100 stamp, decided by the browser's own
install event), your best Proxy Run score, and, if you write one, your time-capsule note.
Semester Wrapped and the day-by-day attendance grid on the 1.0 tab are worked out on the
device from the attendance it already stores. Founders also get a Founding 100 theme.
None of this is sent anywhere. Saving or copying the receipt or a Wrapped card makes an
image on your device; sharing it is up to you. Uninstalling the extension removes all of it.

## Updates

To tell you when a newer version is out, the extension uses Chrome's own update check
(chrome.runtime.requestUpdateCheck), at most every six hours, when the popup opens or a
CUIMS page loads, and when you press Check now or Update. Chrome asks the Chrome Web Store
itself; the extension sends nothing anywhere. Update installs the version Chrome has
downloaded and restarts the extension.

## Limited use

Data is used only to provide the portal features described above, in accordance
with the Chrome Web Store User Data Policy, including its Limited Use
requirements. It is not used for advertising, unrelated purposes, creditworthiness,
or lending. The developer does not have access to your portal data.

Contact: arshgill6120@gmail.com

Last updated: 17 October 2026.
