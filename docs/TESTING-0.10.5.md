# 0.10.5: CU's calendar, the date sheet, leave that keeps itself current

0.10.5 is 0.10.4 plus the fixes below, found from one student's popup and
request log on 13 Oct 2026 (a Tuesday in IST-2, the mid-semester tests).

## What the student saw

At 9:23 pm the Overall card said 91.7% (310/338) and, in red, "Attend next 5
classes to reach 90%". It was not there in the morning. The leave card said
"checked 2 days ago". Opening CUIMS from the popup sometimes went straight to
StudentHome and sometimes signed in again with a captcha.

## Causes, from the student's own stored data

| Symptom | Cause | Since |
| --- | --- | --- |
| "Attend next 5" under 91.7% | Every class on today's timetable that had ended without a posted mark counted as an absence: 7 of them, 310/345 = 89.9%. CUIMS had posted nothing since 9 Oct, and the 7 classes never ran (IST-2). | 0.7.1 |
| It "appeared out of nowhere" | The count grew as each class's end time passed. | 0.7.1 |
| Forecast: too many classes left | Every weekday to the last day counted, holidays, test weeks and the Diwali break included. | 0.9.6 |
| Duty leave not refreshing | Leave pages ran only five minutes after any CUIMS tab page, by when the session (about 2–3 h idle) had usually ended; the page redirected and the read gave up. Every read since 10 Oct did that. | 0.10.x |
| Open CUIMS sometimes signs in | Attendance reads are cookie-less, so nothing kept a session: Open CUIMS found whatever the browser had. | always |
| Report ids across semesters | Saved ids could keep answering with last semester's attendance. | 0.7 |

## What changed

- **Attendance figures are CUIMS's own.** A class that ended without a mark
  shows its "…" chip ("not marked yet") and changes no number.
- **CU's academic calendar** (academic-calendar.js), copied from
  cuchd.in/academics (academic-calendar.php, -odd.php, -uic.php,
  list-of-holidays.php): gazetted holidays, theory IST weeks, the Diwali
  break, each semester's last teaching day, for most programs, UIC and UID.
  Practical IST and VAC weeks are teaching weeks (classes ran in 2026).
  Settings → Attendance → Academic calendar picks one; Automatic uses UIC's
  for a BCA/MCA UID.
  - Attendance: on a day without classes, no class chips, and "No classes
    today: IST-2 (mid-semester tests)" / "…: Dussehra".
  - Forecast: classes left are counted on teaching days only; the last day
    defaults to CU's ("CU calendar" tag), and stays CU's after it passes.
- **The date sheet** (frmStudentDatesheet.aspx, one GET for every MST type):
  a week with one of the student's papers is a test week, whatever the
  calendar says. Taken free when the student opens it; read in the
  background from ten days before a test week until it lists that test, at
  most daily (about six page loads a semester). A filtered type never drops
  the others.
- **Leave keeps itself current.** An optional page now follows its redirect,
  so CUIMS's refusal (error.html: pages pause, never a sign-in) and a
  sign-out (the login page) are told apart. Signed out, the read signs in
  once (only when allowed: saved login, captcha solving on, no refused login
  in 20 min, no CUIMS tab on its login page) and loads the page again. That
  also leaves the browser signed in, so Open CUIMS right after lands on
  StudentHome.
- **Sign-ins stay rare and whole.** The local ten-per-ten-minutes cap now
  counts pages only: a sign-in's login steps (/, Login.aspx, the captcha)
  used nine of the ten, so a later sign-in stopped after its first step
  (found live, below). A sign-in never starts without room for its landing
  step and the page it is for, so a session is never left half signed in
  (no menu rights: a tab would get error.html). At most three background
  sign-ins an hour; one for an optional page waits 30 min after the last
  good one.
- **Pages per read:** up to two optional pages, six seconds apart; one when
  the read already loaded the attendance page; a second never takes a read
  past three page loads.
- **Report ids** saved before the current semester began are read again from
  the attendance page, and once more a week in; if that page cannot be had,
  the saved ids keep answering.

## Not changed

Report calls, their budget, the six-second page gap, the five-minute
clearance from a CUIMS tab's pages, refusal pauses (15/30/60 min), and Open
CUIMS / Open LMS making no request of their own.

## Evidence

`npm test`: see the run below. New: tests/calendar.test.mjs (parser,
calendar, date sheet override, Attendance day off, Forecast, date sheet
cadence and merge, semester rollover, sign-in budget and limits), and
the leave tests rewritten for sign-in-on-sign-out.

Live, 13 Oct 2026 ~22:45 IST, Chrome, a disposable profile with the test
login (`work/e2e/live-0105.mjs`; the extension's own request log):

| Step | What CUIMS saw | Result |
| --- | --- | --- |
| First read | attendance page (signed out) → sign-in → landing 6 s later → attendance page 6 s later → GetReport → timetable 6 s later → history calls | 10 subjects, 36 slots, no refusal |
| Cookies cleared, Refresh five minutes after the last page | duty leave → login page → one sign-in → landing 6 s later → duty leave 6 s later | duty leave read; medical leave left for the next read (three-page ceiling) |
| Open CUIMS right after | nothing from the extension; the tab's StudentHome | same session: 110 menu links, no login form, 2.9 s |
| The tab goes to students.cuchd.in/ | CUIMS itself redirected / → Login.aspx → StudentHome | no new sign-in (a planned "/ → Home" shortcut was dropped: CUIMS does it for a live session) |

A first live run found the sign-in-budget bug above: the second sign-in
stopped after `GET /` (the local cap counted login steps). Fixed, with a
regression test, before the second run.
