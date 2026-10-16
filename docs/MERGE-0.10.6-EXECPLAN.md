# Validate and merge 0.10.6

Goal: review the uncommitted update-notice work on feat/0.10.6-updates, validate both browser builds, and merge and push the verified result to main. No store publishing or authenticated CUIMS activity.

- [x] Locate the 0.10.6 work and confirm main/origin/main start at ad42e72 (0.10.5).
- [x] Review update scripts, manifests, popup integration, and regression tests.
- [x] Run npm test, shared-build synchronization/parity, and both browser update and forecast checks; fix verified failures.
- [x] Verify 0.10.6 archive/source parity and record results and limits.
- [x] Commit scoped changes, fast-forward main, push main, and verify remote commit.

Validation results will be recorded in TESTING-0.10.6.md. Existing unrelated worktrees and old archives remain outside this change.

All checks passed. The older smoke harness needed correction for main’s existing 30-second pause and LMS tab behavior; no runtime fixes were needed. Exact results and the store-rollout limitation are in TESTING-0.10.6.md.

Release commit 79282b6 was fast-forwarded into main and pushed to origin. `git ls-remote origin refs/heads/main` confirmed 79282b6e8ae7ae6264c7b1dc0b04836bbee35c14. Only unrelated older untracked 0.10.4/0.10.5 archives remain in the release worktree.
