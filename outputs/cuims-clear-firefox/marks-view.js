(function (root) {
  const escape = root.CuimsAttendance.escapeHtml;
  function render(cache, sessionId, status = {}) {
    const snapshot = cache?.snapshots?.[sessionId];
    const working = Boolean(status.working);
    const selector = cache ? `<label class="marks-session" for="marks-session">Examination session<select id="marks-session"${working ? " disabled" : ""}>${cache.sessions.map((session) => `<option value="${escape(session.id)}"${session.id === sessionId ? " selected" : ""}>${escape(session.label)}</option>`).join("")}</select></label>` : "";
    const message = working ? `<p role="status" class="marks-note">${escape(status.phase || "Reading regular marks…")}</p>`
      : status.error ? `<p role="status" class="marks-error">${escape(status.error)}</p>` : "";
    const empty = snapshot ? `<p class="marks-note">No marks have been published for this session.</p>`
      : `<p class="marks-note">Your regular examination marks, saved here after one fetch.</p><button id="fetch-marks" class="save-button" type="button"${working ? " disabled" : ""}>${working ? "Fetching marks…" : status.error ? "Try again" : "Fetch marks"}</button>`;
    const subjects = snapshot?.subjects || [];
    const cards = subjects.map((subject, index) => `<details class="marks-subject"${index === 0 ? " open" : ""}>
      <summary>${escape(subject.title)}<small>${subject.exams.length} ${subject.exams.length === 1 ? "assessment" : "assessments"}</small></summary>
      ${subject.exams.length ? `<table><caption class="sr-only">${escape(subject.title)} marks</caption><thead><tr><th scope="col">Assessment</th><th scope="col">Max.</th><th scope="col">Obtained</th></tr></thead><tbody>${subject.exams.map((exam) => `<tr><th scope="row">${escape(exam.name)}</th><td>${escape(exam.maximum || "—")}</td><td>${escape(exam.obtained || "—")}</td></tr>`).join("")}</tbody></table>` : `<p class="marks-note">No marks published yet.</p>`}
    </details>`).join("");
    const savedAt = snapshot ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(snapshot.fetchedAt)) : "";
    return `<div class="marks-head"><h2>Regular marks</h2><a href="https://students.cuchd.in/frmStudentMarksView.aspx" target="_blank" rel="noreferrer">Open page ↗</a></div>${selector}${message}${cards || empty}${snapshot ? `<p class="marks-note marks-cache-note">Saved ${escape(savedAt)}. Reopening this tab uses the saved marks. Clear login also clears marks.</p>` : ""}`;
  }
  root.CuimsMarksView = { render };
})(globalThis);
