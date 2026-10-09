(function (root) {
  const escape = root.CuimsAttendance.escapeHtml;
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  function today(now = new Date()) {
    return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(now).toLowerCase();
  }
  function clock(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  }
  function range(start, end) {
    const first = clock(start), last = clock(end);
    const suffix = first.slice(-2);
    return last.endsWith(suffix) ? first.slice(0, -3) + "–" + last : first + "–" + last;
  }
  function details(label) {
    const raw = String(label || "").replace(/\s+/g, " ").trim();
    const match = raw.match(/::\s*([^:]+):\s*By\s*(.*?)\s+at\s+(.+)$/i);
    return match ? { group: match[1].trim(), teacher: match[2].trim(), room: match[3].trim(), other: "" }
      : { group: "", teacher: "", room: "", other: raw };
  }
  function render(cache, status = {}, { day = "", now = new Date() } = {}) {
    if (!cache) return root.CuimsAttendance.renderFetchEmpty({ id: "fetch-timetable", label: "Fetch timetable", description: "Reads your weekly timetable from CUIMS in the background. No tab opens." }, status);
    const days = root.CuimsTimetable.DAYS;
    const selected = days.includes(day) ? day : today(now);
    const slots = root.CuimsTimetable.sort(cache.slots);
    const buttons = days.map((key, index) => {
      const count = slots.filter(slot => slot.weekday === key).length;
      return `<button id="timetable-${key}" class="timetable-day-button" type="button" role="tab" data-timetable-day="${key}" aria-label="${names[index]}" aria-selected="${key === selected}" aria-controls="timetable-day-panel" tabindex="${key === selected ? 0 : -1}"><span>${names[index].slice(0, 3)}</span><small aria-label="${count} ${count === 1 ? "class" : "classes"}">${count}</small></button>`;
    }).join("");
    const classes = slots.filter(slot => slot.weekday === selected);
    const cards = classes.map(slot => {
      const info = details(slot.rawLabel);
      const kind = { L: "Lecture", P: "Practical", T: "Tutorial" }[slot.kind] || "Class";
      return `<li class="timetable-row"><div class="timetable-time"><time>${clock(slot.start)}</time><span>${clock(slot.end)}</span></div><article class="timetable-class"><div class="timetable-class-head"><div class="timetable-class-title"><h3>${escape(slot.title || slot.shortCode)}</h3>${info.teacher ? `<p class="timetable-teacher">${escape(info.teacher)}</p>` : ""}</div><span class="timetable-kind">${kind}</span></div><div class="timetable-class-meta"><span class="timetable-duration">${range(slot.start, slot.end)}</span>${info.room ? `<span>${escape(info.room)}</span>` : ""}${info.group ? `<span>${escape(info.group)}</span>` : ""}</div>${info.other ? `<p class="timetable-other">${escape(info.other)}</p>` : ""}</article></li>`;
    }).join("");
    return `<div class="timetable-days" role="tablist" aria-label="Timetable weekdays">${buttons}</div><section id="timetable-day-panel" role="tabpanel" aria-labelledby="timetable-${selected}"><h2 class="sr-only">${names[days.indexOf(selected)]} classes</h2>${cards ? `<ol class="timetable-timeline">${cards}</ol>` : `<p class="marks-note timetable-empty">No classes scheduled for ${names[days.indexOf(selected)]}.</p>`}</section>`;
  }
  root.CuimsTimetableView = { render, today };
})(globalThis);
