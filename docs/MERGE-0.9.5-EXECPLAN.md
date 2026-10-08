# PR #4 / #5 integration and 0.9.5 test packages

Goal: review both PRs against main, validate their combined Chrome/Firefox behavior, merge safe changes, and prepare version 0.9.5 packages for user testing without store publishing.

- [x] Pin main at 1c9a0d6 and trial-merge PR heads in an isolated worktree; preserve original workspace.
- [x] Review standards and PR behavior; distinguish DOM work reductions from network request reductions.
- [x] Run complete Node suite with Chrome/Firefox page checks and appropriate extension browser harnesses.
- [x] Fix verified blockers, repeat affected checks, and verify shared-build parity.
- [x] Merge reviewed exact PR heads to main; version both manifests as 0.9.5 and package.
- [x] Verify zip contents/version and record exact commands/results and remaining live-portal limits.

No authenticated portal or store publishing is authorized/needed for this integration. Live rate-limit effectiveness remains unverified without user testing. Existing local 0.9.1 branch is outside the two requested PRs.

Result: PR #4 and #5 merged via GitHub at their reviewed heads; combined source tree matches origin/main. Packaging and archive/source parity passed. Validation and user loading instructions are in TESTING-0.9.5.md.
