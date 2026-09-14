import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../outputs/cuims-clear-firefox/lms-model.js', import.meta.url), 'utf8'), context);
const { parseCourse, groupCourses, courseUrl, nextPages, displayName, readCourses, pageCourseUrl } = context.CuimsLms;
const href = (id) => `https://lms.cuchd.in/course/view.php?id=${id}`;

test('pairs CONT materials with 601A and 601-A semester work by subject code', () => {
  for (const marker of ['601A', '601-A']) {
    const groups = groupCourses([
      parseCourse('CONT_24CST-302 :: COMPUTER NETWORKS', href(1)),
      parseCourse(`24CST-302_24BCS_KRG-${marker}_ALL :: Computer Networks`, href(2)),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].materials[0].url, href(1));
    assert.equal(groups[0].work[0].url, href(2));
  }
});

test('does not merge different codes with similar titles or lose duplicate sections', () => {
  const groups = groupCourses([
    parseCourse('CONT_24CST-302 :: NETWORKS', href(1)),
    parseCourse('CONT_24CSP-302 :: NETWORKS', href(2)),
    parseCourse('24CST-302_601A_A :: NETWORKS', href(3)),
    parseCourse('24CST-302_601A_B :: NETWORKS', href(4)),
    parseCourse('24CST-302_601A_A :: NETWORKS', href(3)),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.code === '24CST-302').work.length, 2);
});

test('keeps unpaired and unknown courses accessible without fuzzy matching', () => {
  const groups = groupCourses([
    parseCourse('CONT_24CST-302 :: NETWORKS', href(1)),
    parseCourse('Special Topics', href(2)), parseCourse('Special Topics', href(3)),
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(g => g.code).work.length, 0);
  assert.equal(parseCourse('CONT_24CST-302 :: Study 601A Networks', href(1)).kind, 'materials');
});

test('accepts only real LMS course URLs and strips nonessential parameters', () => {
  assert.equal(courseUrl('/course/view.php?id=2&section=1#test'), href(2));
  for (const url of ['javascript:alert(1)', 'https://evil.test/course/view.php?id=2', '//evil.test/course/view.php?id=2', '/login/logout.php?id=2', '/course/view.php?id=NaN', '/course/view.php?id=0']) {
    assert.equal(courseUrl(url), null);
  }
});

test('pagination is deduplicated and limited to the LMS course directory', () => {
  const links = ['?paged=1', '?paged=1#x', '?paged=2', 'https://evil.test/my/courses.php?paged=3', '/login/logout.php?paged=4', '?paged=-1'];
  const doc = { querySelectorAll: () => links.map(href => ({getAttribute: () => href})) };
  const pages = nextPages(doc, 'https://lms.cuchd.in/my/courses.php');
  assert.equal(pages.length, 2);
  assert.equal(pages[1], 'https://lms.cuchd.in/my/courses.php?paged=2');
});

test('readable titles preserve numerals and existing mixed case', () => {
  assert.equal(displayName('FULL STACK DEVELOPMENT - II'), 'Full Stack Development - II');
  assert.equal(displayName('AI AND SQL'), 'AI And SQL');
  assert.equal(displayName('JavaScript Fundamentals'), 'JavaScript Fundamentals');
});

test('reads cards, native course-list links, and the Moodle enrolment JSON', () => {
  const cards = [
    { dataset: { name: 'CONT_24CST-302 :: COMPUTER NETWORKS', url: href(2) } },
    { dataset: { name: '24CST-302_24BCS_KRG-601A_ALL :: COMPUTER NETWORKS', url: href(3) } },
  ];
  const links = [
    { getAttribute: (name) => name === 'href' ? href(5) : 'CONT_24TDT-312 :: APTITUDE-III', textContent: 'ignored' },
  ];
  const json = [
    { name: 'CONT_24CST-302 :: COMPUTER NETWORKS', url: href(2) },
    { name: 'CONT_24TDP-311 :: SOFT SKILLS-III', url: href(6) },
    { name: 'javascript:alert(1)', url: 'https://evil.test/course/view.php?id=9' },
  ];
  const doc = {
    querySelectorAll: (sel) => {
      if (sel === '.mc-card[data-name][data-url]') return cards;
      if (sel.includes('block_course_list')) return links;
      return [];
    },
    getElementById: (id) => id === 'mc-courses-json' ? { textContent: JSON.stringify(json) } : null,
  };
  const groups = groupCourses(readCourses(doc));
  assert.equal(groups.length, 3);
  assert.equal(groups.find((g) => g.code === '24CST-302').work[0].url, href(3));
  assert.equal(groups.find((g) => g.code === '24TDT-312').materials[0].url, href(5));
  assert.equal(groups.find((g) => g.code === '24TDP-311').materials[0].url, href(6));
});

test('recovers a course URL from the Moodle body class when the query string is missing', () => {
  const doc = { body: { className: 'path-course path-course-view course-124934 context-9' } };
  assert.equal(pageCourseUrl(doc, 'https://lms.cuchd.in/course/view.php'), href(124934));
  assert.equal(pageCourseUrl(doc, 'http://127.0.0.1:8766/course/view.php'), href(124934));
  assert.equal(pageCourseUrl(doc, href(8)), href(8));
  assert.equal(pageCourseUrl({ body: { className: 'path-my course-1' } }, 'https://lms.cuchd.in/my/courses.php'), null);
  assert.equal(pageCourseUrl({ body: { className: 'course-2' } }, 'https://evil.test/login'), null);
});

test('Firefox and Chrome include the same LMS implementation and narrow host access', () => {
  for (const browser of ['firefox', 'chrome']) {
    const root = new URL(`../outputs/cuims-clear-${browser}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
    assert.deepEqual(manifest.host_permissions, ['https://students.cuchd.in/*', 'https://lms.cuchd.in/*']);
    const boot = manifest.content_scripts.find((s) => s.js?.includes("lms-boot.js"));
    const page = manifest.content_scripts.find((s) => s.js?.includes("lms.js"));
    assert.equal(boot.run_at, "document_start");
    assert.deepEqual(boot.css, ["lms.css"]);
    assert.equal(page.run_at, "document_end");
    assert.deepEqual(page.js, ["lms-model.js", "lms.js"]);
    const wrap = manifest.content_scripts.find((s) => s.js?.includes("lms-open-wrap.js"));
    const launch = manifest.content_scripts.find((s) => s.js?.includes("lms-launch.js"));
    assert.equal(wrap.run_at, "document_start");
    assert.equal(wrap.world, "MAIN");
    assert.equal(launch.run_at, "document_start");
    if (browser === "firefox") {
      assert.equal(manifest.background.scripts[0], "lms-open.js");
    } else {
      assert.match(
        readFileSync(new URL("service-worker.js", root), "utf8"),
        /importScripts\("lms-open\.js"\)/,
      );
    }
    for (const name of ["lms.js", "lms-model.js", "lms-launch.js", "lms-boot.js", "lms-open.js", "lms-open-wrap.js", "lms.css"]) {
      assert.equal(readFileSync(new URL(name, root), "utf8"), readFileSync(new URL(`../outputs/cuims-clear-firefox/${name}`, import.meta.url), "utf8"));
    }
  }
});
