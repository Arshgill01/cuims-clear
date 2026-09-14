/* Shared by the LMS content script and its regression tests. */
(() => {
  const ORIGIN = "https://lms.cuchd.in";

  function courseUrl(value) {
    try {
      const url = new URL(value, ORIGIN);
      const id = url.searchParams.get("id");
      if (url.origin !== ORIGIN || url.pathname !== "/course/view.php" || !/^[1-9]\d*$/.test(id)) return null;
      return `${ORIGIN}/course/view.php?id=${id}`;
    } catch {
      return null;
    }
  }

  function parseCourse(title, href) {
    const url = courseUrl(href);
    const original = title.replace(/\s+/g, " ").trim();
    if (!url || !original) return null;
    const [prefix, ...parts] = original.split(/\s*::\s*/);
    const code = prefix.match(/(?:^|_)(\d{2}[A-Z]{2,5}-\d{3})(?=_|$)/i)?.[1].toUpperCase();
    const name = parts.join(" :: ") || original;
    const kind = /(?:^|[^a-z0-9])601-?A(?=$|[^a-z0-9])/i.test(prefix) ? "work" : "materials";
    // Unknown naming schemes remain separate, even when their display names match.
    return { url, original, code: code || "", name, kind, key: code || url };
  }

  function groupCourses(courses) {
    const groups = new Map();
    const seen = new Set();
    for (const course of courses) {
      if (!course || seen.has(course.url)) continue;
      seen.add(course.url);
      if (!groups.has(course.key)) {
        groups.set(course.key, { key: course.key, code: course.code, name: course.name, materials: [], work: [] });
      }
      groups.get(course.key)[course.kind].push(course);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function displayName(name) {
    if (name !== name.toUpperCase()) return name;
    return name.toLowerCase().replace(/\b[a-z][a-z]*\b/g, (word) => {
      if (/^(ii|iii|iv|vi|vii|viii|ix|ai|iot|dbms|html|css|sql)$/.test(word)) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1);
    });
  }

  function nextPages(doc, base) {
    return [...new Set([...doc.querySelectorAll('a[href*="paged="]')].flatMap((a) => {
      try {
        const url = new URL(a.getAttribute("href"), base);
        if (url.origin !== ORIGIN || url.pathname !== "/my/courses.php" || !/^\d+$/.test(url.searchParams.get("paged"))) return [];
        return [`${ORIGIN}/my/courses.php?paged=${url.searchParams.get("paged")}`];
      } catch { return []; }
    }))];
  }

  function coursesFromJson(doc) {
    const node = doc.getElementById?.("mc-courses-json") || doc.querySelector?.("#mc-courses-json");
    if (!node?.textContent) return [];
    try {
      const rows = JSON.parse(node.textContent);
      if (!Array.isArray(rows)) return [];
      return rows.slice(0, 200).map((row) => parseCourse(row?.name, row?.url)).filter(Boolean);
    } catch {
      return [];
    }
  }

  function readCourses(doc) {
    const cards = [...doc.querySelectorAll(".mc-card[data-name][data-url]")].map((card) =>
      parseCourse(card.dataset.name, card.dataset.url),
    );
    const links = [...doc.querySelectorAll('.block_course_list a[href], [data-region="course-content"] a.coursename')]
      .map((a) => parseCourse(a.getAttribute("title") || a.textContent, a.getAttribute("href")));
    return [...cards, ...coursesFromJson(doc), ...links].filter(Boolean);
  }

  function pageCourseUrl(doc, href) {
    const direct = courseUrl(href);
    if (direct) return direct;
    try {
      const url = new URL(href, ORIGIN);
      if (url.pathname !== "/course/view.php") return null;
    } catch {
      return null;
    }
    const id = doc.body?.className?.match(/(?:^|\s)course-([1-9]\d*)(?:\s|$)/)?.[1];
    return id ? `${ORIGIN}/course/view.php?id=${id}` : null;
  }

  globalThis.CuimsLms = {
    ORIGIN, courseUrl, parseCourse, groupCourses, displayName, nextPages, readCourses, pageCourseUrl,
  };
})();
