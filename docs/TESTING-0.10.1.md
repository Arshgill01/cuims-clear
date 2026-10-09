# 0.10.1: the background no longer dies mid-read

0.10.1 is 0.10.0 with one fix. Neither store was published by the agent.

## The bug (0.9.x and 0.10.0)

The popup showed "Could not reach the extension background. Try again." on
Refresh and "Could not open CUIMS. Try again." on Open CUIMS, often again and
again until the extension was disabled and enabled.

Firefox stops an MV3 background page 30 s after the last extension event or
parent API call, even while the popup is waiting for its reply (Chrome's
service worker has the same 30 s rule). A Refresh or a background sign-in on a
slow CUIMS easily runs longer: two 19 s answers are enough. Firefox then
killed the page, and the popup's message failed with "Could not establish
connection. Receiving end does not exist."

The killed run also left its locks in storage: `bgSignInUntil` (the CUIMS tab
held back its own login for 90 s), `attendanceRunUntil` (Refresh answered
"busy" for 2 minutes) and a "working" status. On a slow CUIMS every retry died
the same way, which looked permanent.

## The fix

- `keep-awake.js` (loaded first in both builds): while a task the popup or a
  tab started is running (Refresh, Open CUIMS/LMS, leave-page ingest, the
  refresh after a tab sign-in), the background calls
  `runtime.getPlatformInfo()` every 10 s, which resets the idle timer. It
  stops when the task settles (4-minute ceiling for a task that never does),
  so the background still sleeps when idle.
- A freshly started background clears those stale locks before it talks to
  CUIMS (the task that woke it waits for the cleanup, so its own locks are
  never cleared).
- The popup tries the background twice. If both fail, Open CUIMS / Open LMS
  open their tab directly (CUIMS home; LMS through the `#cuims-clear-lms`
  page hand-off), so those buttons always work. Refresh shows the old message.

No new requests: a retried Refresh still obeys the 60 s gap, budget and
backoff.

## Evidence

Disposable Firefox 157, mocked CUIMS (no live requests), the real package plus
a test-only relay (scratch harness, not committed):

| Case | 0.9.7 / 0.10.0 | 0.10.1 |
| --- | --- | --- |
| Idle 3 s, CUIMS hangs: Refresh | "Receiving end does not exist" at ~4.6 s | answered at 20 s (request timeout) |
| Idle 3 s, CUIMS hangs: Open CUIMS | "Receiving end does not exist" at ~3 s | tab opened |
| Real 30 s idle, CUIMS answers in 19 s: Refresh | killed at 30.05 s, lock left | answered at 38 s, no lock left |
| Stale locks in storage, background wakes | kept | cleared |

The background still suspends once idle in 0.10.1.

Also run: `npm test` (299 pass), `node work/e2e/conservative-smoke.mjs`,
`node work/e2e/ux-browsers.mjs` (both browsers, no errors) and
`node work/e2e/forecast-glitches.mjs` (both browsers, 0 failures).

## Check by hand

1. Load `outputs/dist/cuims-clear-*-0.10.1.zip` in each browser.
2. Firefox: in `about:config`, set `extensions.background.idle.timeout` to
   `5000` to make the bug easy to hit (reset it afterwards).
3. Press Refresh: it finishes with attendance or a CUIMS message, never
   "Could not reach the extension background".
4. Press Open CUIMS and Open LMS: a tab opens each time.
