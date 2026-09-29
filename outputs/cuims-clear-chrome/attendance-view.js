// Attendance tab markup. Every string from the view model is escaped.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  const STATE_LABEL = {
    present: "present",
    absent: "absent",
    pending: "ended, mark not posted yet",
    now: "in progress",
    next: "later today",
  };
  const STATE_GLYPH = { present: "✓", absent: "✕", pending: "…", now: "●", next: "" };
  const KIND = { P: "lab", T: "tutorial" };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clock(iso) {
    const date = new Date(iso || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(date);
  }

  function meter(percent, mark) {
    const fill = Math.max(0, Math.min(100, Number(percent) || 0));
    return `<span class="meter" aria-hidden="true"><span class="meter-fill" style="width:${fill.toFixed(1)}%"></span><span class="meter-mark" style="left:${mark}%"></span></span>`;
  }

  function chip(item) {
    const kind = KIND[item.kind] ? ` ${KIND[item.kind]}` : "";
    const label = `${item.time}${kind} class, ${STATE_LABEL[item.state] || ""}`;
    const glyph = STATE_GLYPH[item.state] ? `<span aria-hidden="true">${STATE_GLYPH[item.state]}</span>` : "";
    return `<li class="chip is-${escapeHtml(item.state)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${glyph}${escapeHtml(item.time)}</li>`;
  }

  // What the line asks of the student: room to skip, classes to make up, or hold.
  function stance(item) {
    if (item.recover > 0) return "recover";
    if (item.skip > 0) return "skip";
    return "hold";
  }

  function subjectRow(subject) {
    const counts = subject.delivered > 0 ? `${subject.attended}/${subject.delivered}` : "—";
    const today = subject.today.length ? `<ul class="chips" aria-label="Today">${subject.today.map(chip).join("")}</ul>` : "";
    return `<li class="course tone-${escapeHtml(subject.tone)}">
      <div class="course-top">
        <span class="course-title" title="${escapeHtml(subject.code)}">${escapeHtml(subject.title)}</span>
        <span class="course-pct">${escapeHtml(api.formatPercent(subject.percent))}</span>
      </div>
      ${meter(subject.percent, 75)}
      <div class="course-bottom">
        <span class="course-line"><span class="counts">${escapeHtml(counts)}</span><span class="line is-${stance(subject)}">${escapeHtml(subject.line)}</span></span>
        ${today}
      </div>
    </li>`;
  }

  function toolbar(analytics, state) {
    const note = state.working
      ? state.phase || "Refreshing…"
      : analytics?.fetchedAt
        ? `Updated ${clock(analytics.fetchedAt)}`
        : "";
    const left = analytics?.overall.left ? ` · ${analytics.overall.left} left today` : "";
    return `<div class="attendance-bar">
      <p class="attendance-note" role="status" aria-live="polite">${escapeHtml(note)}${state.working ? "" : escapeHtml(left)}</p>
      <button id="fetch-attendance" class="refresh-button" type="button"${state.working ? " disabled" : ""}>${state.working ? "Refreshing" : "Refresh"}</button>
    </div>
    ${message(state)}`;
  }

  // Giving way to a CUIMS tab is not a failure, so it reads as a note.
  function message(state) {
    if (!state.error) return "";
    const kind = state.code === "tab-login" ? "attendance-info" : "attendance-error";
    return `<p class="${kind}" role="status">${escapeHtml(state.error)}</p>`;
  }

  function renderAttendance(analytics, state = {}) {
    if (!analytics || !analytics.subjects.length) {
      return `<div class="attendance-empty">
        <p>Reads your attendance from CUIMS in the background. No tab opens.</p>
        <button id="fetch-attendance" class="save-button" type="button"${state.working ? " disabled" : ""}>${escapeHtml(state.working ? state.phase || "Fetching…" : "Fetch attendance")}</button>
        ${message(state)}
      </div>`;
    }
    const overall = analytics.overall;
    return `${toolbar(analytics, state)}
      <section class="overall tone-${escapeHtml(overall.tone)}" aria-label="Overall attendance">
        <div class="course-top">
          <span class="overall-label">Overall</span>
          <span class="overall-pct">${escapeHtml(api.formatPercent(overall.percent))}</span>
        </div>
        ${meter(overall.percent, 90)}
        <p class="course-line"><span class="counts">${escapeHtml(`${overall.attended}/${overall.delivered}`)}</span><span class="line is-${stance(overall)}">${escapeHtml(overall.line)}</span></p>
      </section>
      <ul class="course-list" aria-label="Subjects">${analytics.subjects.map(subjectRow).join("")}</ul>
      <p class="attendance-foot">Skips assume you attend the rest. 75% per subject, 90% overall. A class without a posted mark counts as missed.</p>`;
  }

  api.escapeHtml = escapeHtml;
  api.renderAttendance = renderAttendance;
})(globalThis);
