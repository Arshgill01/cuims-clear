// Marks tab markup. The figures come from marks-model.js (CU's weighting);
// every string is escaped.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const M = root.CuimsMarks;
  const esc = (value) => api.escapeHtml(value);
  const TONE = { good: "high", fair: "tight", low: "low" };
  const LEFT_OUT = {
    "attendance-only": "Only attendance marked, not in the average yet",
    "skill-off": "Not in the average: Aptitude & Soft Skills are off",
    graded: "Graded course, not in the average",
    empty: "Nothing marked yet",
  };

  function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  // The current session first; another kept one (opened on CUIMS) beside it.
  function sessionsOf(saved) {
    const entries = Object.entries(saved?.sessions || {}).map(([value, entry]) => ({ value, ...entry }));
    entries.sort((left, right) => (left.value === saved.current ? -1 : right.value === saved.current ? 1 : Number(right.value) - Number(left.value)));
    return entries;
  }

  function sessionSwitch(entries, chosen) {
    if (entries.length < 2) return "";
    const option = (entry) => `<button type="button" role="radio" data-marks-session="${esc(entry.value)}" aria-checked="${entry.value === chosen}">${esc(M.sessionName(entry))}</button>`;
    return `<div class="goal" role="radiogroup" aria-label="Session">${entries.map(option).join("")}</div>`;
  }

  function hero(summary, entry) {
    const average = summary.average;
    const raw = summary.raw;
    const counted = summary.counted;
    const label = average == null
      ? "No subject has marks to average yet."
      : `Average so far ${M.formatPercent(average)} percent over ${plural(counted, "subject")}; all marks added up ${M.formatPercent(raw.percent)} percent.`;
    return `<section class="fc-hero mk-hero is-${average == null ? "none" : M.band(average) === "low" ? "low" : M.band(average) === "fair" ? "risk" : "good"}" aria-label="${esc(label)}">
      <div class="fc-hero-top">
        <div class="fc-hero-figure">
          <p class="fc-eyebrow">Average so far</p>
          <p class="fc-big">${esc(M.formatPercent(average))}${average == null ? "" : '<span class="fc-unit">%</span>'}</p>
          <p class="fc-range">${counted ? `${esc(plural(counted, "subject"))}, weighted like CU` : "Nothing to average yet"}</p>
        </div>
        ${raw.max > 0 ? `<div class="fc-verdict mk-raw">
          <span class="mk-raw-label">Raw total</span>
          <strong>${esc(M.formatPercent(raw.percent))}%</strong>
          <span>${esc(M.round2(raw.got))} of ${esc(M.round2(raw.max))}</span>
        </div>` : ""}
      </div>
    </section>`;
  }

  function skillsSwitch(summary, includeSkills) {
    if (!summary.skills) return "";
    return `<label class="switch-row mk-skills">
      <span>
        <strong>Count Aptitude & Soft Skills</strong>
        <small>Some programmes grade them, others do not. Shared with Marks View on CUIMS.</small>
      </span>
      <input type="checkbox" role="switch" data-marks-skills${includeSkills ? " checked" : ""} />
    </label>`;
  }

  function kindRows(subject) {
    return subject.kinds
      .map((kind) => `<li><span>${esc(kind.label)}</span><span class="mk-kind-marks">${esc(M.round2(kind.got))}/${esc(M.round2(kind.max))}</span><span class="mk-kind-share">${esc(M.round2(kind.points))} of ${esc(M.round2(kind.weight))}</span></li>`)
      .join("");
  }

  function subjectRow(subject) {
    const band = subject.counts ? M.band(subject.percent) : "";
    const tone = TONE[band] || "none";
    const figure = subject.grade && !subject.items.length ? subject.grade : subject.percent == null ? "—" : `${M.formatPercent(subject.percent)}%`;
    const fill = subject.percent == null ? 0 : Math.max(0, Math.min(100, subject.percent));
    const line = subject.items.length
      ? `<span class="counts">${esc(M.round2(subject.points))}/${esc(M.round2(subject.outOf))}</span><span class="line">${esc(plural(subject.items.length, "assessment"))}${subject.absent ? ` · ${subject.absent} absent` : ""}</span>`
      : `<span class="line mk-quiet">${esc(LEFT_OUT[subject.reason] || "")}</span>`;
    const out = !subject.counts && subject.items.length ? `<p class="course-line mk-out">${esc(LEFT_OUT[subject.reason])}</p>` : "";
    const detail = subject.kinds.length
      ? `<details class="mk-kinds" data-keep="${esc(subject.code || subject.title)}"><summary>How it adds up</summary><ul>${kindRows(subject)}</ul><p class="mk-kinds-raw">As listed on CUIMS: ${esc(M.round2(subject.raw.got))} of ${esc(M.round2(subject.raw.max))}</p></details>`
      : "";
    return `<li class="course mk-course tone-${tone}${subject.counts ? "" : " is-out"}">
      <div class="course-top">
        <span class="course-title" title="${esc(subject.code)}">${esc(subject.title)}</span>
        <span class="course-pct">${esc(figure)}</span>
      </div>
      ${subject.items.length ? `<span class="meter" aria-hidden="true"><span class="meter-fill" style="width:${fill.toFixed(1)}%"></span></span>` : ""}
      <p class="course-line">${line}</p>
      ${out}
      ${detail}
    </li>`;
  }

  function toolbar(entry, state, now) {
    const note = state.working
      ? state.phase || "Refreshing…"
      : entry?.savedAt
        ? `Read ${api.ago(entry.savedAt, now)} from Marks View`
        : "";
    return `<div class="attendance-bar">
      <p class="attendance-note" role="status" aria-live="polite">${esc(note)}</p>
      ${api.refreshButton({ ...state, due: Boolean(entry?.savedAt) && now.getTime() - entry.savedAt > 24 * 60 * 60 * 1000 }, "refresh-button", "Refresh marks", "data-marks-refresh")}
    </div>
    ${api.refreshMessage(state)}
    ${state.waiting && !state.working && !state.error ? `<p class="attendance-info" role="status">Marks View loads a minute after your last CUIMS page. Refresh again shortly, or open Marks View on CUIMS.</p>` : ""}`;
  }

  // `saved` is attendanceExamMarks; `state` carries the refresh state, the
  // chosen session and the Aptitude & Soft Skills switch.
  function renderMarks(saved, state = {}) {
    const now = state.now || new Date();
    const entries = sessionsOf(saved);
    const entry = entries.find((item) => item.value === state.session) || entries[0];
    if (!entry) {
      return `<div class="attendance-empty">
        <p>Reads your marks from CUIMS's Marks View and weighs them the way CU counts internal marks. Opening Marks View on CUIMS also updates this.</p>
        ${api.refreshButton(state, "save-button", "Fetch marks", "data-marks-refresh")}
        ${state.waiting && !state.working && !state.error ? `<p class="attendance-info" role="status">Marks View loads a minute after your last CUIMS page. Try again shortly.</p>` : ""}
        ${api.refreshMessage(state)}
      </div>`;
    }
    const summary = M.summarize(entry.subjects || [], { includeSkills: state.includeSkills !== false });
    return `${toolbar(entry, state, now)}
      ${sessionSwitch(entries, entry.value)}
      ${summary.subjects.length ? hero(summary, entry) : ""}
      ${skillsSwitch(summary, state.includeSkills !== false)}
      ${summary.subjects.length
        ? `<ul class="course-list" aria-label="Subjects">${summary.subjects.map(subjectRow).join("")}</ul>`
        : `<p class="attendance-info">CUIMS has no marks in this session yet.</p>`}
      <p class="attendance-foot">Weighted the way CU counts internal marks: each kind of assessment (MSTs, assignments, surprise tests, experiments) has a fixed share, and repeats split it. A theory course comes out exactly as CU's internal 40. The raw total is every listed mark summed, which CU does not use. ABSENT counts as zero.</p>`;
  }

  api.renderMarks = renderMarks;
  api.marksSessions = sessionsOf;
})(globalThis);
