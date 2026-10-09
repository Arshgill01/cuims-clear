# 0.10.2: Refresh stops tripping CUIMS's throttle

0.10.2 is 0.10.1 with the request fix. Neither store was published by the agent.

## The bug (0.9.7, 0.10.0, 0.10.1)

On 0.9.7 the student was rate-limited almost every time: Refresh succeeded,
then Open CUIMS showed an empty sidebar and CUIMS's error page for 10+ minutes.

CUIMS throttles an account after a few inner pages (attendance, timetable,
duty and medical leave) load close together. The report calls (`GetReport`,
`GetFullReport`) and StudentHome do not count. 0.9.5 kept to one such page per
Refresh, with leave pages once every three hours. The 0.9.7 "conservative"
pass made the duty leave page part of every Refresh, even next to the
timetable (a GET plus its report postback). When that page found the session
expired, it signed in in the background (UID step, captcha, password,
landing) and loaded duty leave again. The 25-request budget counted mostly
the free report calls, so it never stopped the bunched inner pages.
Open CUIMS then added the tab's own pages.

## The fix

- A Refresh loads at most one inner page. The attendance page goes ahead only
  when the report ids are missing. The timetable (once a day) and a leave
  page (each every three hours) are optional. They wait until neither the
  extension nor a CUIMS tab has loaded an inner page for five minutes.
  `content.js` stamps `tabPageAt` on each inner page a tab loads, and the
  daemon keeps `attendancePageAt` for its own (a background sign-in's landing
  step counts too).
- A leave read never signs in. Signed out, it stops, and leave waits until a
  CUIMS tab, Open CUIMS or the attendance page shows the session alive. Only
  the attendance page, when it is needed, may sign in.
- Approvals still show on the next Refresh, without the leave page. Pending
  leave is recounted every Refresh from the class record the Forecast tab
  keeps. An approval turns that day's absent mark into a leave mark and moves
  the subject's counts, so only that subject is re-read, with the free marks
  call. A refusal ("Not Recommend") leaves the mark absent, so it shows when
  the duty leave page is next read (within three hours).
- An open leave page on CUIMS shares its list again when its text changes,
  e.g. after an application is submitted there. Theme repaints don't count as
  a change.
- Open CUIMS skips its StudentHome check for two minutes after a read or a
  CUIMS tab showed the session alive.

## Evidence

The same mocked CUIMS for both builds, a Refresh then Open CUIMS 20 s later.
On live CUIMS the timetable is two hits (GET + postback); the mock serves it
in one.

| Case | 0.9.7 Refresh | 0.10.2 Refresh |
| --- | --- | --- |
| Normal (session alive) | 5 requests, 1 inner page (duty leave) | 4 requests, 0 inner pages |
| First of the day | 6 requests, 2 inner pages (timetable, duty leave) | 5 requests, 1 inner page (timetable) |
| Session expired | 11 requests: duty leave, a full sign-in, duty leave again (3 inner) | 4 requests, 0 inner pages, no sign-in |

With the session expired, 0.10.2's Open CUIMS does the one sign-in the tab
needs (as 0.9.5 did); 0.9.7 had already signed in during the Refresh.

Also run, all passing: `npm test` (308), `node work/e2e/conservative-smoke.mjs`
(the approval clears with one duty leave page read in total) and
`node work/e2e/ux-browsers.mjs` in Firefox and Chrome (no errors). No live
CUIMS requests were made for this build.

## Check by hand

Make one live read only (see the live test budget). Wait until any current
CUIMS throttle has passed (15+ minutes without touching CUIMS).

1. Load `outputs/dist/cuims-clear-firefox-0.10.2.zip` (Chrome likewise).
2. Press Refresh once: attendance appears.
3. Press Open CUIMS: the sidebar loads.
4. With a pending duty leave, after it is approved: the next Refresh shows
   it gone from pending, while the Leave card's "checked" time does not move.
