# 0.10.0: reads on Refresh only, and the Forecast tab fixed

0.10.0 is 0.9.7 with every read of CUIMS tied to a Refresh press and the
Forecast tab's glitches fixed. Neither store was published by the agent.

## Refresh only

- Opening the popup, or switching to Attendance or Forecast, no longer reads
  CUIMS (0.9.x read whenever the last read was over 10 minutes old).
- One Refresh press reads attendance, duty leave, the timetable when due and
  the class record, inside the 25-request / 10-minute budget, at most one
  press a minute.
- Opening a leave page on CUIMS keeps what the page shows with no request of
  ours (0.9.x recounted pending leave with marks calls); the counts update on
  the next Refresh.
- Still talking to CUIMS without a Refresh press, because the student asked:
  Open CUIMS / Open LMS (the session check before opening), and a Refresh that
  gave way to a CUIMS tab signing in finishes once that tab lands (5 minutes).
- A read from an earlier day says so ("Last read 16 h ago · Refresh for
  today") and Refresh turns to the accent colour, on both tabs.

## Fixed

- The crosshair label left the chart at the edges and covered the big figure:
  it now sits beside the crosshair inside the chart, flipping sides at the
  right edge.
- Chart end and goal labels were clipped by 2–3 px ("89%" ran past the right
  edge). Value ticks moved to a left gutter, with the goal as its own bold
  tick; ticks keep 16 px apart.
- The tab jumped: every redraw (half-minute tick, background update, Refresh
  coming back after its wait) closed "How the forecast works" and could pull
  the view to the top by refocusing Refresh. Redraws now skip identical
  markup, keep open sections and the section being read in place, and focus
  never scrolls. This also fixes the Attendance tab.
- The last-day calendar opened behind the popup in Firefox (the browser's
  own date picker). It is now drawn inside the popup: month grid, arrow keys,
  Page Up/Down, Enter, Esc, and "Estimate: Fri 13 Nov".
- The ‹ › week buttons did nothing while the day was an estimate (regression
  in the first calendar draft, caught by the installed-extension check).
- Planned-skip rows could widen past the popup with a long subject name.
- Before the timetable is read (always the case after the very first read)
  the tab showed zero classes left and a false verdict; it now says it is
  waiting for the timetable.
- Muted text failed contrast on tinted cards in dark themes (Attendance's red
  Overall card, "No skips…", the planner's "Attend"): `themes.js` now steps
  muted text until it reads on every background it sits on, in all 20 themes.
- Under reduced motion every property animated for a frame, so positions read
  right after a change were stale; transitions are now off instead.
- `hidden` now always hides, whatever display a class sets.
- The last day of classes defaults to 13 November (this semester's date).

## Validation

```sh
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' npm test   # 298 pass, 0 skipped
node work/e2e/forecast-glitches.mjs chrome     # 0 failures
node work/e2e/forecast-glitches.mjs firefox    # 0 failures
node work/e2e/forecast-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/forecast-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/conservative-smoke.mjs
node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome      # passed on rerun; first run timed out starting the extension
node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/rating-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/rating-firefox.mjs outputs/cuims-clear-firefox
node work/e2e/forecast-shots.mjs firefox       # screenshots for a look
sh scripts/package.sh
```

`forecast-glitches.mjs` drives the real popup at 440×600 over 15 data
scenarios (no timetable, no history, long titles, odd subjects, far and past
end dates, Sunday, evening, planned skips, cooldown, throttled, an old read,
empty) and all 20 themes. It fails on anything outside its clipping frame,
chart labels leaving the chart or colliding, a crosshair label outside its
card or over the big figure, a redraw that moves the section being read or
closes a section, a planner/subject/calendar control that does not work, text
under WCAG AA contrast, and any attendance read not caused by a Refresh press.
No live CUIMS requests were made for this build.

## Manual pass before the stores

1. Load `outputs/dist/cuims-clear-*-0.10.0.zip` unpacked in each browser.
2. Open the popup: no read starts; an old read shows the accent Refresh.
3. Press Refresh once; the button counts down a minute. Press again after it
   comes back to fill in the timetable and the rest of the class record.
4. Forecast: hover the chart edge to edge, open "How the forecast works" and
   wait over 30 s, open the calendar from the date and pick a day, use ‹ ›.
5. A dark theme and a light one.
