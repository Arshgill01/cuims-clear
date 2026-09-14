(() => {
  if (window.top !== window || !globalThis.CuimsLms) return;
  const { ORIGIN, parseCourse, groupCourses, displayName, nextPages, readCourses, pageCourseUrl } = CuimsLms;
  const DIRECTORY = `${ORIGIN}/my/courses.php`;
  const CUIMS = "https://students.cuchd.in/StudentHome.aspx#cuims-clear-lms";
  const HOME = new Set(["/", "/index.php", "/my", "/my/", "/my/index.php"]);
  let enabled = true;
  let booted = false;
  let groups = [];
  let directory;
  let courseNav;
  let originalHeading;
  let heading;
  let loading = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function link(text, href, className) {
    const node = el("a", className, text);
    node.href = href;
    return node;
  }

  function remaining(queue, visited) {
    return queue.some((url) => !visited.has(url));
  }

  function showCourses(courses, { failed = false, pending = false } = {}) {
    groups = groupCourses(courses);
    if (directory) {
      const status = directory.querySelector(".cc-status");
      directory.querySelector(".cc-count").textContent = `${groups.length} ${groups.length === 1 ? "subject" : "subjects"}`;
      status.replaceChildren();
      if (pending && groups.length) status.textContent = "Loading remaining courses…";
      else if (pending) status.textContent = "Loading courses…";
      else if (failed) {
        status.append(document.createTextNode("Some courses could not be loaded. "));
        const retry = el("button", "cc-text-button", "Try again");
        retry.type = "button";
        retry.addEventListener("click", loadCourses);
        status.append(retry, document.createTextNode(" or "), link("open the original course list", DIRECTORY + "#original"));
        status.lastChild.addEventListener("click", () => setEnabled(false));
      } else if (!groups.length) {
        status.textContent = "No courses found. Use Original view to check your enrolments.";
      }
      renderRows();
    }
    renderCourseNav();
  }

  async function loadCourses() {
    if (loading) return;
    loading = true;
    const courses = readCourses(document);
    const visited = new Set();
    const onDirectory = location.pathname === "/my/courses.php";
    if (onDirectory) visited.add(location.href.split("#")[0]);
    const queue = onDirectory ? nextPages(document, DIRECTORY) : [DIRECTORY];
    showCourses(courses, { pending: remaining(queue, visited) });
    let failed = false;
    try {
      while (queue.length) {
        const url = queue.shift();
        if (visited.has(url)) continue;
        if (visited.size >= 20) throw new Error("Too many course pages");
        visited.add(url);
        const response = await fetch(url, { credentials: "same-origin", signal: AbortSignal.timeout(15000) });
        if (!response.ok || new URL(response.url).origin !== ORIGIN) throw new Error("Courses unavailable");
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        if (doc.querySelector("body.notloggedin, #login, .loginform")) throw new Error("Sign-in required");
        const found = readCourses(doc);
        if (!found.length) throw new Error("Course layout unavailable");
        courses.push(...found);
        queue.push(...nextPages(doc, url).filter((page) => !visited.has(page)));
        showCourses(courses, { pending: remaining(queue, visited) });
      }
    } catch {
      failed = true;
    }
    loading = false;
    showCourses(courses, { failed, pending: false });
  }

  function destination(courses, kind, subject) {
    const cell = el("div", "cc-destination");
    const label = kind === "materials" ? "Syllabus & Materials" : "Semester Work";
    if (!courses.length) {
      cell.append(el("span", "cc-unavailable", `${label}: not listed`));
      return cell;
    }
    courses.forEach((course, index) => {
      const text = courses.length > 1 ? `${label} ${index + 1}` : label;
      const a = link(text, course.url, "cc-course-link");
      a.setAttribute("aria-label", `${text} — ${displayName(subject)}`);
      a.title = course.original;
      const arrow = el("span", "cc-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      a.append(arrow);
      cell.append(a);
      if (courses.length > 1) cell.append(el("small", "cc-source", course.original));
    });
    return cell;
  }

  function renderRows() {
    const query = directory.querySelector("input").value.toLowerCase().trim();
    const list = directory.querySelector(".cc-course-list");
    list.replaceChildren();
    const filtered = groups.filter((group) =>
      [group.name, group.code, ...group.materials.map((c) => c.original), ...group.work.map((c) => c.original)]
        .some((value) => value.toLowerCase().includes(query)),
    );
    for (const group of filtered) {
      const row = el("li", "cc-course-row");
      const subject = el("div", "cc-subject");
      subject.append(el("h2", "", displayName(group.name)), el("span", "cc-code", group.code));
      row.append(subject, destination(group.materials, "materials", group.name), destination(group.work, "work", group.name));
      list.append(row);
    }
    directory.querySelector(".cc-results").textContent = query ? `${filtered.length} of ${groups.length} subjects` : "";
    if (!filtered.length && query) list.append(el("li", "cc-empty", "No matching courses. Try a subject name or course code."));
  }

  function buildDirectory() {
    const region = document.querySelector("#region-main");
    if (!region) return;
    directory = el("section", "cc-directory");
    directory.id = "cc-directory";
    directory.setAttribute("aria-labelledby", "cc-courses-title");
    const header = el("div", "cc-directory-header");
    const title = el("h1", "", "Courses");
    title.id = "cc-courses-title";
    header.append(title, el("span", "cc-count"));
    const search = el("div", "cc-search");
    const label = el("label", "", "Find a course");
    label.htmlFor = "cc-course-search";
    const input = el("input");
    input.id = "cc-course-search";
    input.type = "search";
    input.placeholder = "Subject name or code";
    input.addEventListener("input", renderRows);
    search.append(label, input);
    const columns = el("div", "cc-columns");
    columns.setAttribute("aria-hidden", "true");
    for (const [name, description] of [["Subject", ""], ["Syllabus & Materials", "Syllabus, readings & lessons"], ["Semester Work", "Assignments, tasks & submissions"]]) {
      const col = el("div");
      col.append(el("strong", "", name), el("span", "", description));
      columns.append(col);
    }
    const status = el("p", "cc-status");
    status.setAttribute("role", "status");
    const results = el("p", "cc-results");
    results.setAttribute("role", "status");
    directory.append(header, search, status, columns, el("ul", "cc-course-list"), results);
    region.prepend(directory);
    document.body.classList.add("cc-directory-page");
  }

  function renderCourseNav() {
    if (!heading || !originalHeading || !enabled) return;
    const current = parseCourse(originalHeading, pageCourseUrl(document, location.href));
    if (!current) return;
    heading.textContent = displayName(current.name);
    if (!courseNav) {
      courseNav = el("nav", "cc-course-nav");
      courseNav.setAttribute("aria-label", "Course areas");
      heading.parentElement.append(courseNav);
    }
    courseNav.replaceChildren(el("span", "cc-code", current.code));
    const group = groups.find((g) => g.key === current.key);
    for (const kind of ["materials", "work"]) {
      const courses = group?.[kind] || (kind === current.kind ? [current] : []);
      const cell = destination(courses, kind, current.name);
      for (const a of cell.querySelectorAll("a")) if (a.href === current.url) a.setAttribute("aria-current", "page");
      courseNav.append(cell);
    }
  }

  function setEnabled(value) {
    enabled = value;
    chrome.storage.local.set({ lmsClear: enabled });
    applyMode();
  }

  function applyMode() {
    document.body.classList.toggle("cc-lms", enabled);
    document.documentElement.classList.toggle("cc-lms-pending", false);
    document.documentElement.classList.toggle("cc-lms-original", !enabled);
    const toggle = document.querySelector("#cc-view-toggle");
    if (toggle) {
      toggle.textContent = enabled ? "Original view" : "Clear view";
      toggle.setAttribute("aria-pressed", String(!enabled));
    }
    if (directory) directory.hidden = !enabled;
    if (courseNav) courseNav.hidden = !enabled;
    if (heading && originalHeading) heading.textContent = originalHeading;
    if (enabled) renderCourseNav();
  }

  function init(settings) {
    enabled = settings.lmsClear !== false && location.hash !== "#original";
    if (document.body.matches(".notloggedin") || document.querySelector("#login, .loginform")) {
      document.documentElement.classList.remove("cc-lms-pending");
      if (!document.querySelector(".cc-sign-in")) {
        const login = link("Sign in through CUIMS", CUIMS, "cc-sign-in");
        document.querySelector(".loginform, #login")?.prepend(login);
      }
      return;
    }
    if (enabled && HOME.has(location.pathname)) {
      location.replace(DIRECTORY);
      return;
    }
    if (booted) {
      applyMode();
      return;
    }
    booted = true;
    const toolbar = el("div", "cc-toolbar");
    toolbar.id = "cc-toolbar";
    toolbar.append(link("CUIMS Clear", DIRECTORY, "cc-brand"), link("Courses", DIRECTORY), link("CUIMS ↗", "https://students.cuchd.in/StudentHome.aspx"));
    const toggle = el("button", "", "Original view");
    toggle.id = "cc-view-toggle";
    toggle.type = "button";
    toggle.addEventListener("click", () => setEnabled(!enabled));
    toolbar.append(toggle);
    const region = document.querySelector("#page-header, #region-main");
    if (!region) return;
    region.before(toolbar);
    if (location.pathname === "/my/courses.php") buildDirectory();
    if (location.pathname === "/course/view.php") {
      heading = document.querySelector("#page-header h1, .page-header-headings h1");
      originalHeading = heading?.textContent.trim();
    }
    applyMode();
    if (directory || heading) loadCourses();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.lmsClear) { enabled = changes.lmsClear.newValue !== false; applyMode(); }
    });
  }

  function whenReady(fn) {
    const ready = () =>
      document.querySelector("#region-main, #login, .loginform") || document.body?.matches?.(".notloggedin");
    if (document.body && ready()) {
      fn();
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.body && ready()) {
        observer.disconnect();
        fn();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function start() {
    whenReady(() => {
      const hintedOff = location.hash === "#original" || document.documentElement.classList.contains("cc-lms-original");
      init({ lmsClear: !hintedOff });
      chrome.storage.local.get({ lmsClear: true }, init);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
