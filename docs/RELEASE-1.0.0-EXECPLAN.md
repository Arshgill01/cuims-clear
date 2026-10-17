# Prepare 1.0.0 for manual store publication

Work in the existing `feat/1.0-celebration` checkout, preserving Claude's pending edits.
There is no repository PLANS.md or local AGENTS.md; follow the rules supplied in chat.
Scope: finish the existing 1.0 release, not the deferred leave feature work. Retain the
already-implemented Duty Leave compatibility fix. Do not publish to either store.

- [x] Locate existing work, inspect release scripts, changes, tests and store copy.
- [x] Run the complete unit suite with both real-browser paths enabled.
- [x] Exercise browser regressions and the 1.0 tab in disposable profiles; resolve failures.
- [x] Rebuild both ZIPs; validate manifest references, archive integrity and exact source parity.
- [x] Finish release notes, checksums and testing/publication handoff with explicit limits.

No new dependencies, permissions or services are planned. Existing source remains in this
checkout; main's public privacy-policy URL must reflect 1.0 before store review.

Completed: see TESTING-1.0.0.md for exact commands, results, checksums and remaining
manual publication checks. ZIP/source parity and all automated gates passed. The release was committed as `833483f` and fast-forwarded into main. Store
submission remains with the publisher; no leave feature work added.
