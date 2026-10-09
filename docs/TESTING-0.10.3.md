# 0.10.3: CUIMS's page limit is no longer taken for a sign-out

0.10.3 is 0.10.2 plus the fixes below. Neither store was published by the agent.

## What the student saw (0.9.7)

The popup said: "CUIMS accepted the login but did not keep the session. Try
again. Showing your last read. Next try in 1 min." Refresh was disabled and
CUIMS's sidebar was empty.

## Why

When CUIMS limits an account's page loads, it redirects inner pages to
`error.html`. The timetable and leave pages are read without following
redirects, so they never load a login page. A browser then only reports "a
redirect", with no destination, so the limit looked exactly like being
signed out. 0.9.7 responded to a "signed-out" duty leave page by signing in
in the background (UID, captcha, password, landing). It then read the page
again, met the same redirect and gave the message above. That threw away the
attendance it had just read and added a sign-in to an account CUIMS was
already limiting. 0.10.2 no longer signs in for leave, but it still recorded
the session as signed out and did not hold back.

## The fix

- When an optional page redirects, StudentHome (outside the limit) is checked
  before the redirect is taken for a sign-out. If the session is still alive
  there, the page was limited (`page-limit`). An error page after any inner
  page is `page-limit` too.
- A page limit holds only page loads and sign-ins: for 15 minutes, then 30,
  then 60 if it happens again soon after. A page that loads ends the streak.
  The report calls are outside the limit, so Refresh still brings fresh
  attendance during the pause, and Open CUIMS and Open LMS still work.
  Signed out during the pause, Open CUIMS opens the tab without a background
  sign-in.
- A CUIMS tab that lands on `error.html` stamps `tabLimitedAt` (content.js),
  which holds the background's pages for 15 minutes.
- When the optional timetable or leave page is limited, the Refresh still
  succeeds with the report calls' fresh data, with no error. The leave page
  is retried after the pause, not three hours later.
- Opening the popup reads CUIMS by itself again, once per popup, when the
  last read is over ten minutes old, as 0.9.5 and earlier did. 0.10.0 had
  made reads Refresh-only. A normal read is the report calls alone.

## Evidence

A fake CUIMS that limits inner pages the way a browser sees it (an opaque
redirect when redirects are not followed). The session is alive, duty leave
is due, and the student presses Refresh:

| Build | Shown | CUIMS requests |
| --- | --- | --- |
| 0.9.7 | "CUIMS accepted the login but did not keep the session…", old attendance | report calls, duty leave, a full sign-in, duty leave again (2 limited pages) |
| 0.10.2 | fresh attendance, no error, but the session recorded as signed out | report calls, duty leave (1 limited page) |
| 0.10.3 | fresh attendance, no error, pages held 15 min | report calls, duty leave, StudentHome (1 limited page) |

The six new or rewritten throttle tests fail on 0.10.2's code and pass on
0.10.3.

Also run, all passing: `npm test` (310), `node work/e2e/conservative-smoke.mjs`,
`node work/e2e/ux-browsers.mjs` and `node work/e2e/forecast-glitches.mjs` in
Firefox and Chrome. The glitch harness now checks that opening a popup whose
last read is 16 hours old reads exactly once across every tab switch, and
that a fresh read is not read again. No live CUIMS requests were made for
this build.

## Check by hand

Make one live read only. Wait until any current CUIMS limit has passed (15+
minutes without touching CUIMS).

1. Remove 0.9.7 and load `outputs/dist/cuims-clear-firefox-0.10.3.zip`
   (Chrome likewise).
2. Open the popup. With a read over ten minutes old it refreshes by itself.
3. Press Open CUIMS: the sidebar loads.
