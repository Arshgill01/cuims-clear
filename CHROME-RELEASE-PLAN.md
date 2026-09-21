# Chrome Web Store release

## Goal
Publish the Chrome MV3 build (0.6.2) through arshgill6120@gmail.com.

## Plan
- [x] Inspect package, privacy documentation, tests, and developer dashboard.
- [x] Replace unsupported manifest SVG icons with PNG exports of the existing mark.
- [x] Run existing tests and validate package references; create release ZIP.
- [x] Prepare accurate listing copy, privacy disclosures, and required images.
- [x] Upload and complete the store listing, then submit for review and verify status.

## Constraints and findings
No PLANS.md or repository AGENTS.md exists. Follow user-provided AGENTS.md.
Preserve the existing feature scope and untracked work/lms-design-pitches.html.
Dashboard has no items and is signed into the requested developer account in Firefox.
Publishing requires Google review; submission is not a claim that the listing is live.

## Validation and progress
`node --test tests/*.test.mjs`: 65 passed, 0 failed. Python manifest-reference and ZIP integrity checks passed (16 references). User uploaded ZIP successfully. Store item ID: amlobigbjldbogimakmfndkdaekcdbkf. Description, Education category, English, homepage and support URLs saved.

## Submission blockers discovered
Google's current user-data FAQ requires strong encryption for data at rest. Existing Chrome build stores the CUIMS password unencrypted. Asked user to choose Chrome password-manager filling (recommended) or a passphrase-protected vault before release. Do not certify policy compliance or submit this build until resolved.
Privacy draft saved with single purpose, permission explanations, no remote code, existing public privacy URL, and local PII/authentication/website-content handling declared.
Dashboard also requires a screenshot, store icon, three policy certifications, and a verified publisher contact email. Promo tile should be supplied per image guidance.

## Approved password-manager change
User chose Chrome password manager. Chrome 0.6.2 removes UID/password storage and popup fields, preserves portal autofill, clears old credentials on install/update, and keeps browser-specific content/popup files out of Firefox sync. Add regression coverage for delayed autofill and credential migration before repackaging. User reports contact email verified.

## Final preparation
Chrome 0.6.2 ZIP uploaded successfully. 69 tests passed with `node --test tests/*.test.mjs`; `git diff --check` passed. Manifest references and ZIP integrity passed. Public privacy policy updated in commit e2580b6 (pushed to main and HTTP 200 verified). Contact email confirmed verified in dashboard. Existing logo, 1280x800 screenshot, 440x280 promo tile, listing copy, and reviewer instructions saved. No university credentials shared.

## Submission result
21 September 2026: Google displayed “Your extension was submitted for review” and “Item submitted.” Automatic publication after approval is enabled. Distribution is free, public, all regions. Store ID: amlobigbjldbogimakmfndkdaekcdbkf. Not yet live; Google review remains external.

Release ZIP SHA-256: bbcb4de5493e1bf9761e0386b25aea78902f5c5fa70102bbb69aeab21cb3262c.
Validation limits: regression suite and rendered popup checked; Chrome password-manager filling against a live university login was not exercised during this release. Reviewer access may require follow-up because no university test account is available.
