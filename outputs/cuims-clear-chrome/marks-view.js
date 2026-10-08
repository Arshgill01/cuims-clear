(function (root) {
  const escape = root.CuimsAttendance.escapeHtml;
  function render(cache, status = {}, now = new Date()) {
    const snapshot = cache?.snapshots?.[cache.currentSession];
    const working = Boolean(status.working);
    const updated = snapshot ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(snapshot.fetchedAt)) : "";
    const note = working ? status.phase || "Refreshing…" : snapshot ? `Updated ${updated} (${root.CuimsAttendance.ago(snapshot.fetchedAt, now)})` : "";
    const toolbar = `<div class="attendance-bar"><p class="attendance-note" role="status" aria-live="polite">${escape(note)}</p><button id="fetch-marks" class="refresh-button" type="button"${working ? " disabled" : ""}>${working ? "Refreshing" : "Refresh"}</button></div>`;
    const message = !working && status.error ? `<p role="status" class="marks-error">${escape(status.error)}</p>` : "";
    const empty = snapshot ? `<p class="marks-note">No marks have been published for the current session.</p>`
      : `<p class="marks-note">Your current examination marks appear here.</p>`;
    const subjects = snapshot?.subjects || [];
    const cards = subjects.map((subject) => `<details class="marks-subject">
      <summary>${escape(subject.title)}<small>${subject.exams.length} ${subject.exams.length === 1 ? "assessment" : "assessments"}</small></summary>
      ${subject.exams.length ? `<table><caption class="sr-only">${escape(subject.title)} marks</caption><thead><tr><th scope="col">Assessment</th><th scope="col">Max.</th><th scope="col">Obtained</th></tr></thead><tbody>${subject.exams.map((exam) => `<tr><th scope="row">${escape(exam.name)}</th><td>${escape(exam.maximum || "—")}</td><td>${escape(exam.obtained || "—")}</td></tr>`).join("")}</tbody></table>` : `<p class="marks-note">No marks published yet.</p>`}
    </details>`).join("");
    return `${toolbar}${message}${cards || empty}`;
  }
  root.CuimsMarksView = { render };
})(globalThis);
