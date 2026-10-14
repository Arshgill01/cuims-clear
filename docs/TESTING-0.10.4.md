# 0.10.4: attendance reads freely, CUIMS pages stay rare, Open CUIMS never refuses

0.10.4 is 0.10.3, plus Codex's empty-menu work (docs/CUIMS-RATE-INVESTIGATION.md),
plus the request design below. Neither store was published by the agent.

## What the student saw

Right after updating to 0.10.3, a couple of Refresh presses, then CUIMS's
sidebar went empty and the profile page said the session had no access. It
cleared on its own after 5–10 minutes. Codex's patch also made Open CUIMS
refuse to open during a pause.

## What live CUIMS does (Codex's traces, work/e2e/rate-*-live.json)

- The refusal is usually HTTP 200 with an empty `#menu-content` (3 links
  instead of 85), not a redirect to error.html. 0.10.3 and every earlier build
  took that for success: an empty leave list replaced the saved one, the
  timetable sent its postback, and Home "proved" the session alive.
- Three pages ~1.5 s apart: the third was refused, 3 times out of 3, with the
  attendance page alone too. 36 pages ~5.6 s apart were all served.
- 30 GetReport calls at one a second, five of them during a refusal: all
  answered. The report calls carry no cookie and never touch the session.
- A refusal lifted after 5–10 min, but the account was still refused 34 min
  after the third deliberate trip, so repeats may lengthen it.
- Not settled: a burst rule versus a slow allowance (the first refusal was
  the 30th page in 13 min); whether Home and the landing step count.

## The design

Two kinds of request, kept apart (attendance-daemon.js):

- Report calls (GetReport, GetFullReport): attendance, today's marks, the
  Forecast's history. Their own local budget (60 per 10 min). Never held back
  by a page refusal. Opening the popup reads when the last read is over two
  minutes old (was ten); Refresh comes back after 30 s (was 60). A network
  failure no longer starts a backoff.
- Session requests (pages and sign-in): their own budget (10 per 10 min).
  Every page waits six seconds after the last page, the background's or a
  CUIMS tab's. An optional page (timetable, leave) waits five minutes clear of
  any page, at most one per read, and gives way to a CUIMS tab in use or an
  LMS open that is waiting.

What loads which page:

| Page | 0.10.3 | 0.10.4 |
| --- | --- | --- |
| Attendance page | when the report ids are missing or stop working | same |
| Timetable | daily, retried hourly | once; kept 7 days; again when the report session (semester) changes; free whenever the student opens My Time Table |
| Duty leave | every 3 h | once, then daily, or every 3 h while one is pending; free whenever the student opens the page |
| Medical leave | every 3 h, separately | same as duty leave |
| Home check | before Open CUIMS, and after an ambiguous redirect | never |

An approval needs no page: it moves the attendance counts, and the pending
recount (countPending) runs on every read from the report calls. Only a
refusal, or an application made elsewhere, waits for the leave page.

Refusals: an empty menu or error.html on any page holds every background page
and sign-in for 15 min (30, 60 when it repeats within two hours). A CUIMS tab
that later loads a page with its menu ends the hold early (`tabMenuOkAt`,
content.js). No Home probe is sent to find out why a page redirected: the
session is marked signed out and optional pages wait until a tab shows the
menu again.

Opening:

- Open CUIMS makes no request and never refuses: a tab on StudentHome in the
  browser's own session, the same as typing the address. Signed out, CUIMS's
  login page shows and the content script signs in.
- Open LMS is the same: a tab that loads CUIMS behind a cover, where
  lms-launch.js clicks CU LMS, as the student would. It never refuses. Earlier
  builds first made the LMS postback from the background, but live CUIMS now
  adds the CU LMS link to StudentHome after the page loads: the background's
  copy of Home never has it (seen live below), so every Open LMS cost a wasted
  Home load right before the tab's own Home and postback, three pages in
  about three seconds.

Also:

- Fresh totals are saved before any optional page, so a slow or refused page
  never hides them (a 429 on a later call used to throw them away).
- The first read loads the first timetable six seconds after the attendance
  page, in the same read, so the Forecast is ready at once and no longer needs
  a live session later (it used to wait for a follow-up read, and stayed on
  "Waiting for your timetable" when the session had ended by then).
- A different saved UID drops the last student's report ids, snapshot,
  timetable, leave and history (0.10.3 kept reading the old student's ids).
- The leave card shows "checked N ago" again (a number was parsed as a date).
- The waiting-for-timetable chart draws the goal actually in use (90%
  overall), not 75%.
- Settings → Troubleshooting → Copy: the local request log (the last 150
  requests and CUIMS tab pages: path, status, result, time) and the page
  clocks, for a report. No UID, password, ids, query strings or attendance.

## Evidence

Offline replay, same fake CUIMS, 8 subjects (scratchpad replay2.mjs):

| | page loads on a class day (popup every 12 min, 9:30–3:30) |
| --- | --- |
| 0.9.0 / 0.9.5 | 3 |
| 0.10.3 | 5 |
| 0.10.4 | 2 (the daily duty and medical leave reads) |

Updating from 0.10.3: the first read loads at most one page (a leave page
read more than a day ago), never a burst.

Tests: `npm test` — 319 tests, 317 passed, 2 skipped (the two real-browser
tidy tests need CHROME_BIN/FIREFOX_BIN), 0 failed. UI harness
(`work/e2e/forecast-glitches.mjs`): 0 failures in Chrome and Firefox.

Live, 10 Oct 2026 13:50–13:58 IST, Chrome, a disposable profile with the test
login (`work/e2e/live-0104.mjs`; the extension's own request log):

| Step | What CUIMS saw | Result |
| --- | --- | --- |
| First read (popup opened) | attendance page (signed out) → login (UID, captcha, password) → landing step 6 s later → attendance page 6 s later → GetReport → timetable 6 s later → 4 history calls | 10 subjects, 36 timetable slots, every menu served |
| Refresh 35 s later | GetReport + 4 history calls, no page | fresh totals |
| Open CUIMS | nothing from the extension; the tab's StudentHome | same session: 109 menu links, no login form |
| Tab: My Time Table (10 s on) | the tab's page only | timetable handed over, 36 slots, no extension request |
| Tab: Duty Leave (10 s on) | the tab's page only | 58 applications handed over, no extension request |
| Read 5 min after the tab's last page | GetReport + medical leave page | medical leave read, menu served |
| Open LMS (the build then still tried the background postback) | background Home (no CU LMS link in it), the tab's Home 1 s later, its postback | LMS reached through the tab; the wasted background Home is why that path is gone |

No refusal at any step. The first live run (13:40) stopped after its first
read because of a wrong button selector in the script; that read matched the
one above.
