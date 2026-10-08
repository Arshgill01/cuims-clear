(function (root) {
  const escape = root.CuimsAttendance.escapeHtml;
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  function clock(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  }
  function render(cache, status = {}) {
    if (!cache) return `<p class="marks-note" role="status">${escape(status.working ? status.phase || "Reading timetable…" : status.error || "Your weekly timetable appears here after one fetch.")}</p>${!status.working ? '<button id="fetch-timetable" class="refresh-button" type="button">'+(status.error ? "Try again" : "Fetch timetable")+'</button>' : ""}`;
    const slots = root.CuimsTimetable.sort(cache.slots);
    if (!slots.length) return '<p class="marks-note">No classes have been published.</p>';
    return root.CuimsTimetable.DAYS.map((day, index) => {
      const classes = slots.filter(slot => slot.weekday === day);
      if (!classes.length) return "";
      return `<section class="timetable-day"><h2>${names[index]}</h2><ol>${classes.map(slot => `<li><time>${clock(slot.start)} – ${clock(slot.end)}</time><strong>${escape(slot.title || slot.shortCode)}</strong><small>${escape([slot.shortCode, {L:"Lecture", P:"Practical", T:"Tutorial"}[slot.kind]].filter(Boolean).join(" · "))}</small>${slot.rawLabel ? `<p>${escape(slot.rawLabel)}</p>` : ""}</li>`).join("")}</ol></section>`;
    }).join("");
  }
  root.CuimsTimetableView = { render };
})(globalThis);
