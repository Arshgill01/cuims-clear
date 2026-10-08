# UX performance work — 8 October 2026

Branch: `perf/ux-responsiveness`, based on `1c9a0d6` (0.9.0).

## Scope and integration

This branch changes only the shared CUIMS scanner/theme and LMS directory,
plus tests and test tooling. Attendance, duty/medical-leave fetching, request
budgets, refresh timing, marks views and timetable tabs are untouched. No
manifest version, permissions, store release or main-branch merge is included.
Firefox remains the shared source; the four changed files are synced to Chrome.

## Changes

- Course rows and their links are reused; search filters their visibility and
  uses precomputed lowercase search text. Typing creates no course DOM nodes.
- Pagination preserves the search and keyboard focus on an unchanged link.
  Original view aborts the in-flight clear-directory fetch and stops additional
  pages. Returning to Clear view loads the remaining courses again.
- Theme-only colour/transition writes and no-op class changes no longer wake
  the full CUIMS scanner. Structural, visibility and validation-text changes
  still do. Feedback text walks use changed subtrees; explicit settings/login
  scans still cover the whole document.
- Theme surface composition is memoized within one paint, then discarded.
  Removed UpdatePanel trees release strong references and restore original
  colours/transitions before being forgotten, so reinsertion remains correct.

## Validation and measurement

`npm test`: **235/235 pass**. New regressions execute both shipped content
scripts and cover cosmetic-vs-relevant mutations, batched frames, partial/full
scan precedence, link identity, course-code search and empty results.

The current store packages were downloaded from the official stores. Both are
0.9.0, and `content.js`, `lms.js`, and `cuims-theme.js` match the git baseline
byte for byte. The unmodified signed Firefox XPI was installed successfully;
its actual LMS content script rendered a mocked directory. Detailed comparisons
install disposable copies with test-only telemetry; that telemetry is not in
the production files or preview builds.

Real Firefox 147, headless Linux, two mocked LMS pages containing 200 course
destinations / 100 subjects, 80 search input events; CUIMS fixture with about
800 themed elements. Recorded successful comparison:

| Measurement | Store baseline | Candidate |
| --- | ---: | ---: |
| Time for 80 search events | 199 ms | 6 ms |
| DOM nodes added during search | 4,040 | 0 |
| Full overlay scans after five theme-only repaints | 5 | 0 |
| Computed-style reads during those repaints/scans | 6,415 | 4,005 |
| Retained theme entries after removing the large panel | 810 | 9 |

These are fixture measurements, not a promise of equivalent live-portal speed.
Runs vary (earlier search samples: baseline 207 ms, candidate 4 ms). Theme paint
time itself did not consistently improve; no claim of a faster first theme
paint is made. One baseline repeat surfaced intermittent Firefox permission
errors; a repeat completed without errors. Candidate runs completed without
page errors.

Browser assertions cover pagination, focused links, Clear/Original switching,
fetch cancellation, automatic vs student-opened dialogs, feedback text changed
in place, reopening suppressed panels, removed/reinserted themed trees, and
dark/light/default theme changes. Representative dark/light text contrast is
checked against its composited background; native transitions are restored on
detached panels. The LMS screenshot was visually checked for layout and focus.

Chrome 145 for Testing was downloaded, but startup fails at the process-singleton
Unix socket (`Operation not permitted`) in this environment. Chrome's store
package was fetched and compared, and its shipped scripts pass the Node tests;
actual Chrome installation/rendering remains an outstanding desktop check.
Firefox's runtime is 147, not the manifest's minimum 142; minimum-version
browser checks remain outstanding too.

## What is actually known about CUIMS limits

| Number / observation | Evidence | Interpretation |
| --- | --- | --- |
| 40 requests / 10 minutes | `attendance-daemon.js` constants | Extension policy, not a documented server threshold |
| 30-second manual-refresh gap | Same file | Extension policy; left untouched |
| 3 automatic page-login submits | `content.js` | Extension safety budget, not a CUIMS limit |
| About 5 failures / 20-minute lockout | Historical comments/audit | Prior estimate; not independently verified in this session |
| 30 requests during one public login-page load | Passive Firefox trace | 29 HTTP 200 responses, one favicon 404; no 429/503 or rate headers |
| Public GET returned HTTP 200, IIS/10.0, `cache-control: private` | Single separate public request | No advertised `RateLimit`, `X-RateLimit` or `Retry-After` headers |

No authenticated session was tested: the ignored `.env` has blank
`CUIMS_UID` / `CUIMS_PASSWORD`. No deliberately invalid credentials, forced
lockout, high-rate traffic or bypass was used. The exact server threshold,
window, request categories and scope (account/session/IP) remain unknown.
Public document/assets traffic does not establish an authenticated API limit.
The earlier university help text about waiting 20 minutes after a password
reset is also not a numeric request-rate specification.

`work/e2e/live-observe.mjs` is ready for ordinary account testing. It records
method/path/status/timing and selected rate headers, excluding query strings,
bodies, cookies, page text and credentials. Its page trace does not see extension
worker requests. If normal use encounters a refusal, record the endpoint,
response headers, elapsed window and recovery evidence rather than inventing
a global limit from a single symptom.

## Further candidates after live profiling

1. Measure login navigation, API latency, server timing when exposed, long
   tasks and layout work separately; optimize the dominant cost first.
2. Profile first theme paint on real large portal pages. It remains synchronous
   and can consume a frame; partitioning work needs a no-flash and contrast
   check on real pages before changing the paint contract.
3. Inspect redundant LMS directory reads across course navigation. An account-
   scoped cache could help, but account identity/invalidation must be verified
   before caching enrolled courses across documents.
4. Measure overlay geometry scans on busy real dashboards. Candidate-root
   tracking may reduce these further, provided essential dialogs and loaders
   continue to work.

The extension can change client rendering, reduce its own redundant work and
requests, and improve interactions. It cannot patch CUIMS backend code, database
queries, server caches or university infrastructure without university access.

Official package sources: [Firefox](https://addons.mozilla.org/en-US/firefox/addon/cuims-clear/)
and [Chrome](https://chromewebstore.google.com/detail/cuims-clear/amlobigbjldbogimakmfndkdaekcdbkf).
Reproduction commands are in `work/e2e/README.md`; logs/screenshots and browser
profiles are test artifacts, never release assets. Credentials stay ignored.
