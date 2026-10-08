// Tidier CUIMS pages. Layout and reading order only: the student's own
// pages keep their data, links and buttons, and nothing is sent anywhere.
//
// - My Time Table: classes in time order (CUIMS lists 12:50 PM before
//   9:30 AM), each class as a short card, today's column and the class in
//   progress marked, and empty days dropped. The original table stays in the
//   page, hidden, and comes back when the switch is turned off.
// - My Attendance: each subject's eligible percentage read against the
//   student's goal, so a subject under it stands out; a subject's
//   class-by-class list gets coloured marks and a tally.
// - Marks: each subject's header carries its running total.
// - Datesheet: the exams still to come, in date order with a countdown,
//   above the table; past exams dimmed, and columns that say nothing
//   (the student's own UID on every row, empty columns) hidden.
// - Everywhere: the sidebar marks the page you are on, tables share one
//   look, and the page is shown as soon as it is ready. CUIMS keeps every
//   page behind a white "Loading..." sheet for a fixed second after it is
//   ready; we lift it at DOMContentLoaded, the way CUIMS itself does later.
//
// The page is restyled by cuims-tidy.css under html.cc-tidy, which is set
// before CUIMS paints and dropped when the switch is off.

(() => {
  if (window.top !== window) return;
  const api = globalThis.CuimsAttendance;
  if (!api) return;
  const KEY = "cuimsTidy";
  const root = document.documentElement;
  const KIND = { L: "Lecture", P: "Lab", T: "Tutorial" };
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  // Ten hues that stay distinct as a thin stripe on white.
  const HUES = ["#4f5bd5", "#0e8a7e", "#c0790b", "#c2416b", "#3f8f3a", "#8a4fd0", "#1f7bbf", "#cf5f1f", "#5b6b8c", "#a8457f"];

  let enabled = true;
  let subjectMin = api.GOALS.standard.subject;
  let clockTimer = 0;

  root.classList.add("cc-tidy");
  // Lets the stylesheet treat StudentHome (the dashboard) apart from inner pages.
  root.dataset.ccPage = location.pathname.replace(/^\/+|\.aspx$/gi, "").toLowerCase() || "home";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clean(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function clock(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  }

  // ---- timetable ----

  // "24CSP-305:P::GP-A: By Ayush Bhardwaj(E20214) at Block-C1-307". A cell
  // can hold more than one class, each starting with its course code.
  function parseClasses(text, titles) {
    const raw = clean(text);
    if (!raw || raw === "-") return [];
    return raw
      .split(/(?=\b[0-9]{2}[A-Z]{2,4}-[0-9]{3}[A-Z]?:)/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const coded = part.match(/^([A-Z0-9-]{2,}):\s*([LPT])\b/i);
        const code = coded ? coded[1].toUpperCase() : "";
        const group = part.match(/::\s*(?:GP-)?([^:]+?)\s*:/i)?.[1] || "";
        return {
          raw: part,
          code,
          kind: coded ? coded[2].toUpperCase() : "",
          title: titles.get(api.normCode(code)) || (code ? "" : part),
          group: /^all$/i.test(group) ? "" : group,
          teacher: part.match(/\bBy\s+(.+?)\s*\(/i)?.[1] || "",
          room: (part.match(/\bat\s+(.+)$/i)?.[1] || "").replace(/^Block[-\s]*/i, ""),
        };
      });
  }

  function courseTitles() {
    const titles = new Map();
    const table = document.querySelector("#ContentPlaceHolder1_grdCourseDetail, #ContentPlaceHolder1_gvMyTimeTableDetails");
    for (const row of table?.rows || []) {
      const [code, title] = [...row.cells].map((cell) => clean(cell.textContent));
      if (code && title && /^[A-Z0-9-]{2,}$/i.test(code)) titles.set(api.normCode(code), title);
    }
    return { table, titles };
  }

  function readGrid(grid, titles) {
    const rows = [...grid.rows];
    const head = rows.find((row) => [...row.cells].some((cell) => DAYS.includes(clean(cell.textContent).slice(0, 3).toLowerCase())));
    if (!head) return null;
    const days = [...head.cells]
      .map((cell, index) => ({ index, day: clean(cell.textContent).slice(0, 3).toLowerCase(), label: clean(cell.textContent) }))
      .filter((entry) => DAYS.includes(entry.day));
    const slots = [];
    for (const row of rows.slice(rows.indexOf(head) + 1)) {
      const cells = [...row.cells];
      const range = api.parseRange(clean(cells[0]?.textContent));
      if (!range) continue;
      slots.push({ ...range, classes: days.map((entry) => parseClasses(cells[entry.index]?.textContent, titles)) });
    }
    slots.sort((a, b) => a.start - b.start || a.end - b.end);
    return { days, slots };
  }

  function card(item, hue, state) {
    const node = el("div", `cc-class${state ? ` is-${state}` : ""}`);
    node.style.setProperty("--cc-hue", hue);
    node.title = item.raw;
    // Non-breaking hyphens, so "Coding-II" never wraps after its hyphen.
    node.append(el("span", "cc-class-title", (item.title || item.code).replace(/-/g, "\u2011")));
    const meta = [KIND[item.kind], item.room].filter(Boolean).join(" · ");
    if (meta) node.append(el("span", "cc-class-meta", meta));
    const who = [item.code, item.teacher].filter(Boolean).join(" · ");
    if (who) node.append(el("span", "cc-class-who", who));
    if (state === "now") node.prepend(el("span", "cc-class-now", "Now"));
    return node;
  }

  function hueFor(code, order) {
    const key = api.normCode(code);
    if (!order.has(key)) order.set(key, HUES[order.size % HUES.length]);
    return order.get(key);
  }

  // One line above the grid: what is on now and what comes next today.
  function nowLine(model, today, minutes, hues) {
    const line = el("p", "cc-tt-now");
    line.setAttribute("aria-live", "polite");
    const column = model.days.findIndex((entry) => entry.day === today);
    if (column < 0) return line;
    const todays = model.slots.flatMap((slot) => slot.classes[column].map((item) => ({ ...item, start: slot.start, end: slot.end })));
    const current = todays.find((item) => item.start <= minutes && minutes < item.end);
    const next = todays.find((item) => item.start > minutes);
    const name = (item) => item.title || item.code;
    const where = (item) => (item.room ? ` in ${item.room}` : "");
    const parts = [];
    if (current) parts.push(["Now", `${name(current)}${where(current)}, until ${clock(current.end)}`, hueFor(current.code, hues)]);
    if (next) parts.push(["Next", `${name(next)}${where(next)} at ${clock(next.start)}`, hueFor(next.code, hues)]);
    if (!parts.length) parts.push(["Today", todays.length ? "No more classes" : "No classes", ""]);
    for (const [label, text, hue] of parts) {
      const chunk = el("span", "cc-tt-now-part");
      if (hue) chunk.style.setProperty("--cc-hue", hue);
      chunk.append(el("b", "", label), el("span", "", text));
      line.append(chunk);
    }
    return line;
  }

  function buildTimetable(grid) {
    const { table: legend, titles } = courseTitles();
    const model = readGrid(grid, titles);
    if (!model || !model.slots.length) return null;
    const hues = new Map();
    // Colours follow the course list, so a subject keeps its colour all week.
    for (const row of legend?.rows || []) {
      const code = clean(row.cells[0]?.textContent);
      if (/^[A-Z0-9-]{2,}$/i.test(code)) hueFor(code, hues);
    }
    const now = api.campusParts(new Date());
    const used = model.days.map((_, column) => model.slots.some((slot) => slot.classes[column].length));
    const shown = model.days.map((entry, column) => ({ ...entry, column })).filter((entry) => used[entry.column]);

    const wrap = el("div", "cc-tt");
    wrap.dataset.day = now.key;
    wrap.append(nowLine(model, now.weekday, now.minutes, hues));
    const scroller = el("div", "cc-tt-scroll");
    const table = el("table", "cc-tt-grid");
    const caption = el("caption", "cc-sr", "Weekly timetable, in time order");
    const headRow = el("tr");
    headRow.append(el("th", "cc-tt-time", "Time"));
    for (const entry of shown) {
      const th = el("th", entry.day === now.weekday ? "is-today" : "", entry.label);
      th.scope = "col";
      if (entry.day === now.weekday) th.append(el("span", "cc-tt-today", "Today"));
      headRow.append(th);
    }
    const thead = el("thead");
    thead.append(headRow);
    const tbody = el("tbody");
    for (const slot of model.slots) {
      if (!shown.some((entry) => slot.classes[entry.column].length)) continue;
      const row = el("tr");
      const time = el("th", "cc-tt-time");
      time.scope = "row";
      time.append(el("span", "cc-tt-start", clock(slot.start)), el("span", "cc-tt-end", clock(slot.end)));
      row.append(time);
      for (const entry of shown) {
        const isToday = entry.day === now.weekday;
        const td = el("td", isToday ? "is-today" : "");
        const state = !isToday ? "" : now.minutes >= slot.end ? "past" : now.minutes >= slot.start ? "now" : "";
        for (const item of slot.classes[entry.column]) td.append(card(item, hueFor(item.code, hues), state));
        row.append(td);
      }
      tbody.append(row);
    }
    table.style.setProperty("--cc-days", String(shown.length));
    table.append(caption, thead, tbody);
    scroller.append(table);
    wrap.append(scroller);
    if (legend) {
      legend.classList.add("cc-tt-legend");
      for (const row of legend.rows) {
        const hue = hues.get(api.normCode(clean(row.cells[0]?.textContent)));
        if (hue) row.style.setProperty("--cc-hue", hue);
      }
    }
    return wrap;
  }

  function tidyTimetable() {
    const grid = document.getElementById("grdMain") || document.getElementById("ContentPlaceHolder1_gvMyTimeTable");
    if (!grid || !/frmMyTimeTable/i.test(location.pathname)) return;
    const previous = grid.previousElementSibling?.classList.contains("cc-tt") ? grid.previousElementSibling : null;
    if (previous && previous.dataset.source === grid.dataset.ccSource) return;
    const built = buildTimetable(grid);
    if (!built) return;
    grid.dataset.ccSource = grid.dataset.ccSource || String(Date.now());
    built.dataset.source = grid.dataset.ccSource;
    grid.classList.add("cc-tt-original");
    if (previous) {
      // A rebuild (the minute clock) keeps wherever the student scrolled.
      const scrolled = previous.querySelector(".cc-tt-scroll")?.scrollLeft || 0;
      previous.replaceWith(built);
      built.querySelector(".cc-tt-scroll").scrollLeft = scrolled;
    } else {
      grid.before(built);
      revealToday(built);
    }
    scheduleClock();
  }

  // On a narrow screen the week scrolls sideways; start at today's column.
  function revealToday(view) {
    const scroller = view.querySelector(".cc-tt-scroll");
    const today = view.querySelector("thead th.is-today");
    if (!scroller || !today || scroller.scrollWidth <= scroller.clientWidth) return;
    const time = view.querySelector("thead .cc-tt-time");
    scroller.scrollLeft = Math.max(0, today.offsetLeft - (time?.offsetWidth || 0));
  }

  // Keep "Now" honest while the page stays open: rebuild at each minute.
  function scheduleClock() {
    clearTimeout(clockTimer);
    clockTimer = setTimeout(() => {
      const view = document.querySelector(".cc-tt");
      if (view) {
        delete view.dataset.source;
        tidyTimetable();
      }
    }, 60000 - (Date.now() % 60000) + 50);
  }

  // ---- attendance ----

  function tidyAttendance() {
    const table = document.getElementById("SortTable");
    if (!table) return;
    table.classList.add("cc-att");
    for (const cell of table.querySelectorAll('td[data-label^="Eligible Percentage"]')) {
      const value = Number.parseFloat(clean(cell.textContent));
      const row = cell.closest("tr");
      const delivered = Number.parseFloat(clean(row.querySelector('td[data-label^="Eligible Delivered"]')?.textContent));
      const low = Number.isFinite(value) && delivered > 0 && value < subjectMin * 100;
      cell.classList.add("cc-att-pct");
      cell.classList.toggle("is-low", low);
      cell.classList.toggle("is-ok", Number.isFinite(value) && delivered > 0 && !low);
      row.classList.toggle("cc-att-low", low);
      if (low) cell.title = `Below your ${Math.round(subjectMin * 100)}% goal`;
      else cell.removeAttribute("title");
    }
  }

  // One subject's class-by-class list (the View overlay): each mark
  // coloured by what it means, and a tally above the list.
  function tidyDetail() {
    const report = document.getElementById("fullreport");
    if (!report) return;
    const count = { present: 0, absent: 0, leave: 0 };
    for (const cell of report.querySelectorAll('td[data-label="Attendance"]')) {
      const text = clean(cell.textContent);
      const kind = /leave/i.test(text) ? "leave" : /^present/i.test(text) ? "present" : /^absent/i.test(text) ? "absent" : "";
      cell.classList.add("cc-mark");
      for (const name of Object.keys(count)) cell.classList.toggle(`is-${name}`, kind === name);
      if (kind) count[kind] += 1;
    }
    const total = count.present + count.absent + count.leave;
    let tally = report.previousElementSibling?.classList.contains("cc-tally") ? report.previousElementSibling : null;
    if (!total) {
      tally?.remove();
      return;
    }
    const text = [`${total} classes`, `${count.present} present`, `${count.absent} absent`, count.leave ? `${count.leave} on leave` : ""].filter(Boolean).join(" · ");
    if (!tally) {
      tally = el("p", "cc-tally");
      report.before(tally);
    }
    if (tally.textContent !== text) tally.textContent = text;
  }

  // ---- datesheet ----

  const SMALL_WORDS = new Set(["and", "in", "of", "for", "the", "to", "with", "on", "a", "an", "at", "by"]);
  // Longer acronyms that turn up in course names, in their usual casing.
  const ACRONYMS = new Map(["IOT:IoT", "DBMS", "DSA", "OOP", "OOPS", "SQL", "API", "AWS", "VLSI", "DSP", "HTML", "CSS", "PHP", "EVS", "SAP", "MST", "CBT", "NLP", "GIS", "CAD"].map((entry) => {
    const [key, value = key] = entry.split(":");
    return [key, value];
  }));

  // "PROJECT BASED LEARNING IN JAVA" -> "Project Based Learning in Java".
  // Roman numerals and two-letter acronyms keep their capitals
  // ("APTITUDE-III", "AI/ML"); names CUIMS already cases are left alone.
  function titleCase(text) {
    const value = clean(text);
    if (value !== value.toUpperCase()) return value;
    return value
      .split(" ")
      .map((word, index) =>
        word
          .split(/([-/&])/)
          .map((part) => {
            const lower = part.toLowerCase();
            if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(lower)) return part;
            if (index > 0 && SMALL_WORDS.has(lower)) return lower;
            if (ACRONYMS.has(part)) return ACRONYMS.get(part);
            if (/^[A-Z]{2}$/.test(part)) return part;
            return lower.charAt(0).toUpperCase() + lower.slice(1);
          })
          .join(""),
      )
      .join(" ");
  }

  function dayCount(fromKey, toKey) {
    return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000);
  }

  function countdown(days) {
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return `in ${days} days`;
  }

  // A column every row leaves empty, or fills with the student's own UID.
  function quietColumns(table, headers) {
    const rows = [...table.rows].slice(1);
    const quiet = [];
    headers.forEach((name, index) => {
      const cells = rows.map((row) => row.cells[index]).filter(Boolean);
      if (!cells.length) return;
      const texts = cells.map((cell) => clean(cell.textContent));
      const visible = cells.some((cell) => cell.querySelector("a, button, select, input:not([type=hidden]), img"));
      const empty = !visible && texts.every((text) => !text);
      const ownUid = /^uid$/i.test(name) && texts.every((text) => text && text === texts[0]);
      if (empty || ownUid) quiet.push(index);
    });
    return quiet;
  }

  function tidyDatesheet() {
    const table = document.querySelector('table[id$="gvStudentDateSheet"]');
    if (!table || table.rows.length < 2) return;
    const headers = [...table.rows[0].cells].map((cell) => clean(cell.textContent));
    const col = (pattern) => headers.findIndex((name) => pattern.test(name));
    const at = { type: col(/^datesheettype$/i), code: col(/^course\s*code$/i), name: col(/^course\s*name$/i), date: col(/^exam\s*date$/i), time: col(/^exam\s*timing$/i), venue: col(/^exam\s*venue$/i), mode: col(/^mode/i) };
    if (at.date < 0 || at.name < 0) return;

    const now = api.campusParts(new Date());
    const exams = [];
    for (const row of [...table.rows].slice(1)) {
      const cells = [...row.cells];
      const key = api.parseDateKey(clean(cells[at.date]?.textContent));
      if (!key) continue;
      const start = api.parseRange(`${clean(cells[at.time]?.textContent)} - 23:59`)?.start ?? null;
      const days = dayCount(now.key, key);
      // An exam counts as past once its day is over.
      const past = days < 0;
      row.classList.toggle("cc-ds-past", past);
      row.classList.remove("cc-ds-next");
      if (past) continue;
      const link = cells[at.venue]?.querySelector("a[href]");
      exams.push({
        row,
        key,
        days,
        start,
        name: titleCase(cells[at.name]?.textContent),
        code: clean(cells[at.code]?.textContent),
        type: clean(cells[at.type]?.textContent),
        venue: link ? "" : clean(cells[at.venue]?.textContent),
        mode: clean(cells[at.mode]?.textContent),
        link,
      });
    }
    exams.sort((a, b) => a.key.localeCompare(b.key) || (a.start ?? 0) - (b.start ?? 0));
    // Every exam on the nearest exam day.
    for (const exam of exams) exam.row.classList.toggle("cc-ds-next", exam.key === exams[0].key);

    const quiet = quietColumns(table, headers);
    for (const row of table.rows) {
      [...row.cells].forEach((cell, index) => {
        cell.classList.toggle("cc-col-quiet", quiet.includes(index));
        cell.classList.toggle("cc-nowrap", index === at.date || index === at.time || index === at.code);
      });
    }

    const signature = exams.map((exam) => `${exam.key}${exam.start}${exam.code}`).join("|") + now.key;
    let strip = table.closest('div[id$="upPnale"]')?.previousElementSibling;
    if (!strip?.classList.contains("cc-ds")) strip = document.querySelector(".cc-ds");
    if (strip?.dataset.signature === signature) return;
    const fresh = el("section", "cc-ds");
    fresh.dataset.signature = signature;
    fresh.setAttribute("aria-label", "Upcoming exams");
    const head = el("p", "cc-ds-head");
    head.append(el("b", "", exams.length ? "Upcoming exams" : "No exams coming up"));
    if (exams.length) head.append(el("span", "", `${exams.length} left on this datesheet`));
    fresh.append(head);
    if (exams.length) {
      const list = el("ol", "cc-ds-list");
      for (const exam of exams) {
        const item = el("li", `cc-ds-exam${exam.days <= 1 ? " is-soon" : ""}`);
        const date = new Date(`${exam.key}T00:00:00Z`);
        const when = el("span", "cc-ds-when");
        when.append(
          el("span", "cc-ds-day", new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short" }).format(date)),
          el("span", "cc-ds-date", new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(date)),
        );
        const body = el("span", "cc-ds-body");
        body.append(el("span", "cc-ds-count", countdown(exam.days)), el("span", "cc-ds-name", exam.name || exam.code));
        // Non-breaking hyphens keep "Online-CBT" on one line.
        const meta = [exam.type, exam.start != null ? clock(exam.start) : "", exam.venue, exam.mode].filter(Boolean).join(" · ").replace(/-/g, "\u2011");
        body.append(el("span", "cc-ds-meta", meta));
        if (exam.link) {
          const open = el("a", "cc-ds-link", "Exam link");
          open.href = exam.link.href;
          open.target = "_blank";
          open.rel = "noreferrer";
          body.append(open);
        }
        item.append(when, body);
        list.append(item);
      }
      fresh.append(list);
    }
    if (strip?.classList.contains("cc-ds")) strip.replaceWith(fresh);
    else (table.closest('div[id$="upPnale"]') || table).before(fresh);
  }

  // ---- everywhere ----

  // The sidebar never shows where you are. Mark the link for this page and
  // the group it sits in.
  function tidyNav() {
    const here = location.pathname.toLowerCase();
    const type = new URLSearchParams(location.search).get("type");
    for (const link of document.querySelectorAll("#menu-content a.a-uims-nav[href]")) {
      let target;
      try {
        target = new URL(link.getAttribute("href").trim(), location.href);
      } catch {
        continue;
      }
      const match = target.pathname.toLowerCase() === here && (!type || target.searchParams.get("type") === type);
      link.classList.toggle("cc-here", match);
      if (!match) continue;
      link.setAttribute("aria-current", "page");
      for (let group = link.closest("ul.sub-menu"); group; group = group.parentElement?.closest("ul.sub-menu")) {
        document.querySelector(`#menu-content li[data-target="#${CSS.escape(group.id)}"]`)?.classList.add("cc-here-group");
      }
    }
  }

  // StudentHome's "My Course & Attendance" card, read against the goal.
  function tidyHome() {
    for (const table of document.querySelectorAll("#div-subject-details table")) {
      for (const row of [...table.rows].slice(1)) {
        const cell = row.cells[row.cells.length - 1];
        const value = Number.parseFloat(clean(cell?.textContent));
        if (!cell || !Number.isFinite(value)) continue;
        // 0 here is a course with no classes held yet, not a failing one.
        const low = value > 0 && value < subjectMin * 100;
        cell.classList.add("cc-att-pct");
        cell.classList.toggle("is-low", low);
        cell.classList.toggle("is-ok", value > 0 && !low);
      }
    }
  }

  // Signed-in pages only (they have the sidebar); the login page is left
  // to content.js.
  function revealEarly() {
    if (document.getElementById("uims_sidebar") && document.getElementById("loader-wrapper")) document.body.classList.add("loaded");
  }

  // ---- marks ----

  function number(text) {
    const value = Number.parseFloat(clean(text));
    return Number.isFinite(value) ? value : null;
  }

  // "Computer Networks (24CST-302)": the code in a quieter span.
  function mutedCode(header) {
    if (header.querySelector(".cc-code")) return;
    const text = [...header.childNodes].reverse().find((node) => node.nodeType === 3 && /\([A-Z0-9-]{2,}\)\s*$/i.test(node.textContent));
    const match = text?.textContent.match(/^([\s\S]*?)\s*\(([A-Z0-9-]{2,})\)\s*$/i);
    if (!match) return;
    text.textContent = `${match[1].trim()} `;
    text.after(el("span", "cc-code", match[2]));
  }

  function tidyMarks() {
    for (const header of document.querySelectorAll("#accordion > h3.ui-accordion-header")) {
      const panel = header.nextElementSibling;
      if (!panel) continue;
      let max = 0;
      let got = 0;
      let counted = 0;
      for (const row of panel.querySelectorAll("tbody tr")) {
        const cells = [...row.cells];
        if (cells.length < 3) continue;
        const outOf = number(cells[cells.length - 2].textContent);
        const scored = number(cells[cells.length - 1].textContent);
        if (outOf == null || scored == null) continue;
        max += outOf;
        got += scored;
        counted += 1;
      }
      let chip = header.querySelector(".cc-score");
      if (!counted) {
        chip?.remove();
        continue;
      }
      const round = (value) => String(Math.round(value * 100) / 100);
      const text = `${round(got)} / ${round(max)}`;
      if (!chip) {
        chip = el("span", "cc-score");
        header.append(chip);
      }
      if (chip.textContent !== text) chip.textContent = text;
      mutedCode(header);
      chip.title = `${counted} assessment${counted === 1 ? "" : "s"} marked so far`;
      header.classList.add("cc-marks-head");
    }
  }

  // ---- lifecycle ----

  let queued = false;
  let navDone = false;
  function run() {
    queued = false;
    if (!enabled || !document.body) return;
    // The sidebar is server-rendered and never changes; mark it once.
    if (!navDone && document.getElementById("menu-content")) {
      tidyNav();
      navDone = true;
    }
    tidyHome();
    tidyTimetable();
    tidyAttendance();
    tidyDetail();
    tidyMarks();
    tidyDatesheet();
  }

  // UpdatePanels and CUIMS's own scripts (the attendance table, the marks
  // accordion) build these after load, so look again whenever nodes arrive.
  // Our own insertions are ignored, so this never feeds itself.
  const ours = (node) => node.nodeType === 1 && (node.classList.contains("cc-tt") || node.classList.contains("cc-score") || node.classList.contains("cc-code") || node.classList.contains("cc-tally") || node.classList.contains("cc-ds"));
  const observer = new MutationObserver((records) => {
    if (queued) return;
    if (!records.some((record) => [...record.addedNodes].some((node) => node.nodeType === 1 && !ours(node)))) return;
    queued = true;
    queueMicrotask(run);
  });

  function setEnabled(value) {
    enabled = value !== false;
    root.classList.toggle("cc-tidy", enabled);
    clearTimeout(clockTimer);
    if (!enabled) return;
    // Back on after a while: rebuild, so Now and Next are current again.
    const view = document.querySelector(".cc-tt");
    if (view) delete view.dataset.source;
    run();
  }

  function start() {
    if (enabled) revealEarly();
    run();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  chrome.storage.local.get({ [KEY]: true, attendanceGoal: "standard" }, (stored) => {
    subjectMin = (api.GOALS[stored.attendanceGoal] || api.GOALS.standard).subject;
    setEnabled(stored[KEY]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.attendanceGoal) subjectMin = (api.GOALS[changes.attendanceGoal.newValue] || api.GOALS.standard).subject;
    if (changes[KEY]) setEnabled(changes[KEY].newValue);
    else if (changes.attendanceGoal) run();
  });
})();
