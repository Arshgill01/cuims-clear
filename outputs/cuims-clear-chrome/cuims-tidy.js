// Tidier CUIMS pages. Layout and reading order only: the student's own
// pages keep their data, links and buttons, and nothing is sent anywhere.
//
// - My Time Table: classes in time order (CUIMS lists 12:50 PM before
//   9:30 AM), each class as a short card, today's column and the class in
//   progress marked, and empty days dropped. The original table stays in the
//   page, hidden, and comes back when the switch is turned off.
// - My Attendance: each subject's eligible percentage read against the
//   student's goal, so a subject under it stands out.
// - Marks: each subject's header carries its running total.
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

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clean(text) {
    return String(text || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
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
    if (previous) previous.replaceWith(built);
    else grid.before(built);
    revealToday(built);
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
  function run() {
    queued = false;
    if (!enabled || !document.body) return;
    tidyTimetable();
    tidyAttendance();
    tidyMarks();
  }

  // UpdatePanels and CUIMS's own scripts (the attendance table, the marks
  // accordion) build these after load, so look again whenever nodes arrive.
  // Our own insertions are ignored, so this never feeds itself.
  const ours = (node) => node.nodeType === 1 && (node.classList.contains("cc-tt") || node.classList.contains("cc-score") || node.classList.contains("cc-code"));
  const observer = new MutationObserver((records) => {
    if (queued) return;
    if (!records.some((record) => [...record.addedNodes].some((node) => node.nodeType === 1 && !ours(node)))) return;
    queued = true;
    queueMicrotask(run);
  });

  function setEnabled(value) {
    enabled = value !== false;
    root.classList.toggle("cc-tidy", enabled);
    if (enabled) run();
    else clearTimeout(clockTimer);
  }

  function start() {
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
