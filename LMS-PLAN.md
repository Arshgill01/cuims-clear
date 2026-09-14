# LMS expansion

## Scope and direction
Add an authenticated LMS launcher and a courses-first LMS presentation to the existing
Firefox source package and synced Chrome package. Keep the current graphite/lime identity.
Show each subject once with separate Syllabus & Materials and Semester Work links.
Recognize both 601A and 601-A as semester entries; pair by subject code.
Preserve native course activities, submissions, notifications and account controls.

## Execution
- [x] Inspect repository conventions and live enrolled-course markup.
- [x] Inspect CUIMS launch handoff and representative course/activity pages.
- [x] Implement launcher, paired course directory, course styling and original-view escape.
- [x] Add regression coverage for grouping, pagination, URL safety and launcher behavior.
- [x] Validate in Firefox, responsive local fixtures, existing tests and both packages.
- [x] Update product/design/privacy documentation and package development builds.

## Evidence and constraints
No PLANS.md or local AGENTS.md exists. Firefox package is the maintained source;
scripts/sync-chrome-build.sh copies shared code to Chrome. No root package manager.
Live My courses is /my/courses.php, uses .mc-card data-name/data-url, and paginates
with ?paged=1. Native .block_course_list contains additional enrolled course links.
The same enrolments are also listed in #mc-courses-json (14 rows in the captured session,
including CONT materials that were absent from visible cards).
Captured live HTML stays in /tmp and must not be committed (contains account/session data).
Use existing sessions and the site's own handoff; do not persist SSO URLs or tokens.

CUIMS launch contract: `[id$="lbtnLMSSSO"]` inside the dashboard form, `__doPostBack`,
then follow `window.open("https://lms.cuchd.in/...")` from the returned HTML. Tokens
are not stored. Course pages expose `#page-header h1` plus a `course-N` body class;
activities stay native (`.activity-item`, Mark as done, Course/Grades).

## Validation
```
sh scripts/sync-chrome-build.sh
node --test tests/lms-model.test.mjs tests/lms-launch.test.mjs tests/lms-page.test.mjs tests/overlay-suppression.test.mjs tests/dom-lifecycle.test.mjs
node scripts/lms-preview.mjs
```

Local fixtures at http://127.0.0.1:8766/my/courses.php (desktop 1280 and mobile 390),
/course/view.php?id=2, and /login/index.php:

- Directory lists 6 subjects, including 601-A pairing, pagination page 2, JSON enrolments,
  and an unpaired course with "Semester Work: not listed".
- Search for "network" leaves Computer Networks and reports "1 of 6 subjects".
- Original view reveals the native list and pagination; the toggle reads Clear view.
- Course page rewrites `CONT_24CST-302 :: COMPUTER NETWORKS` to Computer Networks and
  shows Syllabus & Materials (current) plus Semester Work. Native activities remain.
- Signed-out LMS login shows "Sign in through CUIMS".

Automated launcher, pairing, popup-placement and fixture checks are green.
Still needs a signed-in Firefox/Chrome pass on the live university SSO after loading
the unpacked 0.6.0 packages.
