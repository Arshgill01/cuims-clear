# Chrome Web Store metrics — observed November 1, 2026

Read directly from the signed-in Chrome Web Store Developer Dashboard using computer use in Firefox. These are historical observations, not live counters.

- Product: CUIMS Clear
- Store item ID: `amlobigbjldbogimakmfndkdaekcdbkf`
- Selected dashboard date range: **Last 30 days**, explicitly displayed as **October 1–30, 2026**.
- Public listing: https://chromewebstore.google.com/detail/amlobigbjldbogimakmfndkdaekcdbkf

## All headline figures observed in the dashboard

| Dashboard section / metric | Displayed value | Displayed change versus previous period |
| --- | ---: | ---: |
| Installs | 255 | +589.19% |
| Uninstalls | 36 | +800.00% |
| Weekly users over time — summary figure | 114 | +4,654.17% |

The aggregation used for the weekly-users summary figure was not independently established. **114 is not the latest or peak weekly-user observation.** The growth percentages above are copied from the dashboard; the preceding period was not separately exported or audited.

## Figures verified from exported daily data

| Metric | Value | Date / range |
| --- | ---: | --- |
| Total installs | 255 | October 1–30, 2026 |
| Peak weekly users | 206 | October 27 and October 28, 2026 |
| Latest weekly-user observation in export | 198 | October 30, 2026 |
| First weekly-user observation in export | 13 | October 1, 2026 |
| Observations per export | 30 | One row per day, October 1–30, 2026 |

## Raw exports

The downloaded CSVs are preserved unchanged, including their first-line chart titles:

- [Weekly users over time](analytics/2026-11-01/cuims-clear-weekly-users.csv)
- [Installs](analytics/2026-11-01/cuims-clear-installs.csv)

No uninstall CSV was downloaded; the uninstall total and change above were read from the dashboard UI.

## Interpretation and wording

- Installs are installation events, not a verified count of unique people or retained users.
- Weekly-user observations overlap. Do not sum them to obtain monthly users.
- Do not describe the peak of 206 as the latest count; the latest exported observation is 198.
- Installs minus uninstalls is not an independently measured retention rate or active-user count.
- No ratings, impressions, lifetime-install total, or retention metric was collected during this session.

Suggested resume/application wording:

> Recorded 255 Chrome Web Store installs during October 1–30, 2026, and peaked at 206 weekly users during that period.

## Verification

The copied CSVs were checked for byte-for-byte equality with the original exports. CSV assertions verified 30 observations each, 255 summed installs, peak 206 users on October 27–28, and latest 198 users on October 30.
