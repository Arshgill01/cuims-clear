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
  when you open the popup and the last read is over two minutes old, and whenever you press
  Refresh: a read brings attendance and the class record, and at most one slower CUIMS page
  (the timetable once a day, leave every few hours), spaced well apart;
- forecasts the semester on a **Forecast** tab: where each subject and the overall figure
  finish by the last day of classes at your recent pace, the likely range and the chance of
  clearing the goal, how many classes are left to miss, a planner that shows what skipping a
  class today or later in the week does, and which weekdays you miss most;
- offers twenty-two colour themes (two reserved for pre-1.0 users) (CUIMS Clear plus Tokyo Night, Catppuccin, Gruvbox, Everforest,
  Kanagawa, Nord, Osaka Jade, Retro-82, Matte Black, Solitude, Ristretto, Ethereal, Lumon,
  Hackerman, Last Horizon, Miasma, Catppuccin Latte, Flexoki Light and Rosé Pine, from Omarchy)
  that restyle the popup, the LMS clear view, CUIMS itself, and the toolbar icon together, with
  a switch to leave CUIMS pages untouched;
- tidies CUIMS's own pages: shows them as soon as they are ready instead of a second later, the
  time table in time order with today and the class in progress marked, upcoming exams with a
  countdown on the datesheet, each subject's attendance read against your goal, coloured
  class-by-class marks, Marks View weighted the way CU counts internal marks, and the current
  page marked in the sidebar (Settings → CUIMS pages → Tidier pages);
- shows your marks on a **Marks** tab in the popup, with the same weighting, and lets you say
  whether Aptitude and Soft Skills count towards your result;
- takes CUIMS's Duty Leave page straight to its External tab and fills its form from the
  classes you were marked absent in; you add the reason and proof, then Save;
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

## New in 1.0

The **1.0** tab includes a semester receipt, day-by-day attendance, Semester Wrapped,
a time capsule and Proxy Run. Existing users receive the Founding 100 stamp and the
Founding 100 and Black Card themes. Timetable, Datesheet and Marks View have new layouts;
classes and exams can be exported as local .ics calendar files. No new permissions.

## Marks and duty leave

CUIMS lists each assessment at the marks it was conducted for (a surprise test out of 12,
each MST out of 20, each experiment out of 30), but CU gives each kind of assessment a
fixed share of the internal marks and splits it between repeats. Adding the raw rows, as
earlier versions did, over-weights MSTs, surprise tests and experiments. Marks View on
CUIMS and the **Marks** tab now weigh each kind by its CU share (`marks-model.js`); a theory
course comes out exactly as CU's internal 40 (assignment 10, surprise test 4, quiz 4, MSTs
20, attendance 2). The headline is the average of the subjects that count, each counted
equally; the raw total of every listed mark is shown beside it. ABSENT counts as zero.
Aptitude and Soft Skills (TDT/TDP courses) are graded in some programmes and not in others,
so one switch, shared by the page and the popup, decides whether they count. Courses with
only attendance marked, and graded courses, are shown but left out of the average.

The Marks tab reads Marks View only when asked (Refresh marks, or opening the tab with
nothing read in 12 hours), as one paced page; opening Marks View on CUIMS updates it for free.

CUIMS's Duty Leave page opens on Internal (events); CUIMS Clear takes it straight to
External unless you pick Internal in that tab. A **File duty leave** card lists the days
CUIMS still accepts (today and the three before), with the classes you were marked absent
in already ticked, and **Fill CUIMS's form** walks CUIMS's own form in the order it
requires: type, category, date, lectures, count, Next Step. The reason, the declaration,
the proof and Save stay with you; nothing is submitted for you.

## Conservative CUIMS reads

Opening Attendance or Forecast reads again when saved data is over two minutes old;
Refresh reads on demand, with a minimum 30-second gap. No periodic background polling.
Attendance report calls and session/page requests have separate local limits (60 report
calls and 10 session requests per ten minutes). These are extension safeguards, not
CUIMS's published quotas.

Optional timetable, date-sheet and leave pages are spaced and cached. A leave read never
signs in. Opening a supported CUIMS page supplies its data without a background fetch.
Duty Leave history is read from CUIMS's External tab when it is missing on Internal.

When CUIMS refuses page loads, optional pages pause while cached attendance remains
visible and report calls can continue. HTTP 429/503 honors Retry-After. The popup's
countdown makes no requests. See PRIVACY.md for the data stored and used.

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
