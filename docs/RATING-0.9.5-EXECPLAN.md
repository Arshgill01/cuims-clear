# Integrate rating nudge into 0.9.5

Baseline: main ecc35d2; feature branch feat/0.9.1-rate-nudge at 36a84d8.
Keep unpublished version 0.9.5; preserve merged tidy/performance fixes.

- [x] Read source, existing policy/tests and integration conflicts.
- [x] Merge feature branch in an isolated worktree; retain 0.9.5 and sync tidy plus rating files.
- [x] Review standards and behavior; fix concrete issues.
- [x] Test popup policy and actual Chrome/Firefox popup UI, store links, errors, dismissal, confirmation and timer; capture screenshots.
- [x] Run complete suite, existing extension UX checks, packaging and archive/source parity.
- [x] Commit integration and rebuilt packages to main; replace delivered local archives and report behavior and limits.

No store publishing, credentials, paid services or new dependencies. If 0.9.5 was already submitted, the user needs a newer version before another store submission.

Outcome: 13 rating tests and 257 total tests passed; actual Chrome/Firefox popup checks and both extension UX harnesses passed. Archive integrity, manifest references, rating/tidy inclusion and 26 shared-file parity checks passed. Corrected three lifecycle issues and reduced-motion countdown behavior. No store publishing.
