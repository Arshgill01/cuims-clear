# 0.9.6 Forecast tab

The skip planner that sat at the top of the Attendance tab (0.7.3) moves to a
tab of its own, **Forecast**, and becomes a semester forecast. Attendance now
opens straight on the overall figure and the subjects. Neither extension store
was published by the agent.

## What the tab does

- **Hero, drawn in the mark's colours.** Where the overall figure finishes by
  the last day of classes at the student's recent pace, the likely range (8 of
  10 outcomes), the chance of clearing the goal, classes left, misses left and
  the share of the rest that must be attended. The chart shows the semester so
  far, the pace line inside its range, the attend-everything line and the goal;
  pointer and arrow keys move a crosshair with the date and figure.
- **Last day of classes.** Estimated as 20 November (July semester) or 30 April
  (January semester), marked "Estimated"; the student steps it by a week or
  picks a date. CU publishes no calendar to read it from.
- **Plan a skip.** Today and the next six days with classes. Each class is
  *Can skip* (at the goal right after), *Can make up* (under the goal for now,
  still reachable by the last day) or *Attend* (out of reach). Planned skips
  show before → after figures for that day in large type, and how the semester
  chance, misses left and finish move; the hero and chart include them.
- **By subject**, most at risk first: now → finish, one pip per class left
  (attend / can miss / planned skip), misses left and the chance. Each opens to
  its own chart, pace, need and when the misses run out at that pace.
- **Your habits.** Missed share by weekday, first class of the day against the
  rest, the last two weeks against the two before, and the current streak.
- The strict goal (90% every subject) reports subjects on track and the subject
  with the least room instead of an overall chance.

## Model

Pace is the share of classes attended lately (each class counts half as much
every 21 days), pulled toward the student's habit across all subjects (prior
worth 4 classes) and capped at 30 classes of evidence so the range never gets
razor-thin. Without a class record it falls back to the semester total.
Classes left come from the timetable through the last day. Attended classes
among them are a beta-binomial draw at that pace: exact chance and quantiles,
no simulation. Planned skips are certain misses. The history line is rebuilt
from the class record; on a live account (9 Oct 2026) present and absent marks,
leave excluded, matched CUIMS's eligibility counts exactly for every subject.

## Requests

The class record comes from `GetFullReport`, which the attendance code already
used for today's marks: cookie-less and outside CUIMS's page throttle. A
subject is read again only when its counts move, at most four subjects a
refresh (beyond today's reads), and today's marks are now served from that
record when it is current, so a quiet refresh makes no marks calls at all
(0.9.5 could make up to four). No timer, no new permissions, no new heavy
pages; the 40-per-10-minutes budget and backoff are unchanged.

## Storage

`attendanceHistory` (compact `[day, start, kind]` per class, per subject),
removed by Clear login. `forecastEnd` is a preference. `attendancePlan` now
holds `{ v: 2, keys: ["<day>|<class>"] }`; 0.9.5's one-day format is read and
converted.

## Validation

```sh
npm ci
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' npm test   # 278 pass
node work/e2e/forecast-shots.mjs chrome     # screenshots, frozen clock, synthetic semester
node work/e2e/forecast-shots.mjs firefox
node work/e2e/forecast-browsers.mjs chrome outputs/cuims-clear-chrome    # installed extension, 20 checks
node work/e2e/forecast-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox
node work/e2e/rating-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/rating-firefox.mjs outputs/cuims-clear-firefox
ENV_FILE=../cuims-clear/.env node work/e2e/forecast-live.mjs outputs/cuims-clear-chrome   # one live read, counts only
sh scripts/package.sh
```

## Manual pass before the stores

1. Load `outputs/dist/cuims-clear-*-0.9.6.zip` unpacked in Chrome and Firefox.
2. Attendance: no planner at the top; Refresh, goal switch and subjects as before.
3. Forecast: the hero figure, chart and stats appear after the first read; the
   class record fills in four subjects a refresh (Refresh again after 30 s).
4. Set the real last day of classes with ‹ › or the date; the figures move.
5. Plan a skip today and on another day; the day chips show the count, the
   hero says "with N planned skips"; Clear plan empties it.
6. Open a subject; hover and arrow-key the charts.
7. Switch to a dark and a light theme; the hero keeps its contrast.
8. Clear login removes the class record with the rest of the attendance.
