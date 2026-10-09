# Conservative CUIMS request pass

Implemented in branch `codex/conservative-cuims-requests` in the separate
managed `conservative-cuims-requests` worktree. The original checkout was not
modified. Firefox shared source and Chrome copies match.

## Behavior

- Explicit background requests share a rolling 25-request / 10-minute budget
  across attendance, session checks, leave detail and LMS SSO. The previous
  budget was 40 / 10 minutes; using 25 / minute would have loosened it.
- Attendance refreshes wait 60 seconds. Cached data stays visible while the
  button is disabled, and the UI re-enables it without issuing a request.
- HTTP 429/503 and CUIMS error-page redirects stop the current read, including
  optional detail and summary fallback. Cooldowns start at five minutes,
  escalate on repeated failures and honor a longer Retry-After.
- LMS shares the queue/budget/cooldown and does not open another CUIMS fallback
  tab during a pause. Browser-worker restarts preserve the safeguards.

The budget counts explicit fetches issued by the background, not every
browser-followed redirect or natural portal-tab request. This pass reduces
extension traffic; it cannot guarantee a UID never reaches a server limit
while the user is also browsing CUIMS.

## Validation

| Exact command | Result |
| --- | --- |
| `npm test` | 257 passed; zero failures or skips |
| `node --test tests/attendance.test.mjs tests/lms-open.test.mjs tests/firefox-background.test.mjs` | 111 passed |
| `node work/e2e/conservative-smoke.mjs` | Passed; real packaged Chrome worker and popup, mocked CUIMS |
| `npm run sync` | Passed |
| `git diff --check` | Passed |

A Python byte comparison also confirmed all six changed shared scripts match
between Firefox and Chrome. The Chrome smoke checked cached attendance,
Retry-After, UI expiry without network, and zero LMS requests/fallback tabs
during cooldown, with no page errors.

## Live experiment

The user approved at most 25 requests over 10 minutes, stopping at the first
throttle. Testing used their existing signed-in Chrome profile in AeroSpace
workspace 4. Automatic login was disabled for the experiment.

The first recording observed three requests returning 200 but was interrupted
by the Mac locking and the inspector closing. It is excluded from the clean
window totals. A second recording began at 09:53:56 UTC on 8 October 2026.
Five manual warm attendance refreshes, an Open CUIMS session check and an LMS
SSO launch were exercised. The observation ended at 2026-10-08T10:04:23.547Z (over 10 minutes).
The final HAR contained 10 entries: 8 CUIMS requests and 2 LMS redirect-chain
requests. Eight returned 200; one returned 302 and one 303 during SSO. No
429, 503 or error-page response was observed. The five attendance POSTs took
56.044–353.037 ms (HAR duration). All requests stayed below the approved
25-request ceiling. No further extension requests appeared during the idle
remainder of the observation window.

CUIMS's sidebar rendered and My Profile loaded its normal fields without a
404 or error-page redirect. LMS reached My courses without showing its login
form. Ordinary portal/LMS page traffic was not captured by the background
worker inspector and is not included in its totals.

No precise CUIMS UID threshold can be inferred from successful low-volume
reads. An exact threshold would require a larger, separately authorized
experiment and may differ by endpoint, session or time. No rate-limit bypass
was attempted.

Ignored evidence is under `work/e2e/results/conservative/`: action timestamps,
sanitized network observations, final request metadata, test logs, the smoke
JSON and fixture screenshot, and the implementation diff. Bodies, cookies,
headers, URL query values, credentials and SSO tickets are omitted. Raw HAR
exports are removed after reducing them to request metadata.

## Browser cleanup

Removed the development build's saved test login and attendance, restored its
automatic-login defaults and disabled it. Re-enabled the user's installed
0.9.0 build and closed the worker inspector/test tab. The signed-in LMS page
remains available. No release or production deployment was made.

## Follow-up: duty leave fetched with attendance

Duty-leave applications now load on every permitted attendance refresh,
including the first read and after a recent cached leave check. A changed
approval state is reflected on the next refresh without opening CUIMS's leave
page. The unchecked-state copy asks for an attendance refresh. If the session
has expired, the existing guarded sign-in runs once; CAPTCHA-off settings,
login-tab ownership, login guards and throttle cooldowns still apply.

Medical leave remains cached for at least three hours and yields to attendance
and timetable page loads. Its retry timestamp is independent of duty-leave
reads. Duty leave adds one page request per attendance refresh, plus existing
per-course marks reads when pending applications change. All calls share the
25/10-minute budget and 60-second refresh interval.

The final `npm test` passed 257 tests, and
`node --test tests/attendance.test.mjs tests/lms-open.test.mjs tests/firefox-background.test.mjs`
passed 111. `node work/e2e/conservative-smoke.mjs` passed with the actual Chrome
package, mocked CUIMS responses and no page errors: it fetched pending duty
leave without a portal tab and cleared it on the next refresh after approval.
This follow-up was tested offline; the live measurements above describe the
earlier pass and do not measure its additional duty-leave traffic. Logs are
`duty-leave-targeted.log`, `duty-leave-all-tests.log`,
`duty-leave-browser-smoke.log`, and the fixture screenshot is `duty-leave.png`
under the same ignored evidence directory.
