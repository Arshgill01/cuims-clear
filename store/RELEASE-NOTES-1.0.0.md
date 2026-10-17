# CUIMS Clear 1.0.0: release notes

Packages (built from feat/1.0-celebration):
- Chrome Web Store: `outputs/dist/cuims-clear-chrome-1.0.0.zip`
- Firefox Add-ons: `outputs/dist/cuims-clear-firefox-1.0.0.zip`

No new permissions or hosts since 0.10.6 (Chrome: `storage`, `tabs`; Firefox: `storage`, `activeTab`; both: `students.cuchd.in`, `lms.cuchd.in`).
The updated privacy policy is included in main at
`outputs/cuims-clear-chrome/PRIVACY.md`, the path used by the store listing.

## Short version (for a post or the store's "what's new")

CUIMS Clear is 1.0: out of beta, with 100 students on the Chrome Web Store. Thank you.

- A new 1.0 tab: a receipt of your semester, every class day by day, a time capsule, Semester Wrapped on the last day of classes, and Proxy Run.
- My Time Table, Datesheet and Marks View on CUIMS, redesigned: what is on now and next, exams as tickets counting down, every subject's marks at a glance, and Add to calendar for your classes and exams.
- Had it before 1.0? You're a founder: a stamp on your receipt and two themes only founders get, Founding 100 and Black Card.
- Fixed: pending duty leave shows again after CUIMS's Duty Leave redesign; one exam set outside its test week no longer cancels that week's classes in the Forecast; absent marks count in subject totals.

## Chrome Web Store

The store has no separate release-notes field: the description carries a "What changed in 1.0"
paragraph. Paste the Description and Reviewer instructions from `store/chrome/listing.md`.

## Firefox Add-ons

Release notes (version page):

> CUIMS Clear is 1.0. A new 1.0 tab: a receipt of your semester, every class day by day, a time capsule, Semester Wrapped on the last day of classes, and Proxy Run. My Time Table, Datesheet and Marks View on CUIMS are redesigned, with Add to calendar for your classes and exams. Two themes for everyone who used CUIMS Clear before 1.0: Founding 100 and Black Card. Fixed: pending duty leave shows again after CUIMS's Duty Leave redesign; one exam set outside its test week no longer cancels that week's classes; absent marks count in subject totals.

Notes to reviewer: `approval_notes` in `outputs/cuims-clear-firefox/amo-metadata.json` (the 1.0
paragraph is at its end). Source: unminified; `web-ext lint` shows 0 errors and 10 warnings (0.10.6 has 6), with the same
warning kinds as 0.10.6 (innerHTML templates with escaped values, one eval warning in
`lms-open-wrap.js` that predates 1.0, `requestUpdateCheck` guarded for Chrome only).

## In the extension (What's new card, update-check.js)

1. CUIMS Clear is 1.0: 100 students on the Chrome Web Store. Thank you.
2. A new 1.0 tab: your semester receipt, every class day by day, Proxy Run, a time capsule, and Semester Wrapped on the last day of classes.
3. Had it before 1.0? You're a founder: a stamp on your receipt and two themes only founders get, Founding 100 and Black Card.
4. My Time Table, Datesheet and Marks View on CUIMS are redesigned, with Add to calendar for your classes and exams.
5. Pending duty leave shows again after CUIMS's Duty Leave redesign, one stray exam no longer cancels a week of classes, and absent marks count in totals.

## Everything in 1.0

**1.0 tab**
- Thermal receipt of the semester (from saved attendance) and of what the extension did since 1.0 (captchas, logins, pop-ups hidden, reads); saves or copies as a 1080×1920 image. Founding 100 stamp for anyone who updated from before 1.0.
- Every class day of the semester as a grid (present over missed), with perfect days, best run and best month.
- Semester Wrapped: six story cards (your day and weak spot, most faithful subject and comeback, lowest point, longest streak, what the extension did); opens on the last teaching day, a "so far" peek before; each card saves as an image.
- Proxy Run, a runner game whose captcha obstacles use the solver's own glyphs; offered while CUIMS makes you wait.
- Time capsule: one line to yourself, sealed until the last day of classes.
- Take your week with you: classes and exams as .ics files.

**CUIMS pages** (tidy layer; off with the "Tidier pages" switch)
- My Time Table: what is on now or next with a countdown and room, the day as a line of stops with free time, back-to-back periods merged, this week's dates and holidays, the next week once this one is done, a sticky time column on phones.
- Datesheet: exams as tickets, the next one large and counting down to the hour, the datesheet's papers in order, duplicate rows hidden.
- Marks View: marked so far, strongest, weakest and most marks dropped; a tile per subject with a segment per assessment; ABSENT counts as zero.
- Add to calendar on the timetable and datesheet: weekly classes to the last teaching day with holidays, breaks and test weeks left out (the summer-training credit CUIMS lists on Sundays is skipped); exams with reminders the day before and an hour before.

**Themes**
- Founding 100 and Black Card, founders only: receipt print (Courier), a book serif and gold foil, ink stamps, highlighter, washi tape, paper grain; Black Card adds crop-marked linework. They restyle the popup, CUIMS, the LMS view and the toolbar icon (a stamp). Everyone else sees them locked.

**Fixes**
- Duty leave: CUIMS's redesigned page opens on Internal (events); the history moved to External. The background read posts back to External when the history is missing (one paced page); a CUIMS tab hands it over for free.
- Forecast and calendar: a single paper set outside its MST's week no longer makes that whole week a test week.
- Forecast after the last teaching day shows the result ("Final · classes ended …") instead of "Out of reach / 0 classes over".
- Receipt: long subject names wrap at a word.
- Popup: toasts wrap inside the frame; small text is at least 10px (11px in Courier).
- Tidied CUIMS shortcut tiles no longer draw their icons over the labels on a phone.
- Privacy policy says when reads happen (opening a stale Attendance or Forecast tab, or Refresh).

## Final validation and publishing handoff

Final test results, exact commands, archive hashes and remaining checks:
[`docs/TESTING-1.0.0.md`](../docs/TESTING-1.0.0.md).
Both ZIPs were rebuilt and checked byte for byte against source. The full test suite
passed 367/367 with both browsers enabled; update, UX, Forecast and 1.0-tab checks
passed in Chrome and Firefox. Checksums: `outputs/dist/SHA256SUMS-1.0.0.txt`.

The 1.0 release has been merged into main, including the public privacy-policy
disclosures. Run the ordinary live-account checks listed in the
testing document; signed store upgrades remain a post-approval check. No store
submission or publishing was performed here.
