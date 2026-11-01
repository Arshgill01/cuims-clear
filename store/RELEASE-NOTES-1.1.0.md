# CUIMS Clear 1.1.0: release notes

Packages (built from main after merging feat/marks-duty-leave, PR #7):
- Chrome Web Store: `outputs/dist/cuims-clear-chrome-1.1.0.zip`
- Firefox Add-ons: `outputs/dist/cuims-clear-firefox-1.1.0.zip`
- Checksums: `outputs/dist/SHA256SUMS-1.1.0.txt`

No new permissions or hosts since 1.0.0.

## Short version

- Marks are weighted the way CU counts internal marks, so percentages match CU's. Before,
  the raw rows were added up (a surprise test out of 12, each MST out of 20), which
  over-weighted MSTs, surprise tests and experiments.
- A new Marks tab in the popup: your average, the raw total, every subject and how it adds up,
  current and previous session.
- One switch for whether Aptitude and Soft Skills count towards your result, shared by the
  Marks tab and Marks View on CUIMS.
- Duty Leave opens straight on External, and a File duty leave card fills CUIMS's form from the
  classes you were marked absent in. You add the reason and proof, then Save.

## Chrome Web Store

Paste the Description (with its "What changed in 1.1" paragraph), the host permission
justification and the Reviewer instructions from `store/chrome/listing.md`.

## Firefox Add-ons

Release notes: `release_notes` in `outputs/cuims-clear-firefox/amo-metadata.json`.
Notes to reviewer: `approval_notes` in the same file (the Marks View and Duty Leave sentences
are at its end).

## In the extension (What's new card, update-check.js)

1. Marks are now weighted the way CU counts internal marks, so your percentages match CU's. A new Marks tab shows them without opening CUIMS.
2. Say whether Aptitude and Soft Skills count towards your result: one switch, on the Marks tab and on Marks View.
3. Duty Leave opens straight on External, and one button fills CUIMS's form from the classes you missed. You add the reason and proof, then Save.
