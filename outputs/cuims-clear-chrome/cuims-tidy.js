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

  // Two cells hold the same class (or the same set of group classes).
  function sameClasses(a, b) {
    return a.length > 0 && a.length === b.length && a.every((item, i) => ["code", "kind", "room", "group"].every((key) => item[key] === b[i][key]));
  }

  // Each day's classes as runs: a class taught over back-to-back periods
  // (a two-period lab) is one run. `rows` are the slots the grid shows.
  function runsByDay(model, rows) {
    return model.days.map((_, column) => {
      const runs = [];
      rows.forEach((slot, row) => {
        const items = slot.classes[column];
        if (!items.length) return;
        const last = runs[runs.length - 1];
        if (last && last.lastRow === row - 1 && slot.start - last.end <= 10 && sameClasses(last.items, items)) {
          last.end = slot.end;
          last.lastRow = row;
          last.periods += 1;
          return;
        }
        runs.push({ items, start: slot.start, end: slot.end, row, lastRow: row, periods: 1 });
      });
      return runs;
    });
  }

  function hueFor(code, order) {
    const key = api.normCode(code);
    if (!order.has(key)) order.set(key, HUES[order.size % HUES.length]);
    return order.get(key);
  }

  const nameOf = (item) => (item.title || item.code || "Class").replace(/-/g, "‑");

  // "40 min", "1 h 05 min"
  function span(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")} min` : ""}`;
  }

  function card(run, item, hue, state) {
    const node = el("div", `cc-class${state ? ` is-${state}` : ""}${run.periods > 1 ? " is-long" : ""}`);
    node.style.setProperty("--cc-hue", hue);
    if (run.periods > 1) node.style.setProperty("--cc-periods", String(run.periods));
    node.title = item.raw;
    if (state === "now") node.append(el("span", "cc-class-now", "Now"));
    // Non-breaking hyphens, so "Coding-II" never wraps after its hyphen.
    node.append(el("span", "cc-class-title", nameOf(item)));
    const meta = el("span", "cc-class-meta");
    if (item.room) meta.append(el("b", "cc-class-room", item.room));
    // A group is worth naming only where the class splits into groups.
    const kind = [KIND[item.kind], item.group && run.items.length > 1 ? `Group ${item.group}` : ""].filter(Boolean).join(" · ");
    if (kind) meta.append(el("span", "cc-class-kind", kind));
    node.append(meta);
    const who = [item.code, item.teacher].filter(Boolean).join(" · ");
    if (who) node.append(el("span", "cc-class-who", who));
    if (run.periods > 1) node.append(el("span", "cc-class-span", `${clock(run.start)} – ${clock(run.end)} · ${run.periods} periods`));
    return node;
  }

  // The campus day `offset` days from today, with whatever the calendar says
  // about it (a holiday, a break, a test week).
  function dayInfo(now, offset, context) {
    const number = api.dayNumberOf?.(now.key);
    const key = number == null ? null : new Date((number + offset) * 86400000).toISOString().slice(0, 10);
    const weekday = DAYS[(DAYS.indexOf(now.weekday) + offset) % 7];
    const reason = key && api.noClassReason ? api.noClassReason(key, context) : null;
    return { key, weekday, offset, reason };
  }

  function dayName(info) {
    if (info.offset === 0) return "Today";
    if (info.offset === 1) return "Tomorrow";
    return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long" }).format(new Date(`${info.key}T00:00:00Z`));
  }

  // The hero above the week: what is on now or next, the day as a line,
  // and what comes after.
  function hero(model, runs, now, hues, context) {
    const wrap = el("section", "cc-tt-hero");
    wrap.dataset.ccOwn = "";
    wrap.setAttribute("aria-label", "Your day");
    const column = (weekday) => model.days.findIndex((entry) => entry.day === weekday);
    const runsOn = (info) => {
      const index = column(info.weekday);
      return index < 0 || (info.reason && info.reason.kind !== "over") ? [] : runs[index];
    };
    const today = dayInfo(now, 0, context);
    const todays = runsOn(today);
    const current = todays.find((run) => run.start <= now.minutes && now.minutes < run.end);
    const later = todays.filter((run) => run.start > now.minutes);
    // The next day with classes, within a week, holidays skipped.
    const skipped = [];
    let ahead = null;
    for (let offset = 1; offset <= 7 && !ahead; offset += 1) {
      const info = dayInfo(now, offset, context);
      if (info.reason?.kind === "over") break;
      if (runsOn(info).length) ahead = info;
      else if (info.reason && column(info.weekday) >= 0 && runs[column(info.weekday)].length) skipped.push(info);
    }

    let label;
    let lead;
    let clockBig;
    let clockSmall;
    let railDay = today;
    let railRuns = todays;
    if (current) {
      lead = current;
      label = `Now · until ${clock(current.end)}`;
      [clockBig, clockSmall] = [span(current.end - now.minutes), "left"];
    } else if (later.length) {
      lead = later[0];
      const first = !todays.some((run) => run.end <= now.minutes);
      label = `${first ? "First class" : "Next"} · ${clock(lead.start)}`;
      [clockBig, clockSmall] = [span(lead.start - now.minutes), "to go"];
    } else if (ahead) {
      lead = runsOn(ahead)[0];
      railDay = ahead;
      railRuns = runsOn(ahead);
      const why = today.reason ? ` (${today.reason.label.replace(/\s*\(.*\)$/, "")})` : "";
      label = `${todays.length ? "Done for today" : `No classes today${why}`} · next ${dayName(ahead).toLowerCase()}`;
      [clockBig, clockSmall] = [clock(lead.start), dayName(ahead)];
    }

    const top = el("div", "cc-hero-top");
    const tag = el("p", `cc-hero-label${current ? " is-live" : ""}`);
    tag.append(el("span", "cc-hero-dot"), el("span", "", label || (today.reason?.kind === "over" ? today.reason.label : "No classes this week")));
    top.append(tag);
    const action = el("button", "cc-hero-action", "Add to calendar");
    action.type = "button";
    action.dataset.ccExport = "classes";
    action.title = "Download your weekly classes as an .ics file, repeating until the last teaching day";
    top.append(action);
    wrap.append(top);

    if (lead) {
      const item = lead.items[0];
      const main = el("div", "cc-hero-main");
      main.style.setProperty("--cc-hue", hueFor(item.code, hues));
      const text = el("div", "cc-hero-text");
      text.append(el("h2", "cc-hero-title", lead.items.map(nameOf).join(" / ")));
      const meta = el("p", "cc-hero-meta");
      if (item.room) meta.append(el("b", "", item.room));
      for (const part of [KIND[item.kind], lead.periods > 1 ? `${clock(lead.start)} – ${clock(lead.end)}` : "", item.teacher]) if (part) meta.append(el("span", "", part));
      text.append(meta);
      const time = el("p", "cc-hero-clock");
      time.append(el("b", "", clockBig), el("span", "", clockSmall));
      main.append(text, time);
      wrap.append(main);
    }

    if (railRuns.length) wrap.append(rail(railRuns, railDay, now, hues));

    const after = [];
    const rest = current ? later : later.slice(1);
    if (rest.length) {
      const next = rest[0];
      after.push(`Then ${nameOf(next.items[0])} at ${clock(next.start)}${next.items[0].room ? ` in ${next.items[0].room}` : ""}`);
      const finish = todays[todays.length - 1].end;
      after.push(`${rest.length} more ${rest.length === 1 ? "class" : "classes"} · done at ${clock(finish)}`);
    } else if (current) {
      after.push("Last class today");
    }
    for (const info of skipped) after.push(`${dayName(info)}: no classes (${info.reason.label.replace(/\s*\(.*\)$/, "")})`);
    if (after.length) {
      const foot = el("p", "cc-hero-foot");
      for (const part of after) foot.append(el("span", "", part));
      wrap.append(foot);
    }
    return wrap;
  }

  // One day as a line: every class to scale, free time between, and where
  // the day is now.
  function rail(runs, info, now, hues) {
    const from = Math.floor(runs[0].start / 60) * 60;
    const to = Math.ceil(runs[runs.length - 1].end / 60) * 60;
    const at = (minutes) => `${(((minutes - from) / (to - from)) * 100).toFixed(3)}%`;
    const wrap = el("div", "cc-rail");
    wrap.setAttribute("aria-hidden", "true");
    const track = el("div", "cc-rail-track");
    const live = info.offset === 0;
    runs.forEach((run, i) => {
      const item = run.items[0];
      const state = !live ? "" : now.minutes >= run.end ? "past" : now.minutes >= run.start ? "now" : "";
      const block = el("div", `cc-rail-block${state ? ` is-${state}` : ""}`);
      block.style.left = at(run.start);
      block.style.width = `calc(${at(run.end)} - ${at(run.start)} - 3px)`;
      block.style.setProperty("--cc-hue", hueFor(item.code, hues));
      block.append(el("b", "", nameOf(item)), el("span", "", [clock(run.start), item.room].filter(Boolean).join(" · ")));
      track.append(block);
      const next = runs[i + 1];
      if (next && next.start - run.end >= 30) {
        const gap = el("div", "cc-rail-gap", `Free ${span(next.start - run.end)}`);
        gap.style.left = at(run.end);
        gap.style.width = `calc(${at(next.start)} - ${at(run.end)} - 3px)`;
        track.append(gap);
      }
    });
    if (live && now.minutes >= from && now.minutes <= to) {
      const needle = el("div", "cc-rail-now");
      needle.style.left = at(now.minutes);
      needle.append(el("span", "", clock(now.minutes).replace(/ [AP]M$/, "")));
      track.append(needle);
    }
    wrap.append(track);
    const ticks = el("div", "cc-rail-ticks");
    for (let minutes = from; minutes <= to; minutes += 60) {
      const tick = el("span", "", String(Math.floor(minutes / 60) % 12 || 12));
      tick.style.left = at(minutes);
      ticks.append(tick);
    }
    wrap.append(ticks);
    return wrap;
  }

  function buildTimetable(grid, context) {
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
    const rows = model.slots.filter((slot) => shown.some((entry) => slot.classes[entry.column].length));
    const runs = runsByDay(model, rows);

    const wrap = el("div", "cc-tt");
    wrap.dataset.ccOwn = "";
    wrap.dataset.day = now.key;
    wrap.append(hero(model, runs, now, hues, context));

    // This week's dates, Monday first, to put on each day and to find holidays.
    const todayIndex = DAYS.indexOf(now.weekday);
    const week = new Map(DAYS.map((day, i) => [day, dayInfo(now, i - todayIndex, context)]));
    const card$ = el("section", "cc-tt-week");
    card$.setAttribute("aria-label", "This week");
    const scroller = el("div", "cc-tt-scroll");
    const table = el("table", "cc-tt-grid");
    const caption = el("caption", "cc-sr", "Weekly timetable, in time order");
    const headRow = el("tr");
    headRow.append(el("th", "cc-tt-time", "Time"));
    for (const entry of shown) {
      const info = week.get(entry.day);
      const off = info?.reason && info.reason.kind !== "over";
      const th = el("th", [entry.day === now.weekday ? "is-today" : "", off ? "is-off" : ""].filter(Boolean).join(" "), entry.label.slice(0, 3));
      th.scope = "col";
      if (info?.key) th.append(el("span", "cc-tt-date", String(Number(info.key.slice(8)))));
      if (off) th.append(el("span", "cc-tt-off", info.reason.label.replace(/\s*\(.*\)$/, "")));
      headRow.append(th);
    }
    const thead = el("thead");
    thead.append(headRow);
    const tbody = el("tbody");
    rows.forEach((slot, row) => {
      const tr = el("tr");
      const time = el("th", "cc-tt-time");
      time.scope = "row";
      time.append(el("span", "cc-tt-start", clock(slot.start)), el("span", "cc-tt-end", clock(slot.end)));
      tr.append(time);
      for (const entry of shown) {
        const dayRuns = runs[entry.column];
        if (dayRuns.some((run) => run.row < row && run.lastRow >= row)) continue;
        const run = dayRuns.find((candidate) => candidate.row === row);
        const isToday = entry.day === now.weekday;
        const info = week.get(entry.day);
        const td = el("td", [isToday ? "is-today" : "", info?.reason && info.reason.kind !== "over" ? "is-off" : ""].filter(Boolean).join(" "));
        if (run) {
          if (run.periods > 1) td.rowSpan = run.lastRow - run.row + 1;
          const state = !isToday ? "" : now.minutes >= run.end ? "past" : now.minutes >= run.start ? "now" : "";
          const stack = el("div", "cc-cell");
          for (const item of run.items) stack.append(card(run, item, hueFor(item.code, hues), state));
          td.append(stack);
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
    table.style.setProperty("--cc-days", String(shown.length));
    table.append(caption, thead, tbody);
    scroller.append(table);
    card$.append(scroller);
    wrap.append(card$);
    if (legend) {
      legend.classList.add("cc-tt-legend");
      for (const row of legend.rows) {
        const hue = hues.get(api.normCode(clean(row.cells[0]?.textContent)));
        if (hue) row.style.setProperty("--cc-hue", hue);
      }
    }
    // For the calendar file: each run once per weekday.
    wrap.ccClasses = shown.flatMap((entry) =>
      runs[entry.column].flatMap((run) => run.items.map((item) => ({ ...item, day: entry.day, start: run.start, end: run.end }))),
    );
    return wrap;
  }

  // Stored choices the timetable and datesheet need for the calendar.
  const calendarContext = { calendar: "cu", exams: [] };

  function exportClasses(view) {
    const exporter = globalThis.CuimsCalendarExport;
    const result = exporter?.classesIcs(view.ccClasses, { todayKey: api.campusParts(new Date()).key, ...calendarContext });
    if (!result) return false;
    exporter.download(result.text, "cuims-classes.ics");
    return result;
  }

  function tidyTimetable() {
    const grid = document.getElementById("grdMain") || document.getElementById("ContentPlaceHolder1_gvMyTimeTable");
    if (!/frmMyTimeTable/i.test(location.pathname)) return;
    if (!grid) {
      document.querySelector(".cc-tt")?.remove();
      clearTimeout(clockTimer);
      return;
    }
    const previous = grid.previousElementSibling?.classList.contains("cc-tt") ? grid.previousElementSibling : null;
    const signature = JSON.stringify([grid.textContent, courseTitles().table?.textContent || "", calendarContext.calendar]);
    if (previous && previous.dataset.source === signature) return;
    const built = buildTimetable(grid, calendarContext);
    if (!built) {
      previous?.remove();
      grid.classList.remove("cc-tt-original");
      clearTimeout(clockTimer);
      return;
    }
    built.dataset.source = signature;
    grid.classList.add("cc-tt-original");
    if (previous) {
      built.classList.add("is-still");
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

  // The calendar buttons on the timetable and the datesheet.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-cc-export]");
    if (!button || !enabled) return;
    const result = button.dataset.ccExport === "classes" ? exportClasses(button.closest(".cc-tt") || {}) : exportExams();
    const was = button.dataset.label || button.textContent;
    button.dataset.label = was;
    button.textContent = result ? `Saved ${result.count} ${button.dataset.ccExport === "classes" ? (result.count === 1 ? "class" : "classes") : result.count === 1 ? "exam" : "exams"} · open the file` : "Nothing to add";
    clearTimeout(button.ccTimer);
    button.ccTimer = setTimeout(() => {
      button.textContent = was;
    }, 4000);
  });

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

  const dateParts = (key) => {
    const date = new Date(`${key}T00:00:00Z`);
    const part = (options) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(date);
    return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
  };

  // Every exam the datesheet lists, once (CUIMS repeats some rows).
  let sheetExams = [];

  function exportExams() {
    const exporter = globalThis.CuimsCalendarExport;
    const today = api.campusParts(new Date()).key;
    const upcoming = sheetExams.filter((exam) => exam.key >= today);
    const result = exporter?.examsIcs(upcoming.map((exam) => ({ day: exam.key, start: exam.start, name: exam.name, code: exam.code, type: exam.type, venue: exam.venue, mode: exam.mode, link: exam.link?.href || "" })));
    if (!result) return false;
    exporter.download(result.text, "cuims-exams.ics");
    return result;
  }

  function examItem(exam, lead) {
    const item = el("li", `cc-ds-exam${exam.days <= 1 ? " is-soon" : ""}${lead ? " is-lead" : ""}`);
    if (lead) item.dataset.ccOwn = "";
    const parts = dateParts(exam.key);
    const stub = el("span", "cc-ds-when");
    stub.append(el("span", "cc-ds-day", parts.weekday), el("span", "cc-ds-date", parts.day), el("span", "cc-ds-month", parts.month));
    const body = el("span", "cc-ds-body");
    const count = el("span", "cc-ds-count", countdown(exam.days));
    // The day of the exam, counted down to the hour.
    if (exam.days === 0 && exam.start != null) {
      const left = exam.start - api.campusParts(new Date()).minutes;
      count.textContent = left > 0 ? `Today · in ${span(left)}` : "Today";
    }
    body.append(count, el("span", "cc-ds-name", exam.name || exam.code));
    // Non-breaking hyphens keep "Online-CBT" on one line.
    const meta = [exam.type, exam.start != null ? clock(exam.start) : "", exam.venue, exam.mode].filter(Boolean).join(" · ").replace(/-/g, "‑");
    body.append(el("span", "cc-ds-meta", meta));
    if (exam.link) {
      const open = el("a", "cc-ds-link", "Exam link");
      open.href = exam.link.href;
      open.target = "_blank";
      open.rel = "noreferrer";
      body.append(open);
    }
    item.append(body, stub);
    return item;
  }

  // The papers of one datesheet (MST-2, say) in order: written, next, to come.
  function progress(exams, type, todayKey) {
    const papers = exams.filter((exam) => exam.type === type).sort((a, b) => a.key.localeCompare(b.key) || (a.start ?? 0) - (b.start ?? 0));
    if (papers.length < 2) return null;
    const done = papers.filter((exam) => exam.key < todayKey).length;
    const wrap = el("div", "cc-ds-run");
    const head = el("p", "cc-ds-run-head");
    head.append(el("b", "", type), el("span", "", done === papers.length ? `all ${papers.length} written` : `${done} of ${papers.length} written`));
    wrap.append(head);
    const list = el("ol", "cc-ds-run-list");
    const nextIndex = papers.findIndex((exam) => exam.key >= todayKey);
    papers.forEach((exam, i) => {
      const state = exam.key < todayKey ? "done" : i === nextIndex ? "next" : "later";
      const node = el("li", `is-${state}`);
      const parts = dateParts(exam.key);
      node.append(el("span", "cc-ds-run-dot"), el("b", "", exam.name || exam.code), el("span", "", `${parts.day} ${parts.month}`));
      node.title = `${exam.name} · ${parts.weekday} ${parts.day} ${parts.month}${exam.start != null ? ` · ${clock(exam.start)}` : ""}`;
      list.append(node);
    });
    wrap.append(list);
    return wrap;
  }

  function tidyDatesheet() {
    const table = document.querySelector('table[id$="gvStudentDateSheet"]');
    let strip = table?.closest('div[id$="upPnale"]')?.previousElementSibling;
    if (!strip?.classList.contains("cc-ds")) strip = document.querySelector(".cc-ds");
    if (!table || table.rows.length < 2) {
      strip?.remove();
      sheetExams = [];
      return;
    }
    const headers = [...table.rows[0].cells].map((cell) => clean(cell.textContent));
    const col = (pattern) => headers.findIndex((name) => pattern.test(name));
    const at = { type: col(/^datesheettype$/i), code: col(/^course\s*code$/i), name: col(/^course\s*name$/i), date: col(/^exam\s*date$/i), time: col(/^exam\s*timing$/i), venue: col(/^exam\s*venue$/i), mode: col(/^mode/i) };
    if (at.date < 0 || at.name < 0) return;

    const now = api.campusParts(new Date());
    const all = [];
    const seen = new Set();
    for (const row of [...table.rows].slice(1)) {
      const cells = [...row.cells];
      // CUIMS lists some papers twice; the copy is hidden.
      const whole = cells.map((cell) => clean(cell.textContent) + (cell.querySelector("a[href]")?.href || "")).join("|");
      const dup = seen.has(whole);
      seen.add(whole);
      row.classList.toggle("cc-ds-dup", dup);
      const key = api.parseDateKey(clean(cells[at.date]?.textContent));
      if (!key) continue;
      const start = api.parseRange(`${clean(cells[at.time]?.textContent)} - 23:59`)?.start ?? null;
      const days = dayCount(now.key, key);
      // An exam counts as past once its day is over.
      const past = days < 0;
      row.classList.toggle("cc-ds-past", past);
      row.classList.remove("cc-ds-next");
      if (dup) continue;
      const link = cells[at.venue]?.querySelector("a[href]");
      all.push({
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
    sheetExams = all;
    const exams = all.filter((exam) => exam.days >= 0);
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

    // The datesheet in play: the nearest exam's, or the latest one written.
    const latest = [...all].sort((a, b) => b.key.localeCompare(a.key))[0];
    const type = exams[0]?.type || latest?.type || "";
    const signature = JSON.stringify([now.key, exams[0]?.days === 0 ? Math.floor(now.minutes / 5) : 0, type, all.map((exam) => [
      exam.key, exam.start, exam.code, exam.name, exam.type, exam.venue, exam.mode, exam.link?.href || "",
    ])]);
    if (strip?.dataset.signature === signature) return;
    const fresh = el("section", "cc-ds");
    fresh.dataset.ccOwn = "";
    fresh.dataset.signature = signature;
    fresh.setAttribute("aria-label", "Upcoming exams");
    const top = el("div", "cc-ds-top");
    const head = el("p", "cc-ds-head");
    head.append(el("b", "", exams.length ? "Upcoming exams" : "No exams coming up"));
    if (exams.length) head.append(el("span", "", `${exams.length} left on this datesheet`));
    top.append(head);
    if (exams.length) {
      const action = el("button", "cc-hero-action is-plain", "Add to calendar");
      action.type = "button";
      action.dataset.ccExport = "exams";
      action.title = "Download your upcoming exams as an .ics file, with reminders the day before and an hour before";
      top.append(action);
    }
    fresh.append(top);
    if (exams.length) {
      const list = el("ol", "cc-ds-list");
      exams.forEach((exam, i) => list.append(examItem(exam, i === 0)));
      fresh.append(list);
    }
    const run = type ? progress(all, type, now.key) : null;
    if (run) fresh.append(run);
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

  const round2 = (value) => String(Math.round(value * 100) / 100);
  const pct = (got, max) => (max > 0 ? (got / max) * 100 : null);
  // Good, fair or low, for a share of marks.
  const band = (share) => (share == null ? "" : share >= 80 ? "good" : share >= 55 ? "fair" : "low");

  // One subject's assessments from its accordion panel. An ABSENT counts as
  // zero of its marks; anything else unposted ("Not posted", blank) is left out.
  function readSubject(header) {
    const panel = header.nextElementSibling;
    const items = [];
    for (const row of panel?.querySelectorAll("tbody tr") || []) {
      const cells = [...row.cells];
      if (cells.length < 3) continue;
      const outOf = number(cells[cells.length - 2].textContent);
      const raw = clean(cells[cells.length - 1].textContent);
      const absent = /^ab(sent)?$/i.test(raw);
      const scored = absent ? 0 : number(raw);
      if (outOf == null || outOf <= 0 || scored == null) continue;
      items.push({ row, cell: cells[cells.length - 1], name: clean(cells[0].textContent), max: outOf, got: scored, absent });
    }
    const codeNode = header.querySelector(".cc-code");
    const text = clean([...header.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" "));
    const match = text.match(/^([\s\S]*?)\s*\(([A-Z0-9-]{2,})\)\s*$/i);
    return {
      header,
      items,
      title: match ? match[1] : text,
      code: codeNode?.textContent || match?.[2] || "",
      max: items.reduce((sum, item) => sum + item.max, 0),
      got: items.reduce((sum, item) => sum + item.got, 0),
      absent: items.filter((item) => item.absent).length,
    };
  }

  // A row's mark as a short bar beside the number.
  function markBar(item) {
    let bar = item.cell.querySelector(".cc-mk-bar");
    const share = pct(item.got, item.max);
    const width = `${Math.max(0, Math.min(100, share)).toFixed(1)}%`;
    if (!bar) {
      bar = el("span", "cc-mk-bar");
      bar.setAttribute("aria-hidden", "true");
      bar.append(el("i"));
      item.cell.append(bar);
    }
    bar.dataset.band = item.absent ? "absent" : band(share);
    if (bar.firstChild.style.width !== width) bar.firstChild.style.width = width;
    item.row.classList.toggle("cc-mk-absent", item.absent);
  }

  function segments(subject) {
    const bar = el("span", "cc-mk-segments");
    bar.setAttribute("aria-hidden", "true");
    for (const item of subject.items) {
      const share = pct(item.got, item.max);
      const seg = el("span", "cc-mk-seg");
      seg.dataset.band = item.absent ? "absent" : band(share);
      seg.style.flexGrow = String(item.max);
      seg.title = `${item.name}: ${item.absent ? "absent" : `${round2(item.got)} / ${round2(item.max)}`}`;
      const fill = el("i");
      fill.style.width = `${Math.max(0, Math.min(100, share)).toFixed(1)}%`;
      seg.append(fill);
      bar.append(seg);
    }
    return bar;
  }

  // Above the accordion: everything marked so far, every subject at a
  // glance, and where the marks went.
  function marksSummary(subjects) {
    const marked = subjects.filter((subject) => subject.items.length);
    if (!marked.length) return null;
    const wrap = el("section", "cc-mk");
    wrap.dataset.ccOwn = "";
    wrap.setAttribute("aria-label", "Marks so far");
    const max = marked.reduce((sum, subject) => sum + subject.max, 0);
    const got = marked.reduce((sum, subject) => sum + subject.got, 0);
    const count = marked.reduce((sum, subject) => sum + subject.items.length, 0);

    const hero = el("div", "cc-mk-hero");
    const total = el("div", "cc-mk-total");
    total.append(el("p", "cc-mk-label", "Marked so far"));
    const big = el("p", "cc-mk-big");
    big.append(el("b", "", (Math.floor(pct(got, max) * 10) / 10).toFixed(1)), el("span", "", "%"));
    total.append(big, el("p", "cc-mk-sub", `${round2(got)} of ${round2(max)} marks · ${count} assessments · ${marked.length} ${marked.length === 1 ? "subject" : "subjects"}`));
    hero.append(total);

    const notes = el("dl", "cc-mk-notes");
    const note = (term, value, detail, tone) => {
      const row = el("div", tone ? `is-${tone}` : "");
      row.append(el("dt", "", term));
      const dd = el("dd");
      dd.append(el("b", "", value));
      if (detail) dd.append(el("span", "", detail));
      row.append(dd);
      notes.append(row);
    };
    const ranked = [...marked].sort((a, b) => pct(b.got, b.max) - pct(a.got, a.max));
    note("Strongest", ranked[0].title, `${Math.round(pct(ranked[0].got, ranked[0].max))}%`, "good");
    if (ranked.length > 1) {
      const weakest = ranked[ranked.length - 1];
      note("Needs the most", weakest.title, `${Math.round(pct(weakest.got, weakest.max))}%`, band(pct(weakest.got, weakest.max)) === "low" ? "low" : "");
    }
    // The single assessment that cost the most marks.
    const dropped = marked.flatMap((subject) => subject.items.map((item) => ({ ...item, subject }))).sort((a, b) => b.max - b.got - (a.max - a.got))[0];
    if (dropped && dropped.max - dropped.got > 0) {
      note("Most marks dropped", `${dropped.subject.title} · ${dropped.name}`, dropped.absent ? `absent, ${round2(dropped.max)} marks` : `${round2(dropped.max - dropped.got)} of ${round2(dropped.max)} lost`, dropped.absent ? "low" : "");
    }
    hero.append(notes);
    wrap.append(hero);

    const grid = el("div", "cc-mk-grid");
    subjects.forEach((subject, index) => {
      const share = pct(subject.got, subject.max);
      const tile = el("button", `cc-mk-subject${subject.items.length ? "" : " is-empty"}`);
      tile.type = "button";
      tile.dataset.ccOpen = String(index);
      tile.dataset.band = band(share);
      const head = el("span", "cc-mk-subject-head");
      const name = el("span", "cc-mk-subject-name");
      name.append(el("b", "", subject.title.replace(/-/g, "‑")), el("span", "", subject.code));
      head.append(name, el("span", "cc-mk-subject-pct", share == null ? "—" : `${Math.round(share)}%`));
      tile.append(head);
      if (subject.items.length) tile.append(segments(subject));
      const foot = el("span", "cc-mk-subject-foot");
      foot.append(el("span", "", subject.items.length ? `${round2(subject.got)} / ${round2(subject.max)}` : "Nothing marked yet"));
      if (subject.items.length) foot.append(el("span", "", `${subject.items.length} ${subject.items.length === 1 ? "assessment" : "assessments"}${subject.absent ? ` · ${subject.absent} absent` : ""}`));
      tile.append(foot);
      tile.setAttribute("aria-label", `${subject.title}: ${share == null ? "nothing marked yet" : `${Math.round(share)} percent, ${round2(subject.got)} of ${round2(subject.max)}`}. Show its marks.`);
      grid.append(tile);
    });
    wrap.append(grid);
    return wrap;
  }

  function tidyMarks() {
    const accordion = document.getElementById("accordion");
    const headers = [...document.querySelectorAll("#accordion > h3.ui-accordion-header")];
    const subjects = [];
    for (const header of headers) {
      if (!header.nextElementSibling) continue;
      mutedCode(header);
      const subject = readSubject(header);
      subjects.push(subject);
      let chip = header.querySelector(".cc-score");
      if (!subject.items.length) {
        chip?.remove();
        continue;
      }
      for (const item of subject.items) markBar(item);
      const text = `${round2(subject.got)} / ${round2(subject.max)}`;
      if (!chip) {
        chip = el("span", "cc-score");
        header.append(chip);
      }
      if (chip.textContent !== text) chip.textContent = text;
      chip.dataset.band = band(pct(subject.got, subject.max));
      chip.title = `${subject.items.length} assessment${subject.items.length === 1 ? "" : "s"} marked so far${subject.absent ? `, ${subject.absent} absent (counted as 0)` : ""}`;
      header.classList.add("cc-marks-head");
    }
    let summary = accordion?.previousElementSibling?.classList.contains("cc-mk") ? accordion.previousElementSibling : document.querySelector(".cc-mk");
    // The summary belongs to Marks View alone; other pages' accordions only get chips.
    if (!accordion || !subjects.length || !/frmStudentMarksView/i.test(location.pathname)) {
      summary?.remove();
      return;
    }
    const signature = JSON.stringify(subjects.map((subject) => [subject.title, subject.code, subject.items.map((item) => [item.name, item.max, item.got, item.absent])]));
    if (summary?.dataset.signature === signature && summary.nextElementSibling === accordion) return;
    const fresh = marksSummary(subjects);
    if (!fresh) {
      summary?.remove();
      return;
    }
    fresh.dataset.signature = signature;
    if (summary) summary.remove();
    accordion.before(fresh);
  }

  // A subject tile opens that subject in CUIMS's own accordion.
  document.addEventListener("click", (event) => {
    const tile = event.target.closest?.(".cc-mk-subject[data-cc-open]");
    if (!tile || !enabled) return;
    const header = document.querySelectorAll("#accordion > h3.ui-accordion-header")[Number(tile.dataset.ccOpen)];
    if (!header) return;
    if (!header.classList.contains("ui-accordion-header-active")) header.click();
    header.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

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
  const ours = (node) => node?.nodeType === 1 && node.closest("[data-cc-own], .cc-tt, .cc-score, .cc-code, .cc-tally, .cc-ds, .cc-mk, .cc-mk-bar");
  const observer = new MutationObserver((records) => {
    if (queued) return;
    if (!records.some((record) => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (ours(target)) return false;
      return record.type !== "childList" || [...record.addedNodes, ...record.removedNodes].some((node) => !ours(node));
    })) return;
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
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ["href"], subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  // The calendar (holidays, the last teaching day) for the timetable's
  // hero and the calendar file.
  function readCalendar(stored) {
    calendarContext.calendar = api.calendarFor?.(stored.academicCalendar, stored.uid) || "cu";
    const exams = stored.attendanceSnapshot?.exams;
    calendarContext.exams = Array.isArray(exams) ? exams : [];
  }

  chrome.storage.local.get({ [KEY]: true, attendanceGoal: "standard", academicCalendar: "auto", uid: "", attendanceSnapshot: null }, (stored) => {
    subjectMin = (api.GOALS[stored.attendanceGoal] || api.GOALS.standard).subject;
    readCalendar(stored);
    setEnabled(stored[KEY]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.attendanceGoal) subjectMin = (api.GOALS[changes.attendanceGoal.newValue] || api.GOALS.standard).subject;
    if (changes.academicCalendar || changes.uid) {
      chrome.storage.local.get({ academicCalendar: "auto", uid: "", attendanceSnapshot: null }, (stored) => {
        readCalendar(stored);
        const view = document.querySelector(".cc-tt");
        if (view) delete view.dataset.source;
        run();
      });
    }
    if (changes[KEY]) setEnabled(changes[KEY].newValue);
    else if (changes.attendanceGoal) run();
  });
})();
