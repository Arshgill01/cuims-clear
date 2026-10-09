# CUIMS Clear for Firefox

A Firefox Manifest V3 extension for `https://students.cuchd.in/` and
`https://lms.cuchd.in/` that:

- fills your student UID and optionally presses **Next**;
- fills your CUIMS password from local Firefox extension storage;
- reads the login CAPTCHA on-device by matching it against the fixed font CUIMS
  draws it in, fills the answer, and presses Login for you: up to three tries,
  then Login is left to you;
- enlarges the CAPTCHA image and focuses the field whenever automatic solving
  is off, unsure, or has used up its retry budget;
- suppresses blocking event and feedback overlays while leaving other dialogs alone;
- skips the full-page `LandingPage.aspx` promotion and opens `StudentHome.aspx` directly;
- opens CUIMS or the LMS from the popup, signing in from the background first when the
  session has ended, and reaching LMS through the university's own CU LMS control
  without showing CUIMS;
- shows each LMS subject once, with separate Syllabus & Materials and Semester Work links;
- leaves native course activities, submissions, notifications, and account controls in place,
  with an **Original view** escape on LMS pages;
- shows attendance on an **Attendance** tab without opening CUIMS: overall and
  per-subject percentages, how many classes you can skip while staying at 75% per
  subject and 90% overall, and today's classes as they happen. It reads CUIMS by itself
  when you open the popup and the last read is over ten minutes old, and whenever you press
  Refresh: a read brings attendance and the class record, and at most one slower CUIMS page
  (the timetable once a day, leave every few hours), spaced well apart;
- forecasts the semester on a **Forecast** tab: where each subject and the overall figure
  finish by the last day of classes at your recent pace, the likely range and the chance of
  clearing the goal, how many classes are left to miss, a planner that shows what skipping a
  class today or later in the week does, and which weekdays you miss most;
- offers twenty colour themes (CUIMS Clear plus Tokyo Night, Catppuccin, Gruvbox, Everforest,
  Kanagawa, Nord, Osaka Jade, Retro-82, Matte Black, Solitude, Ristretto, Ethereal, Lumon,
  Hackerman, Last Horizon, Miasma, Catppuccin Latte, Flexoki Light and Rosé Pine, from Omarchy)
  that restyle the popup, the LMS clear view, CUIMS itself, and the toolbar icon together, with
  a switch to leave CUIMS pages untouched;
- tidies CUIMS's own pages: shows them as soon as they are ready instead of a second later, the
  time table in time order with today and the class in progress marked, upcoming exams with a
  countdown on the datesheet, each subject's attendance read against your goal, coloured
  class-by-class marks, running totals on the marks page, and the current page marked in the
  sidebar (Settings → CUIMS pages → Tidier pages);
- keeps every automation and quiet-mode switch on one **Settings** tab, where each switch
  saves as you flip it;
- lets you erase the saved UID, password, and attendance from the popup at any time.

