// Attendance tab markup. Every string from the view model is escaped.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  const STATE_LABEL = {
    present: "present",
    absent: "absent",
    leave: "on leave",
    pending: "ended, mark not posted yet",
    now: "in progress",
    next: "later today",
  };
  const STATE_GLYPH = { present: "✓", absent: "✕", leave: "L", pending: "…", now: "●", next: "" };
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

  // "just now", "8 min ago", "2 h ago", "yesterday", "3 days ago".
  function ago(iso, now = new Date()) {
    const then = Date.parse(iso || "");
    if (!then) return "";
    const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
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

  // "VDL 7 left · 1 pending", plus pending medical leave when there is any.
  function leaveTags(subject) {
    const leave = subject.leave;
    if (!leave || !(subject.delivered > 0)) return "";
    const tone = leave.vdlLeft === 0 ? " is-out" : leave.vdlLeft <= 2 ? " is-low" : "";
    const pendingVdl = leave.pending.vdl ? ` · ${leave.pending.vdl} pending` : "";
    const title = `${leave.approved.vdl} of ${api.VDL_PER_SUBJECT} voluntary duty leaves approved${leave.pending.vdl ? `, ${leave.pending.vdl} pending` : ""}${subject.ifApproved != null ? `. If approved: ${api.formatPercent(subject.ifApproved)}` : ""}`;
    const vdl = `<span class="tag tag-vdl${tone}" title="${escapeHtml(title)}">VDL ${leave.vdlLeft} left${pendingVdl}</span>`;
    const other = leave.pending.dl - leave.pending.vdl;
    const ml = leave.pending.ml ? `<span class="tag">ML ${leave.pending.ml} pending</span>` : "";
    const rest = other > 0 ? `<span class="tag">DL ${other} pending</span>` : "";
    return vdl + ml + rest;
  }

  function subjectRow(subject, mark) {
    const counts = subject.delivered > 0 ? `${subject.attended}/${subject.delivered}` : "—";
    const tag = leaveTags(subject);
    const today = subject.today.length ? `<ul class="chips" aria-label="Today">${subject.today.map(chip).join("")}</ul>` : "";
    return `<li class="course tone-${escapeHtml(subject.tone)}">
      <div class="course-top">
        <span class="course-title" title="${escapeHtml(subject.code)}">${escapeHtml(subject.title)}</span>
        <span class="course-pct">${escapeHtml(api.formatPercent(subject.percent))}</span>
      </div>
      ${meter(subject.percent, mark)}
      <div class="course-bottom">
        <span class="course-line"><span class="counts">${escapeHtml(counts)}</span><span class="line is-${stance(subject)}">${escapeHtml(subject.line)}</span></span>
        ${tag}${today}
      </div>
    </li>`;
  }

  function goalSwitch(goal) {
    const option = (entry) =>
      `<button type="button" role="radio" data-goal="${entry.id}" aria-checked="${entry.id === goal.id}">${escapeHtml(entry.label)}</button>`;
    return `<div class="goal" role="radiogroup" aria-label="Attendance goal">${Object.values(api.GOALS).map(option).join("")}</div>`;
  }

  function leaveCard(analytics, now) {
    const leave = analytics.overall.leave;
    const approved = leave.approved;
    const waiting = leave.pending;
    const checked = analytics.leavesCheckedAt;
    if (!checked && !approved.vdl && !approved.ml && !approved.other) return "";
    const parts = [];
    if (waiting.dl) parts.push(`${waiting.dl} duty leave`);
    if (waiting.ml) parts.push(`${waiting.ml} medical`);
    const pendingLine = !checked
      ? "Pending leave: open Duty Leave on CUIMS once to check."
      : parts.length
        ? `${parts.join(" · ")} pending`
        : "No pending leave";
    const projection =
      analytics.overall.ifApproved != null
        ? `<p class="leave-if">If approved: ${escapeHtml(api.formatPercent(analytics.overall.percent))} → <strong>${escapeHtml(api.formatPercent(analytics.overall.ifApproved))}</strong></p>`
        : "";
    const counted = [`VDL ${approved.vdl}`, `ML ${approved.ml}`, ...(approved.other ? [`other DL ${approved.other}`] : [])].join(" · ");
    const low = analytics.subjects.filter((subject) => subject.delivered > 0).sort((left, right) => left.leave.vdlLeft - right.leave.vdlLeft)[0];
    return `<section class="leave" aria-label="Leave">
      <div class="section-head"><span class="section-label">Leave</span>${checked ? `<span class="section-meta">checked ${escapeHtml(ago(checked, now))}</span>` : ""}</div>
      <p class="leave-pending${parts.length ? " has-pending" : ""}">${escapeHtml(pendingLine)}</p>
      ${projection}
      <p class="leave-approved">Approved so far: ${escapeHtml(counted)}</p>
      ${low ? `<p class="leave-approved">${api.VDL_PER_SUBJECT} VDL per subject each semester · fewest left: ${escapeHtml(low.title)} (${low.leave.vdlLeft})</p>` : ""}
    </section>`;
  }

  function toolbar(analytics, state, now) {
    const note = state.working
      ? state.phase || "Refreshing…"
      : analytics?.fetchedAt
        ? `Updated ${clock(analytics.fetchedAt)} (${ago(analytics.fetchedAt, now)})`
        : "";
    return `<div class="attendance-bar">
      <p class="attendance-note" role="status" aria-live="polite">${escapeHtml(note)}</p>
      <button id="fetch-attendance" class="refresh-button" type="button"${state.working ? " disabled" : ""}>${state.working ? "Refreshing" : "Refresh"}</button>
    </div>
    ${message(state)}`;
  }

  // Waiting on CUIMS (a tab signing in, its throttle, our own backoff) is not
  // a failure, so it reads as a note, not an error.
  // Problems the student fixes on the Login tab carry a button that goes there.
  const LOGIN_CODES = new Set(["needs-login", "bad-password", "bad-uid"]);
  const GOTO_LOGIN = ` <button type="button" class="text-button" data-goto="login">Open Login</button>`;

  function message(state) {
    if (!state.error) return "";
    const calm = new Set(["tab-login", "portal-busy", "backoff", "busy", "cooldown"]);
    const kind = calm.has(state.code) ? "attendance-info" : "attendance-error";
    const jump = LOGIN_CODES.has(state.code) ? GOTO_LOGIN : "";
    return `<p class="${kind}" role="status">${escapeHtml(state.error)}${jump}</p>`;
  }

  function overallStance(analytics) {
    if (analytics.goal.overall) return stance(analytics.overall);
    return analytics.subjects.some((row) => row.recover > 0) ? "recover" : "skip";
  }

  function renderAttendance(analytics, state = {}) {
    if (!analytics || !analytics.subjects.length) {
      return `<div class="attendance-empty">
        <p>Reads your attendance from CUIMS in the background. No tab opens.</p>
        <button id="fetch-attendance" class="save-button" type="button"${state.working ? " disabled" : ""}>${escapeHtml(state.working ? state.phase || "Fetching…" : "Fetch attendance")}</button>
        ${state.needsLogin && !state.working && !state.error ? `<p class="attendance-info">Signed out of CUIMS? Save your UID and password first, so the fetch can sign in.${GOTO_LOGIN}</p>` : ""}
        ${message(state)}
      </div>`;
    }
    const now = state.now || new Date();
    const goal = analytics.goal;
    const overall = analytics.overall;
    const subjectMark = Math.round(goal.subject * 100);
    const overallMark = Math.round((goal.overall || goal.subject) * 100);
    const rule = goal.overall ? `${subjectMark}% per subject and ${overallMark}% overall` : `${subjectMark}% in every subject`;
    return `${toolbar(analytics, state, now)}
      ${goalSwitch(goal)}
      <section class="overall tone-${escapeHtml(overall.tone)}" aria-label="Overall attendance">
        <div class="course-top">
          <span class="overall-label">Overall</span>
          <span class="overall-pct">${escapeHtml(api.formatPercent(overall.percent))}</span>
        </div>
        ${meter(overall.percent, overallMark)}
        <p class="course-line"><span class="counts">${escapeHtml(`${overall.attended}/${overall.delivered}`)}</span><span class="line is-${overallStance(analytics)}">${escapeHtml(overall.line)}</span></p>
      </section>
      ${leaveCard(analytics, now)}
      <ul class="course-list" aria-label="Subjects">${analytics.subjects.map((subject) => subjectRow(subject, subjectMark)).join("")}</ul>
      <p class="attendance-foot">Goal: ${escapeHtml(rule)}. Skips assume you attend the rest, and a class without a posted mark counts as missed. Approved leave drops a class from the count; pending leave counts as absent until approved. Forecast plans skips and projects your semester.</p>`;
  }

  // Shared first-fetch layout for the Marks and Timetable popup views.
  function renderFetchEmpty(feature, state = {}) {
    const needsLogin = !state.working && (state.needsLogin || state.code === "needs-login");
    const notice = state.working ? { ...state, error: "" } : needsLogin
      ? { ...state, error: "Save your UID and password on the Login tab first.", code: "needs-login" } : state;
    return '<div class="attendance-empty"><p>' + escapeHtml(feature.description) + '</p>'
      + '<button id="' + feature.id + '" class="save-button" type="button"' + (state.working ? ' disabled' : '') + '>'
      + escapeHtml(state.working ? state.phase || "Fetching…" : feature.label) + '</button>'
      + message(notice) + '</div>';
  }

  api.renderFetchEmpty = renderFetchEmpty;
  api.escapeHtml = escapeHtml;
  api.ago = ago;
  api.renderAttendance = renderAttendance;
})(globalThis);
