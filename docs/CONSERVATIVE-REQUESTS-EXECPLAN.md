# Conservative CUIMS requests

Goal: reduce extension traffic that can leave CUIMS navigation unavailable, keep cached attendance useful, and measure live responses without claiming an unobserved UID threshold.

## Decisions and scope

- Worktree: `conservative-cuims-requests`, branch `codex/conservative-cuims-requests`, based on `feat/0.9.1-rate-nudge`.
- Firefox is the shared source; use `npm run sync` for Chrome parity.
- The existing budget is 40 requests per **10 minutes**, not per minute. Conservative budget: 25 per 10 minutes; refresh gap: 60 seconds. The per-minute wording would loosen the cap, so the 10-minute denominator follows the user's conservative intent and approved experimental ceiling; this interpretation was explicitly stated.
- No automatic polling, new dependencies, release/version changes, deployment, or credential logging.
- Live experiment: user-approved ceiling of 25 application requests over 10 minutes, stop on first throttle or login rejection. Count natural portal API traffic separately; omit bodies, cookies, query values, UID, passwords and SSO tickets from logs.
- A clean run establishes an observed lower bound for this session/workload only. Do not claim an exact, universal UID threshold.

## Progress

- [x] Read user repository rules; no on-disk AGENTS.md or PLANS.md found.
- [x] Inspect product docs, prior audit/plan, manifests, shared sync, request client, daemon, background wiring, popup callers, LMS launcher and existing test seams.
- [x] Run baseline tests; reproduce missed cooldown and budget paths with deterministic mocked CUIMS responses.
- [x] Apply minimal policy and shared budget/cooldown fixes; preserve cached data and portal navigation.
- [x] Test refresh boundaries, browser-worker restart persistence, optional throttles and mixed attendance/LMS callers.
- [x] Run all repository tests, shared-file parity and real packaged browser smoke test.
- [x] Run signed-in Chrome portal check and bounded live experiment; save sanitized evidence and limitations.
- [x] Review diff and report exact validation commands and measured results.

## Initial evidence

- `attendance-daemon.js`: 30-second refresh gap, 40/10-minute budget; optional timetable, marks and leave catches can swallow refusals; session opening does not check attendance backoff; leave ingestion does not join the existing exclusive queue.
- `lms-open.js`: direct `fetch` for home and SSO bypasses the daemon's request log and cooldown.
- `attendance-client.js`: HTTP 429/503 become generic `busy` with a shorter backoff than `portal-busy`; `pingHome` can accept an error page as an alive session.
- No live symptom reproduction yet. Tests can demonstrate policy holes, but cannot establish the cause of users' profile/sidebar failures.

## Verification

- Baseline `npm test`: 238 passed after linking existing ignored node_modules.
- Red regression tests reproduced the 59-second refresh, short HTTP429 backoff, swallowed optional throttle, false alive error-page session, and cached-summary fallback defects.
- Final `node --test tests/attendance.test.mjs tests/lms-open.test.mjs tests/firefox-background.test.mjs`: 105 passed.
- Final `npm test`: 251 passed, zero failures/skips.
- `npm run sync`, `git diff --check`, and Python byte comparison of the six changed shared scripts: passed.
- Final `node work/e2e/conservative-smoke.mjs`: passed with the real packaged Chrome worker/popup. UI expiry sends zero requests; Retry-After keeps cached attendance and pauses for 10 minutes; LMS sends zero requests and opens no CUIMS fallback tab during the pause.
- Logs and fixture screenshot: ignored `work/e2e/results/conservative/`.
- In-app browser testing stopped at the user's request. All extension live validation uses their signed-in Chrome profile in AeroSpace workspace 4.
- Console paste protection was left intact. Recording uses Chrome's native Network panel. HAR exports are reduced to timestamps, methods, host/path, status and duration, then the raw file is removed.
- First recording: one refresh made three successful requests; it was interrupted by macOS locking and the inspector closing. No exact window/threshold claim is made from it.
- Restarted recording began at 09:54 UTC. Warm refreshes have returned 200. The live report will include the final counts and remaining uncertainty.

## Outcome

- Clean observation exceeded 10 minutes, with 10 worker network entries: 8 CUIMS and 2 LMS redirect-chain requests; 8×200, 1×302, 1×303. No throttle observed. Five attendance POSTs took 56–353 ms.
- CUIMS sidebar and My Profile loaded; LMS reached My courses without a login form. Natural tab traffic was outside the worker recording. Actual UID threshold remains undetermined.
- Test credentials/cache cleared; development build disabled; installed 0.9.0 restored; test inspector/tab closed.
- Final report: `docs/CONSERVATIVE-REQUESTS-REPORT.md`.

## Follow-up: duty leave with attendance

User requested duty-leave state to be fetched with attendance, without opening
the portal leave page. Inspection found the three-hour alternating cache and
one-heavy-page gate defer duty leave, including on the initial fetch.

- [x] Trace leave fetch, pending counts, popup fallback copy and existing tests.
- [x] Fetch duty leave on each permitted attendance refresh; retain the shared
  25/10-minute budget and cooldown, and the slower medical-leave cadence.
- [x] Reuse the existing guarded sign-in if the duty-leave page reports an
  expired session; never retry a throttle or consume extra login attempts.
- [x] Verify first fetch, changed approval state, cooldown/budget, signed-out
  sessions, and the packaged Chrome popup; sync and run the full test suite.
- [x] Update report and docs. Previous live counts describe the earlier pass,
  not this follow-up's extra duty-leave request.

Follow-up result: 257 full-suite tests and 111 targeted tests passed. Packaged
Chrome smoke fetched pending duty leave and reflected approval on the next
refresh without a portal tab; no page errors. Shared scripts synced, diff
reviewed and docs updated. The earlier live figures remain labeled as earlier
pass evidence, not validation of the additional duty-leave traffic.

## Production-readiness check

- [ ] Review final working changes and release packaging requirements.
- [ ] Record a bounded first attendance/duty-leave fetch and subsequent refresh
  in the user's signed-in Chrome session; stop on refusal/throttle and keep
  the 25-request ceiling. Do not infer a UID threshold.
- [ ] Restore installed extension and document whether live results support
  release. No push, store submission or deployment is part of this check.
