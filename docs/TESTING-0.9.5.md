# 0.9.5 preview integration

PR #4 and PR #5 were reviewed against main at `1c9a0d6` and tested together.
These packages are for manual testing; neither extension store was published.

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
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' FIREFOX_BIN='/Applications/Firefox.app/Contents/MacOS/firefox' sh scripts/package.sh
unzip -t outputs/dist/cuims-clear-chrome-0.9.5.zip
unzip -t outputs/dist/cuims-clear-firefox-0.9.5.zip
git diff --check
```

Full suite: 244 passed, no skipped tests. Targeted tidy checks: 9 passed,
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