CAPTCHA solving happens entirely inside the extension, in plain JavaScript
(`captcha-solver.js`, with the font's glyphs in `captcha-glyphs.js`): CUIMS
draws every captcha as four Courier New Bold characters on a fixed grid, so the
solver matches each character cell against the 62 possible glyphs instead of
running a general OCR engine. It reads all 530 real CUIMS captchas in the test
corpus exactly. No data is sent to any server. Automatic attempts stop after
three, well under CUIMS's lockout, and a background sign-in stands down after a
single refusal so it never uses the login tab's tries.

CUIMS Clear is an independent student-built project. It is not affiliated with or endorsed
by Chandigarh University.

Requires Firefox 142 or newer.

## Install the development build

This build is unsigned, so normal Firefox keeps it only until the browser restarts.

1. Download `cuims-clear-firefox.zip`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Select the downloaded ZIP, or select `manifest.json` inside the unpacked `cuims-clear-firefox` folder.
5. Open the CUIMS Clear toolbar popup and go to **Login**.
6. Enter the UID and password, then select **Save login**.

## Install permanently

Standard Firefox requires a Mozilla-signed XPI. Once `cuims-clear-firefox.xpi` has been
signed:

1. Open **Add-ons and themes** in Firefox.
2. Open the settings cog and select **Install Add-on From File**.
3. Choose the signed XPI and approve the requested access.

Mozilla signing can be requested without creating a public AMO listing:

```sh
web-ext sign \
  --source-dir outputs/cuims-clear-firefox \
  --channel unlisted \
  --api-key "$WEB_EXT_API_KEY" \
  --api-secret "$WEB_EXT_API_SECRET"
```

Do not put Mozilla API credentials in the repository or send them in chat. The unsigned ZIP
is useful for review and temporary loading, but cannot remain installed in normal Firefox
after restart.

## Popup matching

The blocker only acts on dialog-style elements whose text looks like an event or feedback request. Turn either category off under **Settings** in the toolbar popup if CUIMS changes its markup or a legitimate dialog is matched.

Because the logged-in CUIMS dashboard was not available during development, the blocker uses conservative Bootstrap, jQuery UI, and SweetAlert modal selectors. If a CUIMS popup survives, inspect it or share a screenshot/HTML sample so its exact selector can be added.

## Conservative CUIMS reads

CUIMS throttles an account for 10+ minutes after a few of its inner pages
(attendance, timetable, duty and medical leave) load close together; the
attendance report calls and StudentHome do not count. So a Refresh is
normally the report calls alone, and loads at most one inner page: the
attendance page only when its report ids are missing, otherwise the timetable
once a day or a leave page every three hours, and only when neither the
extension nor a CUIMS tab has loaded an inner page in the last five minutes.
A leave read never signs in. A duty-leave approval still shows on the next
Refresh, from the report calls (the subject's counts move and the absent mark
becomes a leave mark); a refusal shows when the leave page is next read.
Opening a leave page on CUIMS updates the list for free.

When CUIMS limits the account's page loads anyway (its pages redirect to
`error.html`, and CUIMS's own sidebar comes up empty), the extension loads no
CUIMS page and never signs in for 15 minutes (30, then 60, if it happens
again soon after). Attendance keeps updating from the report calls, which the
limit does not touch, and Open CUIMS and Open LMS still work. A CUIMS tab that
lands on the error page counts too. A redirected page is never taken for a
signed-out session until StudentHome confirms it, so the limit never sets off
a sign-in.

Background attendance, session checks and LMS SSO also share a rolling budget
of 25 requests per 10 minutes, and manual refreshes wait at least 60 seconds.
These are extension safeguards, not CUIMS's published limits; portal tabs and
browser-followed redirects add their own traffic.

HTTP 429/503, or an error page from the report calls or StudentHome, pauses
background reads for at least five minutes, increasing after repeated failures and honoring a longer
`Retry-After`. Optional attendance detail also stops on a refusal. Cached
attendance stays visible, with a disabled refresh button showing when it is
ready again. The countdown sends no requests.

## Privacy

- Host access is limited to `https://students.cuchd.in/*` and `https://lms.cuchd.in/*`.
- UID and password are saved in Firefox `storage.local` on this device.
- CAPTCHA images are processed on-device by the extension's own code. No
  information is collected or transmitted.
- The LMS launcher uses the university's own CU LMS control and follows where
  CUIMS sends it. It does not store SSO links or tokens. Extra LMS course-list pages are
  fetched same-origin only to pair syllabus and semester-work entries.
- Firefox extension storage is not encrypted. Anyone with access to your Firefox profile may be able to read the saved values.
- Use **Clear login** in the popup to remove the saved UID and password.

See [PRIVACY.md](PRIVACY.md) for the complete privacy statement.

## Bundled third-party code

None. Since 0.8.6 the package contains only its own unminified source.
`captcha-glyphs.js` is generated by `scripts/build-captcha-glyphs.py`.
