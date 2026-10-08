# Tidier CUIMS pages, and what CUIMS itself costs

Notes from building `cuims-tidy.js` / `cuims-tidy.css` against the live portal
(signed in with the test login, 8 Oct 2026). Numbers are single samples from a
GCP VM in asia-south2, Chrome for Testing 155; treat them as orders of
magnitude, not benchmarks.

## The timetable markup changed

CUIMS now serves My Time Table as `#grdMain` with the course list in
`#ContentPlaceHolder1_grdCourseDetail`. The parser only knew
`ContentPlaceHolder1_gvMyTimeTable(Details)`, so on every timetable refresh
the background client sent an extra postback and still parsed zero classes:
the popup's Today card stayed empty. `attendance-parse.js` now reads both
markups (`hasTimetable`, `firstTable`), and the live page parses to 36 slots.

## What the tidy layer does

Settings → CUIMS pages → **Tidier pages** (on by default). All styling sits
under `html.cc-tidy`, so switching it off restores CUIMS exactly; the original
timetable stays in the page, hidden.

| Page | Change |
| --- | --- |
| My Time Table | Rows in time order (CUIMS lists 12:50 PM before 9:30 AM). One card per class: subject, Lecture/Lab/Tutorial, room, code and teacher. A colour per subject, matching dots in the course list. Today's column, the class in progress, and finished classes marked; a Now / Next line above; days with no classes dropped. On a phone the week scrolls sideways with the time column pinned, opening on today. |
| My Attendance | Eligible percentage read against the popup's goal (75% or 90%); subjects under it in red with a stripe. Quiet outline View buttons. The duty leave key reads as a footnote. |
| View (one subject) | Present / absent / leave coloured, and a tally above the list ("44 classes · 35 present · 5 absent · 4 on leave"). |
| Marks | Subject code muted; each header carries the running total of marked assessments. Unposted marks are left out. |
| Every inner page | The page title is a heading instead of a full-width banner. |

Works alongside the CUIMS themes: subject stripes are drawn as gradients,
which `cuims-theme.js` leaves alone, and the greys are kept neutral (a faint
blue tint is read as an accent and turns every line the theme's accent).
`tests/cuims-tidy.test.mjs` checks both.

The layer reads only the page it is on. It makes no requests.

## What CUIMS costs per page

| | StudentHome | My Attendance (cold cache) |
| --- | --- | --- |
| Time to first byte | ~430 ms | ~430 ms |
| HTML | 313 KB, of which `__VIEWSTATE` 103 KB | 111 KB, `__VIEWSTATE` 25 KB |
| DOM nodes | ~2,100 | ~930 |
| Requests / bytes | 71 / 465 KB (warm) | 52 / 1.77 MB |
| Slowest call | `DisplaySubjectDetails` WebMethod, ~2 s | — |

- HTML is served without compression (`content-length` equals the decoded
  size). IIS dynamic compression would cut most of every page's bytes.
- `CURobo/robotWalk.png` (the chatbot mascot) is 692 KB and is loaded on every
  inner page; Google Tag Manager adds 175 KB.
- No rate-limit headers are sent (`Microsoft-IIS/10.0`, ASP.NET 4.0.30319). The
  throttle is only visible as behaviour, so its exact numbers were not probed
  here: doing that means deliberately tripping it on a real account.
- Every signed-in page embeds the student's university Outlook one-time
  password in plain text (`#divUniEmail`), so saved pages and screenshots of
  CUIMS need care. None are committed here.

Most of the wait is CUIMS's own server time, which an extension cannot
change; what it can do is make the pages it lands on quicker to read.

## Reproducing

The renders were made by replaying saved pages at their real URLs with the
unpacked Chrome build (scripts stripped, other requests answered 204), so
design work made no requests to CUIMS. The final check ran on the live portal
with CUIMS's own scripts: timetable, attendance, the View overlay and marks,
no page errors.

```sh
npm test                                       # unit tests; the browser test skips
CHROME_BIN=/path/to/chrome npm test            # also the tidy layer in real Chrome
```
