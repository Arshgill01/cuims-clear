// Duty Leave without the detours.
//
// Since October 2026 CUIMS's Duty Leave page opens on Internal (event
// registration); applying lives on External, one postback away. And a
// lecture-based application is a chain the page never spells out: Type,
// then Category (or the date is refused), the number of lectures, a date in
// the last three days, each lecture ticked in a hidden drop-down, Next Step,
// and only then the reason, the proof and Save.
//
// - The page goes straight to External, unless the student picked Internal
//   in this tab.
// - A "File duty leave" card above CUIMS's form lists the days CUIMS still
//   accepts, with the classes the student was marked absent in (from the
//   extension's attendance history and timetable) already ticked, and a
//   reason box with the student's past reasons from CUIMS's own history one
//   click away. One button walks CUIMS's own form through those steps, the
//   way the student would, and writes the reason into its Purpose field.
//   The declaration, the proof and Save stay with the student: nothing is
//   submitted for them.

(function (root) {
  const api = root.CuimsAttendance;
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  // CUIMS's date pickers: minDate -3.
  const WINDOW_DAYS = 3;

  const shiftKey = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const weekdayOf = (key) => DAYS[new Date(`${key}T00:00:00Z`).getUTCDay()];

  // The days CUIMS still takes, newest first, each with its classes: what
  // the timetable has that weekday, and what the history marked. Absent
  // classes come ticked; present ones and classes already on leave are left
  // out. `history` is attendanceHistory.subjects ({ code: { marks } }),
  // `slots` the saved timetable, `titles` code -> subject title.
  function planDays({ todayKey, history = {}, slots = [], titles = {} }) {
    const norm = (code) => (api?.normCode ? api.normCode(code) : String(code || "").toUpperCase());
    const titleOf = (code) => titles[norm(code)] || "";
    const days = [];
    for (let back = 0; back <= WINDOW_DAYS; back += 1) {
      const key = shiftKey(todayKey, -back);
      const weekday = weekdayOf(key);
      const byStart = new Map();
      for (const slot of slots) {
        if (slot.weekday !== weekday || !(slot.start >= 0)) continue;
        if (!byStart.has(slot.start)) byStart.set(slot.start, { start: slot.start, end: slot.end ?? null, code: slot.shortCode || "", title: slot.title || titleOf(slot.shortCode), state: "unmarked" });
      }
      for (const [code, entry] of Object.entries(history)) {
        for (const [day, start, kind] of entry?.marks || []) {
          if (day !== key || !(start >= 0)) continue;
          const state = kind === "a" ? "absent" : kind === "p" ? "present" : "leave";
          const known = byStart.get(start);
          if (known) {
            known.state = state;
            known.code ||= code;
            known.title ||= titleOf(code);
          } else byStart.set(start, { start, end: null, code, title: titleOf(code), state });
        }
      }
      const lectures = [...byStart.values()].filter((item) => item.state === "absent" || item.state === "unmarked").sort((a, b) => a.start - b.start);
      days.push({ key, weekday, back, lectures, absent: lectures.filter((item) => item.state === "absent").length });
    }
    return days;
  }

  // "2026-10-29" -> "10/29/2026", the text CUIMS's date pickers write.
  const pickerDate = (key) => `${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(0, 4)}`;

  // "09:30 - 10:20 AM" -> 570
  const startOf = (text) => api?.parseRange?.(text)?.start ?? null;

  root.CuimsDutyLeave = { planDays, pickerDate, startOf, shiftKey, WINDOW_DAYS };

  // `window`, not `root`: in Firefox a content script's globalThis is its
  // sandbox, which is never the top window.
  if (typeof window === "undefined" || window.top !== window || !/\/frmStudentApplyDutyLeave\.aspx$/i.test(location.pathname)) return;

  const INTERNAL_KEY = "ccDlInternal";
  const $ = (id) => document.getElementById(id);
  const ids = {
    internal: "ContentPlaceHolder1_rblType_0",
    external: "ContentPlaceHolder1_rblType_1",
    type: "ContentPlaceHolder1_ddlTypeNew",
    category: "ContentPlaceHolder1_ddlDLSource",
    count: "ContentPlaceHolder1_txtLectureLeave",
    date: "txtDate",
    from: "txtFromDate",
    next: "ContentPlaceHolder1_b",
    picked: "ContentPlaceHolder1_gvSelectedTimes",
    purpose: "ContentPlaceHolder1_txtPurposeofDL",
    panel: "ContentPlaceHolder1_upd",
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const clock = (minutes) => {
    const hour = Math.floor(minutes / 60) % 24;
    return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  };
  // A planned day ({ key, back }) or a job ({ day, back }).
  const dayLabel = (day) => (day.back === 0 ? "Today" : day.back === 1 ? "Yesterday" : new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day.key || day.day}T00:00:00Z`)));

  // ---- straight to External ----

  // The student's own choice of tab sticks for this tab's session.
  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    if (event.target?.id === ids.internal) sessionStorage.setItem(INTERNAL_KEY, "1");
    if (event.target?.id === ids.external) sessionStorage.removeItem(INTERNAL_KEY);
  }, true);

  let switched = false;
  function goExternal() {
    const external = $(ids.external);
    if (switched || !external || external.checked || sessionStorage.getItem(INTERNAL_KEY)) return false;
    switched = true;
    // The radio's own onclick queues CUIMS's postback.
    external.click();
    return true;
  }

  // ---- walking CUIMS's form ----
  //
  // Type and Next Step redraw the form in place (UpdatePanel partial
  // postbacks), but the date boxes have fixed ids (txtDate, txtFromDate),
  // which ASP.NET AJAX cannot match to their panel, so a date reloads the
  // whole page. Filling is therefore a job kept in sessionStorage: each step
  // is chosen from what the form shows now, and a reload picks the job up
  // where it left off.

  const JOB_KEY = "ccDlJob";
  const JOB_MAX_MS = 3 * 60 * 1000;
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

  function readJob() {
    try {
      const job = JSON.parse(sessionStorage.getItem(JOB_KEY) || "null");
      return job && Date.now() - job.at < JOB_MAX_MS ? job : null;
    } catch {
      return null;
    }
  }

  function saveJob(job) {
    if (job) sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
    else sessionStorage.removeItem(JOB_KEY);
  }

  // CUIMS's warnings are SweetAlert modals; one showing means the step failed.
  function alertText() {
    const shown = document.querySelector(".swal-overlay--show-modal .swal-text, .sweet-alert.visible p, .sweet-alert.showSweetAlert p");
    return shown ? shown.textContent.trim() : "";
  }

  // One step that redraws the form: done once the old form is gone and the
  // new one is `ready`. A step that reloads the page never returns here; the
  // job carries on after the reload.
  async function step(trigger, ready, timeoutMs = 30_000) {
    const before = $(ids.type);
    trigger();
    const until = Date.now() + timeoutMs;
    await sleep(250);
    while (Date.now() < until) {
      const warning = alertText();
      if (warning) throw new Error(warning);
      if ((!before || !before.isConnected) && $(ids.type) && ready()) {
        await sleep(200);
        const late = alertText();
        if (late) throw new Error(late);
        return;
      }
      await sleep(150);
    }
    throw new Error("CUIMS took too long to answer. Try once more, or finish the form by hand.");
  }

  function setValue(node, value, change) {
    node.value = value;
    if (change) node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // CUIMS's lecture list for the chosen date: its checkboxes, each with the
  // timing beside it and whether it can still be taken.
  function offeredLectures() {
    return [...document.querySelectorAll("#rcbTime_DropDown li")].map((item) => {
      const box = item.querySelector("input[type=checkbox]");
      const time = item.querySelector("[id$=lblTime]")?.textContent.trim() || "";
      const note = item.querySelector("[id$=lblMsg]")?.textContent.trim() || "";
      return { box, time, start: startOf(time), open: Boolean(box && !box.disabled), note };
    }).filter((entry) => entry.box);
  }

  const pickedCourses = () => [...new Set([...($(ids.picked)?.querySelectorAll("[id*=lblCourseName]") || [])].map((node) => node.textContent.trim()).filter(Boolean))];

  // A date step that came back to the same form twice is not going anywhere.
  function tried(job, stage) {
    job.tries = { ...(job.tries || {}), [stage]: (job.tries?.[stage] || 0) + 1 };
    saveJob(job);
    if (job.tries[stage] > 2) throw new Error("CUIMS did not take the date. Pick it in CUIMS's form below.");
  }

  // Moves the job on from wherever the form is. Answers the outcome once
  // CUIMS's form is filled.
  async function advance(job, report) {
    const date = pickerDate(job.day);
    const warning = alertText();
    if (warning) throw new Error(warning);
    if ($(ids.type).value !== job.mode) {
      report(job.mode === "L" ? "Choosing lecture-based…" : "Choosing a whole day…");
      await step(() => setValue($(ids.type), job.mode, true), () => Boolean($(job.mode === "L" ? ids.date : ids.from)));
    }
    if ($(ids.category).value !== job.category) setValue($(ids.category), job.category);

    if (job.mode === "D") {
      if ($(ids.from)?.value !== date) {
        tried(job, "date");
        report(`Setting ${dayLabel(job)}…`);
        await step(() => setValue($(ids.from), date, true), () => $(ids.from)?.value === date);
      }
      return { count: 0, courses: [], notes: [] };
    }

    if ($(ids.date)?.value !== date || !offeredLectures().length) {
      tried(job, "date");
      report(`Opening ${dayLabel(job)}'s lectures…`);
      await step(() => setValue($(ids.date), date, true), () => $(ids.date)?.value === date && offeredLectures().length > 0);
    }
    const offered = offeredLectures();
    // Nothing known for the day: CUIMS's own list is open for the student.
    if (!job.starts.length) return { count: 0, courses: [], notes: [] };
    const wanted = new Set(job.starts);
    const taken = offered.filter((entry) => entry.open && wanted.has(entry.start));
    const refused = offered.filter((entry) => !entry.open && wanted.has(entry.start));
    const missing = job.starts.filter((start) => !offered.some((entry) => entry.start === start));
    const notes = [];
    if (refused.length) notes.push(`${refused.length} not allowed by CUIMS (${refused[0].note || "already applied"})`);
    if (missing.length) notes.push(`${missing.length} not listed by CUIMS`);
    if (pickedCourses().length) return { count: $(ids.picked).querySelectorAll("tr + tr").length, courses: pickedCourses(), notes };
    if (!taken.length) {
      const why = refused[0]?.note || "CUIMS does not list those lectures for that day";
      throw new Error(`${why}. Pick the lectures in CUIMS's list below.`);
    }
    for (const entry of taken) entry.box.checked = true;
    setValue($(ids.count), String(taken.length));
    report("Adding the lectures…");
    await step(() => $(ids.next).click(), () => Boolean($(ids.picked)?.querySelector("tr + tr")));
    return { count: taken.length, courses: pickedCourses(), notes };
  }

  // ---- the card ----

  let stored = { attendanceHistory: null, attendanceTimetable: null, attendanceSnapshot: null, dlLastCategory: "" };
  const state = { dayKey: "", mode: "L", starts: new Set(), busy: false, purpose: "" };

  // The student's own past reasons, from CUIMS's Duty Leave history on this
  // page (newest first): one event often covers several days.
  function pastReasons() {
    const seen = new Set();
    const reasons = [];
    for (const node of document.querySelectorAll("#gvHistory [id$=lblSubjectRemarks]")) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      reasons.push(text);
      if (reasons.length === 4) break;
    }
    return reasons;
  }

  function categories() {
    return [...($(ids.category)?.options || [])].filter((option) => option.value && option.value !== "0").map((option) => [option.value, option.textContent.trim()]);
  }

  function plan() {
    const titles = {};
    for (const subject of stored.attendanceSnapshot?.subjects || []) titles[api.normCode(subject.code)] = subject.title;
    for (const slot of stored.attendanceTimetable?.slots || []) if (slot.shortCode && slot.title) titles[api.normCode(slot.shortCode)] ||= slot.title;
    return planDays({
      todayKey: api.campusParts(new Date()).key,
      history: stored.attendanceHistory?.subjects || {},
      slots: stored.attendanceTimetable?.slots || [],
      titles,
    });
  }

  function chooseDay(day) {
    Object.assign(state, { dayKey: day.key, message: "", tone: "" });
    state.starts = new Set(day.lectures.filter((item) => item.state === "absent").map((item) => item.start));
  }

  function render() {
    const host = $(ids.panel);
    if (!host || !$(ids.type)) {
      document.querySelector(".cc-dl")?.remove();
      return;
    }
    const days = plan();
    if (!state.dayKey || !days.some((day) => day.key === state.dayKey)) chooseDay(days.find((day) => day.absent) || days[0]);
    const day = days.find((entry) => entry.key === state.dayKey);

    const card = el("section", "cc-dl");
    card.dataset.ccOwn = "";
    card.setAttribute("aria-label", "File duty leave");
    const head = el("div", "cc-dl-head");
    const titles = el("div");
    titles.append(el("h2", "cc-dl-title", "File duty leave"), el("p", "cc-dl-lede", "Pick the day, classes and reason. CUIMS Clear fills CUIMS's form below; you tick the declaration, attach the proof, then Save."));
    head.append(titles);
    card.append(head);

    // Day
    const dayRow = el("div", "cc-dl-days");
    dayRow.setAttribute("role", "radiogroup");
    dayRow.setAttribute("aria-label", "Day");
    for (const entry of days) {
      const chip = el("button", `cc-dl-day${entry.key === state.dayKey ? " is-on" : ""}`);
      chip.type = "button";
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(entry.key === state.dayKey));
      chip.append(el("b", "", dayLabel(entry)), el("span", "", entry.absent ? `${entry.absent} absent` : entry.lectures.length ? `${entry.lectures.length} classes` : "No classes known"));
      chip.addEventListener("click", () => {
        chooseDay(entry);
        render();
      });
      dayRow.append(chip);
    }
    card.append(dayRow);

    // Lectures or the whole day
    const modes = el("div", "cc-dl-modes");
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", "Leave for");
    for (const [value, label] of [["L", "Lectures"], ["D", "Whole day"]]) {
      const button = el("button", `cc-dl-mode${state.mode === value ? " is-on" : ""}`, label);
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(state.mode === value));
      button.addEventListener("click", () => {
        Object.assign(state, { mode: value, message: "", tone: "" });
        render();
      });
      modes.append(button);
    }
    card.append(modes);

    if (state.mode === "L") {
      const list = el("ul", "cc-dl-lectures");
      list.setAttribute("aria-label", `${dayLabel(day)}'s classes`);
      if (!day.lectures.length) {
        list.append(el("li", "cc-dl-none", "No classes known for this day. Fill the form and tick the lectures in CUIMS's list."));
      }
      for (const lecture of day.lectures) {
        const item = el("li");
        const label = el("label", "cc-dl-lecture");
        const box = el("input");
        box.type = "checkbox";
        box.checked = state.starts.has(lecture.start);
        box.addEventListener("change", () => {
          if (box.checked) state.starts.add(lecture.start);
          else state.starts.delete(lecture.start);
          render();
        });
        label.append(box, el("b", "", clock(lecture.start)), el("span", "cc-dl-subject", lecture.title || lecture.code || "Class"), el("span", `cc-dl-state is-${lecture.state}`, lecture.state === "absent" ? "Absent" : "Not marked yet"));
        item.append(label);
        list.append(item);
      }
      card.append(list);
    }

    // Category, remembered
    const field = el("label", "cc-dl-field");
    field.append(el("span", "", "Category"));
    const select = el("select");
    select.append(new Option("Choose the category", ""));
    for (const [value, label] of categories()) select.append(new Option(label, value, false, value === stored.dlLastCategory));
    select.addEventListener("change", () => {
      stored.dlLastCategory = select.value;
      chrome.storage.local.set({ dlLastCategory: select.value });
      render();
    });
    field.append(select);
    card.append(field);

    // Reason, written into CUIMS's "Purpose of Duty Leave"
    const reason = el("label", "cc-dl-field cc-dl-reason");
    reason.append(el("span", "", "Reason"));
    const text = el("textarea");
    text.rows = 2;
    text.value = state.purpose;
    text.placeholder = "What the leave was for, e.g. Attended the Code Yudh hackathon on 28 Oct, 9 AM to 4:30 PM";
    text.addEventListener("input", () => {
      state.purpose = text.value;
    });
    reason.append(text, el("small", "", "Goes into CUIMS's Purpose of Duty Leave. You can still edit it there before saving."));
    card.append(reason);
    const past = pastReasons();
    if (past.length) {
      const chips = el("div", "cc-dl-past");
      chips.setAttribute("aria-label", "Your past reasons");
      chips.append(el("span", "", "Used before"));
      for (const entry of past) {
        const chip = el("button", "cc-dl-past-chip", entry.length > 70 ? `${entry.slice(0, 68)}…` : entry);
        chip.type = "button";
        chip.title = entry;
        chip.addEventListener("click", () => {
          state.purpose = entry;
          render();
          document.querySelector(".cc-dl-reason textarea")?.focus({ preventScroll: true });
        });
        chips.append(chip);
      }
      card.append(chips);
    }

    const foot = el("div", "cc-dl-foot");
    const action = el("button", "cc-dl-go", state.busy ? "Filling…" : "Fill CUIMS's form");
    action.type = "button";
    const picks = state.mode === "L" ? [...state.starts].sort((a, b) => a - b) : [];
    const ready = Boolean(select.value) && (state.mode === "D" || picks.length > 0 || !day.lectures.length);
    action.disabled = state.busy || !ready;
    const status = el("p", "cc-dl-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = state.message || (!select.value ? "Choose a category to continue." : state.mode === "L" && day.lectures.length && !picks.length ? "Tick at least one class." : "");
    if (state.tone) status.dataset.tone = state.tone;
    action.addEventListener("click", () => fill(day, picks, select.value));
    foot.append(action, status);
    card.append(foot);

    const old = document.querySelector(".cc-dl");
    if (old) old.replaceWith(card);
    else host.before(card);
  }

  function fill(day, starts, category) {
    if (state.busy) return;
    const job = { day: day.key, back: day.back, mode: state.mode, starts: state.mode === "L" ? starts : [], category, purpose: state.purpose.trim(), at: Date.now() };
    saveJob(job);
    run(job);
  }

  async function run(job) {
    Object.assign(state, { busy: true, message: "", tone: "", dayKey: job.day, mode: job.mode, purpose: job.purpose || state.purpose });
    if (job.mode === "L") state.starts = new Set(job.starts);
    const report = (message) => {
      state.message = message;
      render();
    };
    report(state.message || "Filling CUIMS's form…");
    try {
      const done = await advance(job, report);
      saveJob(null);
      // Last, once CUIMS has stopped redrawing its form.
      const purpose = $(ids.purpose);
      if (purpose && job.purpose) {
        purpose.value = job.purpose;
        purpose.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const label = dayLabel(job);
      const what = job.mode === "L" && done.count ? `${done.count} ${done.count === 1 ? "lecture" : "lectures"}${done.courses.length ? ` (${done.courses.join(", ")})` : ""}` : label;
      const proof = "tick the declaration, attach the proof (PDF or JPEG, under 1 MB) and Save.";
      const rest = job.purpose && purpose ? `check the reason, ${proof}` : `write the reason, ${proof}`;
      const message = job.mode === "L" && !done.count
        ? `${label} is open in CUIMS's form: tick the lectures in its list, type how many, press Next Step, then ${rest}`
        : `Filled for ${what}.${done.notes.length ? ` ${done.notes.join("; ")}.` : ""} Now ${rest}`;
      Object.assign(state, { tone: "good", message });
      purpose?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      purpose?.focus({ preventScroll: true });
    } catch (error) {
      saveJob(null);
      Object.assign(state, { tone: "bad", message: String(error?.message || error) });
    } finally {
      state.busy = false;
      render();
    }
  }

  // ---- lifecycle ----

  let queued = false;
  function check() {
    queued = false;
    if (goExternal()) return;
    if ($(ids.type) && !document.querySelector(".cc-dl")) render();
    if (!$(ids.type)) document.querySelector(".cc-dl")?.remove();
    // A fill that reloaded the page (a date step) carries on.
    const job = !state.busy && $(ids.type) ? readJob() : null;
    if (job) {
      state.message = "Carrying on…";
      run(job);
    }
  }

  function start() {
    chrome.storage.local.get(stored, (values) => {
      stored = values;
      check();
      // CUIMS redraws its form in place; put the card back if it went.
      new MutationObserver(() => {
        if (queued || state.busy) return;
        queued = true;
        requestAnimationFrame(check);
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(globalThis);
