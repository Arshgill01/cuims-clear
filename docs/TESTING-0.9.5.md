# 0.9.5 preview integration

PR #4 and PR #5 were reviewed against main at `1c9a0d6` and tested together.
The final packages also integrate `feat/0.9.1-rate-nudge`. Neither extension store was published by the agent.

## Standards review

The shared Firefox source remains mirrored in Chrome. No permissions,
production dependencies, authentication policy or request budgets changed.
The review identified stale timetable and datesheet cards after source updates;
these were fixed on PR #5 before merging, including source-row removal.

## Behavior review

PR #4 reuses LMS search rows and links, preserves focus during pagination,
cancels pagination in Original view, avoids overlay scans for theme-only writes,
and releases detached theme panels. PR #5 reads both timetable formats, fixes
Today data, adds optional tidy timetable/attendance/marks/exam layouts and
removes CUIMS's extra loading delay on signed-in pages.

The network reduction is specific: the new timetable needs one GET without an
extra POST; Original view cancels further LMS pagination. Attendance budgets,
manual refresh gaps and backoff are unchanged. This is not evidence that the
reported Chrome/Firefox account rate limiting is resolved.

## Validation

Run from the repository root:

```sh
npm ci
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' npm test
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' node --test tests/cuims-tidy.test.mjs
node work/e2e/ux-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/ux-browsers.mjs firefox outputs/cuims-clear-firefox
node --test tests/rate-nudge.test.mjs
node work/e2e/rating-browsers.mjs chrome outputs/cuims-clear-chrome
node work/e2e/rating-firefox.mjs outputs/cuims-clear-firefox
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' sh scripts/package.sh
unzip -t outputs/dist/cuims-clear-chrome-0.9.5.zip
unzip -t outputs/dist/cuims-clear-firefox-0.9.5.zip
git diff --check
```

Initial PR integration: 244 passed. Final rating integration: 257 passed, no skipped tests. Targeted tidy checks: 9 passed,
including real Chrome 154 and Firefox 157. Installed-extension UX checks pass
in both browsers with mocked portal traffic and no page errors. They cover
search, focus, pagination cancellation, essential dialogs, feedback updates,
theme restoration, detached panels and sampled contrast. Five theme repaints
trigger zero overlay scans; search adds zero course nodes. The Chrome harness
needed to settle the preceding feedback mutation before resetting measurements;
that timing fix is on PR #4. One initial Firefox installation/startup run timed
out; subsequent instrumented and unmodified harness runs both passed.

Packaging runs the suite again with both browser paths enabled. Zip integrity,
manifest versions, manifest-referenced files, archive/source content and shared
Chrome/Firefox script parity were checked. No temporary test instrumentation or
AMO metadata is included in the archives.

## Manual testing

Unzip Chrome's package, open `chrome://extensions`, enable Developer mode and
Load unpacked using the folder containing `manifest.json`. For Firefox, unzip
its package and use `about:debugging#/runtime/this-firefox` → Load Temporary
Add-on → `manifest.json`. This unsigned preview is temporary in normal Firefox.

Check a normal login and attendance refresh, Today data, timetable on desktop
and mobile widths, exam room/link corrections, marks after session switching,
all preferred themes, and Settings → CUIMS pages → Tidier pages on/off. Watch
whether normal use encounters a refusal; record endpoint, status and recovery
time without provoking repeated failures.

Authenticated CUIMS traffic and minimum supported browser versions were not
tested in this integration. Live request-limit effectiveness and actual account
page layouts remain for user testing before store release.

## Rating nudge integration

The rating branch was merged while retaining version 0.9.5, the tidy setting,
all previous fixes and both tidy files in the Chrome sync script. Three policy
integration bugs were corrected: first successful reads now show the ask without
reopening, Settings does not consume the daily top banner, and removing
attendance hides the ask. Reduced motion also disables the countdown animation.

The nudge asks on healthy Attendance only. The first appearance each campus day
is a small top card for eight seconds (paused on hover or keyboard focus), then
a compact bottom strip; later popup opens that day use the bottom strip. Rate
it opens the browser's own store; Already rated stops asking permanently. After
Rate it, a confirmation offers Yes, I rated it or Not yet. Closing the ask
snoozes for three days, and a third dismissal stops asking permanently. Settings
keeps a store link available. Decisions stay in local extension storage, with
no telemetry or automatic detection of whether someone rated.

Rating policy/regression tests: 13 passed. Real installed Chrome popup checks
and an instrumented copy of the actual Firefox popup passed with no page errors.
Firefox excludes extension pages from BiDi automation, so its disposable helper
runs assertions inside the popup and reports to a local server. That helper,
its added permissions and fixture data never enter the production archive.
Actual top, bottom and confirmation screenshots are saved in ignored
work/e2e/results. Chrome's timer was tested with real pointer hover; Firefox's
with keyboard focus. One concurrent Firefox UX cancellation run failed its request-count assertion;
a standalone repeat passed. The harness now holds the mocked next-page response
until the Original-view click, so it tests cancellation without depending on
browser speed. Both browser harnesses passed with this controlled response.
The rating code does not change LMS pagination.

Use the rebuilt ZIPs, which replace the earlier packages of the same version.
If the earlier 0.9.5 was already submitted to a store, choose a higher version
before another submission. Live account testing performed by the user on the
previous build is retained; rating integration was verified offline in both
browsers. Store acceptance itself is not established by these tests.
