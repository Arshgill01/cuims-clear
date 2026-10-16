# CUIMS rate-limit investigation

Investigate the actual Firefox/Chrome 0.10.3 release at `35b1c45`, compared with 0.9.0 and 0.9.5. Preserve attendance, forecast, leave reads and normal portal use. No PLANS.md or local AGENTS.md exists; follow the instructions supplied in this conversation.

## Execution

- [x] Identify the shipped release; confirm the Firefox daemon matches the release ZIP by SHA-256. Current checkout is 0.9.1; isolate work in `work/rate-investigation` on `diagnose/cuims-rate-limits`.
- [x] Construct deterministic traces of 0.8.7, 0.9.0, 0.9.5 and 0.10.3 cold/warm refreshes, persisted update state, timetable postbacks, leave reads and concurrent tab traffic.
- [x] Capture the existing Firefox state without clearing caches or exposing credentials. Opening the installed popup test tab performed its normal one-report automatic refresh.
- [x] Rank falsifiable hypotheses and test each independently: local budget versus portal refusal; newly introduced leave reads; update cache reset; inner-page/report differences; lost menu rights and request bursts.
- [x] Run bounded live read-only experiments: record sanitized method/path/status/time/rate headers, stop a sequence at its first refusal, distinguish failed session initialization from a numerical limit. No invalid login attempts; no leave submission or editing.
- [x] Fix reproduced empty-menu classification, tab/background coordination and individual-request pacing defects, with failing-then-passing regression tests exercising actual caller sequences.
- [x] Run targeted tests (152 passed) and the complete suite (`npm test`: 334 passed, two browser-fixture tests skipped, zero failed). Run shared-source sync and whitespace checks.
- [x] Document measured bounds, unresolved scope/window uncertainty and a concrete feature-preserving refresh workflow. Do not publish a release without evidence.

## Evidence constraints

`40/10 minutes` and `25/10 minutes` are extension budgets, not measured CUIMS limits. The 0.10.3 release was tested offline, according to its testing document. A single account/IP measurement cannot establish a universal server limit. Record HTTP redirects separately: fetch invocations and actual network requests differ. Avoid logging request bodies, query values, cookies, credentials, report IDs or attendance records.

## Live findings and release gate

Three rapid sequences reproduced empty navigation on the third page, including attendance alone. Twelve inner reads with five-second waits remained healthy. Recovery exceeded five minutes and was observed by ten minutes twenty-one seconds in one cycle; exact quota/scope/reset remains unknown. Burst probes stopped at 06:28:43 UTC. The portal was observed recovered around 06:48 UTC.

The user approved loading the first temporary candidate with the existing add-on ID and permissions. Caches survived. Manual Refresh at 06:55:02 sent one successful GetReport during the preserved page pause, forecast rendered plans, and one GetFullReport succeeded at 07:00:12. An earlier diagnostic used the wrong cache and failed before any network request. Sanitized evidence is retained separately.

The first candidate **failed live validation** on the user's normal Refresh → Open CUIMS workflow. Captured requests: GetReport 07:02:47.846, timetable 07:02:47.919, hidden Home 07:02:51.804. Native Home reported an empty menu at 07:02:52.985. Home was excluded from the initial pacing gate; timetable did not update session freshness. The planned paced three-page positive control never started. Do not count it as evidence.

Older 0.8.7/0.9.0 also had the Home preflight. The captured sequence is actionable, but the historical frequency difference remains unresolved.

## Second candidate: session reuse

- [x] Reproduce Refresh/timetable → Open in regression tests before changing code.
- [x] Reuse the known cookie session for a visible CUIMS destination without an aging hidden Home preflight; leave expired-session handling to the native destination.
- [x] Mark successful timetable reads as session proof; include Home in page pacing and native page activity stamps.
- [x] Wait for the visible destination through the shared queue; stop opening if a refusal arrives during that wait or a pause already exists.
- [x] Inspect raw portal responses for refusal using a clone, preserving the body for LMS SSO. Do not extend an existing pause on a blocked operation.
- [x] Run failing-then-passing regressions, targeted suite (152 passed), full suite (334 passed, two skipped), shared-source sync, differential harness and whitespace checks.
- [ ] Reload the temporary candidate in Firefox and verify its loaded source. Computer-control calls currently time out; no reload is confirmed.
- [ ] After the preserved refusal pause expires, perform one ordinary Refresh → Open CUIMS validation. Capture safe request metadata and native menu health. Do not repeat rapid negative probes or clear guards/caches. Stop at first refusal.
- [ ] Export sanitized final evidence, restore any diagnostic fetch wrapper, close only agent-owned diagnostic surfaces, and record the final installed build and portal state.

The second candidate has not been published or live-validated. The first candidate remains the last confirmed loaded build. Do not call it a stable store release. No new periodic scheduler is included; any future scheduler must share this admission policy and pass ordinary-use validation first.
