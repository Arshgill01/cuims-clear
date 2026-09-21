# Chrome Web Store release

## Goal
Publish the existing Chrome MV3 build (0.6.1) through arshgill6120@gmail.com.

## Plan
- [x] Inspect package, privacy documentation, tests, and developer dashboard.
- [x] Replace unsupported manifest SVG icons with PNG exports of the existing mark.
- [x] Run existing tests and validate package references; create release ZIP.
- [ ] Prepare accurate listing copy, privacy disclosures, and required images.
- [ ] Upload and complete the store listing, then submit for review and verify status.

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
