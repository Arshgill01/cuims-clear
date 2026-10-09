# 0.9.7: everything together

0.9.7 is 0.9.6 (0.9.5 plus the Forecast tab, see `TESTING-0.9.6.md`) with the
conservative CUIMS request pass merged in (`CONSERVATIVE-REQUESTS-REPORT.md`).
That pass had only existed as uncommitted work on top of 0.9.1, so neither
0.9.5 (in both stores) nor 0.9.6 carried it. Neither store was published by
the agent.

## What is in it

- Everything in 0.9.5: the rail popup, Settings, twenty themes, quiet mode,
  the tidy CUIMS pages (timetable, exams, marks), LMS clear view, the store
  rating ask, the 0.8.6 captcha solver and three-try login.
- The Forecast tab (0.9.6): semester projection, skip planner, by-subject
  budgets and charts, habits. The today planner is off the Attendance tab.
- Conservative requests:
  - one rolling budget of 25 background requests per 10 minutes (was 40)
    shared by attendance, session checks, leave and LMS sign-in;
  - Refresh waits 60 s (was 30 s); the button counts down on both the
    Attendance and Forecast tabs and comes back without a request;
  - HTTP 429/503 or CUIMS's error page stops the read at once, keeps the
    last attendance on screen, and pauses everything (LMS included) for at
    least five minutes, longer on repeats or when CUIMS sends Retry-After;
  - duty leave is read on every refresh, without opening a portal tab, so
    an approval shows up on the next read; medical leave waits its turn.
- The Forecast tab's class record lives inside that budget. It is optional:
  at most four subjects a refresh, and only while twelve of the 25 requests
  are still free, so it never crowds out a refresh, a sign-in or Open
  CUIMS/LMS. If our own budget runs out it waits for the next refresh; if
  CUIMS pushes back it stops the read like any other request. A refresh with
  nothing new makes no marks calls.

## Validation (offline; no live CUIMS requests for this build)

```sh
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' npm test   # 298 pass, 0 skipped
node work/e2e/conservative-smoke.mjs
node work/e2e/forecast-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/forecast-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/rating-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/rating-firefox.mjs outputs/cuims-clear-firefox
sh scripts/package.sh
```

## Manual pass before the stores

1. Load `outputs/dist/cuims-clear-*-0.9.7.zip` unpacked; open the popup once
   per browser and let the first read finish before opening CUIMS.
2. Refresh: the button reads "Refresh in 1 min" afterwards, on Attendance and
   Forecast alike, and comes back by itself.
3. Duty leave: a pending application shows on Attendance after a refresh.
4. Forecast: the walkthrough in `TESTING-0.9.6.md`.
