// Forecast tab markup and its charts. Every string from the view model is
// escaped; charts are inline SVG drawn with the theme's own colours.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const KIND = { P: "lab", T: "tutorial" };
  const VERDICT = { "can-skip": "Can skip", "make-up": "Can make up", attend: "Attend", planned: "Skipping", "planned-make-up": "Skipping", "too-many": "Too many" };
  const WHOLE = { safe: "safe", "make-up": "can make up", over: "too many" };
  const DAY_FULL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Chart series by chart id, for the crosshair. Refilled on every render.
  const charts = new Map();

  const esc = (value) => api.escapeHtml(value);

  function pct(value, digits = 1) {
    if (value == null || !Number.isFinite(value)) return "—";
    const factor = 10 ** digits;
    return `${(Math.round(value * factor) / factor).toFixed(digits)}%`;
  }

  function whole(ratio) {
    return `${Math.round(ratio * 100)}%`;
  }
  const whole_ = whole;

  // Rounded to 5, never "0%" or "100%": the model is not that sure.
  function chanceText(chance) {
    if (chance >= 0.995) return "over 95%";
    if (chance <= 0.005) return "under 5%";
    const value = Math.round((chance * 100) / 5) * 5;
    return value >= 100 ? "over 95%" : value <= 0 ? "under 5%" : `${value}%`;
  }

  function chanceState(result) {
    if (!result) return "none";
    if (!result.reachable) return "out";
    if (result.chance >= 0.8) return "good";
    if (result.chance >= 0.5) return "lean";
    if (result.chance >= 0.2) return "risk";
    return "low";
  }

  const STATE_WORD = { good: "On track", lean: "Leaning yes", risk: "At risk", low: "Unlikely", out: "Out of reach", none: "No classes" };
  const STATE_ICON = { good: "✓", lean: "↗", risk: "!", low: "↘", out: "✕", none: "–" };

  function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : noun.endsWith("s") ? "es" : "s"}`;
  }

  function dateOf(x) {
    return api.dayLabel(Math.floor(x));
  }

  // "about 1 a week", "about 1 every 3 weeks".
  function pacing(perWeek) {
    if (!(perWeek > 0)) return "";
    if (perWeek >= 1.5) return `about ${Math.floor(perWeek)} a week`;
    if (perWeek >= 0.75) return "about 1 a week";
    const weeks = Math.max(2, Math.round(1 / perWeek));
    return `about 1 every ${weeks} weeks`;
  }

  // ---- charts ----

  function niceStep(span) {
    return span > 30 ? 10 : span > 12 ? 5 : 2;
  }

  // One line chart: attendance so far (solid), the pace forecast (dashed)
  // inside its likely range, the attend-everything line (dotted), and the
  // goal. Returns SVG markup and keeps the series for the crosshair.
  function lineChart(id, series, { height = 132, width = 320 } = {}) {
    const past = series.past || [];
    const future = (series.future?.points || []).slice(past.length ? 1 : 0);
    const goal = series.future?.goal ?? 75;
    const all = [...past.map((point) => point.value), ...future.flatMap((point) => [point.low, point.high, point.best]), goal];
    if (!all.length || (!past.length && !future.length)) return "";
    let min = Math.min(...all);
    let max = Math.max(...all);
    min = Math.max(0, Math.floor(min - 2));
    max = Math.min(100, Math.ceil(max + 2));
    if (max - min < 10) {
      const grow = (10 - (max - min)) / 2;
      min = Math.max(0, Math.floor(min - grow));
      max = Math.min(100, Math.ceil(max + grow));
    }
    const xs = [...past.map((point) => point.x), ...future.map((point) => point.x)];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs, x0 + 1);
    const pad = { left: 2, right: 42, top: 10, bottom: 20 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const sx = (x) => pad.left + ((x - x0) / (x1 - x0)) * plotW;
    const sy = (value) => pad.top + (1 - (value - min) / (max - min)) * plotH;
    const f = (value) => value.toFixed(1);
    const path = (points, pick) => points.map((point, index) => `${index ? "L" : "M"}${f(sx(point.x))} ${f(sy(pick(point)))}`).join("");

    const step = niceStep(max - min);
    const endValue = future.length ? future[future.length - 1].mid : null;
    const grid = [];
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
      if (Math.abs(value - goal) < step / 2) continue;
      // The forecast's end label sits on the right edge; its tick gives way.
      if (endValue != null && Math.abs(sy(value) - sy(endValue)) < 11) continue;
      grid.push(`<line class="fc-grid" x1="${pad.left}" x2="${f(pad.left + plotW)}" y1="${f(sy(value))}" y2="${f(sy(value))}"/><text class="fc-axis" x="${f(width - 2)}" y="${f(sy(value) + 3.5)}" text-anchor="end">${value}</text>`);
    }

    // Month ticks along the bottom.
    const ticks = [];
    const first = new Date(x0 * 86_400_000);
    for (let cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); cursor.getTime() / 86_400_000 <= x1; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
      const x = sx(cursor.getTime() / 86_400_000);
      if (x < 12 || x > pad.left + plotW - 12) continue;
      ticks.push(`<line class="fc-tick" x1="${f(x)}" x2="${f(x)}" y1="${f(pad.top + plotH)}" y2="${f(pad.top + plotH + 3)}"/><text class="fc-axis" x="${f(x)}" y="${height - 5}" text-anchor="middle">${MONTHS[cursor.getUTCMonth()]}</text>`);
    }

    const band = future.length
      ? `<path class="fc-band" d="${path([...(past.length ? [{ x: past[past.length - 1].x, low: past[past.length - 1].value }] : []), ...future], (point) => point.low)}${future
          .slice()
          .reverse()
          .map((point) => `L${f(sx(point.x))} ${f(sy(point.high))}`)
          .join("")}Z"/>`
      : "";
    const join = past.length ? [{ x: past[past.length - 1].x, mid: past[past.length - 1].value, best: past[past.length - 1].value }] : [];
    const last = future[future.length - 1];
    const now = past[past.length - 1];
    const goalY = sy(goal);
    const endY = last ? sy(last.mid) : null;
    // The goal label moves off the end value when they would touch.
    const goalLabelY = endY != null && Math.abs(endY - goalY) < 11 ? (endY > goalY ? goalY - 4 : goalY + 10) : goalY + 3.5;

    charts.set(id, {
      x0, x1, width, height, pad, plotW, plotH, min, max,
      points: [...past.map((point) => ({ x: point.x, value: point.value, past: true })), ...future.map((point) => ({ x: point.x, value: point.mid, low: point.low, high: point.high, best: point.best }))],
    });

    return `<svg class="fc-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      ${grid.join("")}
      ${ticks.join("")}
      ${band}
      <line class="fc-goal" x1="${pad.left}" x2="${f(pad.left + plotW)}" y1="${f(goalY)}" y2="${f(goalY)}"/>
      <text class="fc-goal-label" x="${f(width - 2)}" y="${f(goalLabelY)}" text-anchor="end">${Math.round(goal)}%</text>
      ${future.length ? `<path class="fc-best" d="${path([...join, ...future], (point) => point.best)}"/>` : ""}
      ${past.length > 1 ? `<path class="fc-past" d="${path(past, (point) => point.value)}"/>` : ""}
      ${future.length ? `<path class="fc-mid" d="${path([...join, ...future], (point) => point.mid)}"/>` : ""}
      ${now ? `<line class="fc-now" x1="${f(sx(now.x))}" x2="${f(sx(now.x))}" y1="${pad.top}" y2="${f(pad.top + plotH)}"/><circle class="fc-dot" cx="${f(sx(now.x))}" cy="${f(sy(now.value))}" r="4"/>` : ""}
      ${last ? `<circle class="fc-end-dot" cx="${f(sx(last.x))}" cy="${f(endY)}" r="4"/><text class="fc-end-label" x="${f(sx(last.x) + 7)}" y="${f(endY + 4)}">${Math.round(last.mid)}%</text>` : ""}
      <g class="fc-cross" hidden><line class="fc-cross-line" y1="${pad.top}" y2="${f(pad.top + plotH)}"/><circle class="fc-cross-dot" r="4"/></g>
    </svg>`;
  }

  function figure(id, series, label, options) {
    const svg = lineChart(id, series, options);
    if (!svg) return "";
    return `<figure class="fc-chart" data-chart="${esc(id)}" tabindex="0" role="img" aria-label="${esc(label)}">
      ${svg}
      <div class="fc-tip" hidden><strong></strong><span></span></div>
    </figure>`;
  }

  function legend() {
    return `<ul class="fc-legend" aria-hidden="true">
      <li><span class="key key-past"></span>So far</li>
      <li><span class="key key-mid"></span>At your pace</li>
      <li><span class="key key-band"></span>Likely range</li>
      <li><span class="key key-best"></span>Attend all</li>
    </ul>`;
  }

  // ---- hero ----

  function heroVerdict(forecast) {
    const goal = forecast.goal;
    const result = forecast.overall.result;
    if (!goal.overall) {
      const counted = forecast.subjects.filter((subject) => subject.result).length;
      const state = forecast.onTrack === counted ? "good" : forecast.onTrack >= counted - 1 ? "lean" : "risk";
      return { state, strong: `${forecast.onTrack} of ${counted} subjects`, small: `on track for ${whole(goal.subject)}` };
    }
    const state = chanceState(result);
    if (state === "out") return { state, strong: STATE_WORD.out, small: `${whole(goal.overall)} needs more classes than are left` };
    return { state, strong: STATE_WORD[state], small: `${chanceText(result.chance)} chance of ${whole(goal.overall)}` };
  }

  function heroStats(forecast) {
    const overall = forecast.overall;
    const result = overall.result;
    const ratio = forecast.goal.overall || forecast.goal.subject;
    const cells = [];
    cells.push(`<div><dt>Classes left</dt><dd>${result.left}</dd><p>${forecast.end.days > 0 ? `${forecast.end.weeks} weeks` : "classes over"}</p></div>`);
    if (!forecast.goal.overall) {
      // No overall rule: the subject with the least room sets the limit.
      const tightest = forecast.subjects.filter((subject) => subject.result?.left).sort((left, right) => left.result.budget - right.result.budget)[0];
      if (tightest) {
        const budget = tightest.result.budget;
        cells.push(`<div${budget < 0 ? ' class="is-bad"' : budget === 0 ? ' class="is-tight"' : ""}><dt>${budget < 0 ? "Short by" : "Least room"}</dt><dd>${Math.abs(budget)}</dd><p>${esc(tightest.title)}</p></div>`);
      }
    } else if (!result.reachable) cells.push(`<div class="is-bad"><dt>Short by</dt><dd>${result.need - result.free}</dd><p>even attending all</p></div>`);
    else cells.push(`<div${result.budget === 0 ? ' class="is-tight"' : ""}><dt>Can miss</dt><dd>${result.budget}</dd><p>${result.budget ? `keeps ${whole(ratio)}` : "not one more"}</p></div>`);
    if (forecast.goal.overall) cells.push(`<div><dt>Need of rest</dt><dd>${result.required == null ? "—" : whole(result.required)}</dd><p>your pace ${whole(overall.pace)}</p></div>`);
    else cells.push(`<div><dt>Your pace</dt><dd>${whole(overall.pace)}</dd><p>lately, all subjects</p></div>`);
    return `<dl class="fc-stats">${cells.join("")}</dl>`;
  }

  function endControl(forecast) {
    const end = forecast.end;
    return `<div class="fc-end">
      <span class="fc-end-label-text">Classes end</span>
      <span class="fc-end-pick">
        <button type="button" class="fc-step" data-end-step="-7" aria-label="A week earlier">‹</button>
        <label class="fc-end-date"><span>${esc(end.label)}</span><input type="date" data-end-input value="${esc(end.key)}" aria-label="Last day of classes"/></label>
        <button type="button" class="fc-step" data-end-step="7" aria-label="A week later">›</button>
      </span>
      ${end.estimated ? `<span class="fc-end-tag">Estimated</span>` : `<button type="button" class="fc-end-reset" data-end-reset>Use estimate</button>`}
    </div>`;
  }

  function hero(forecast) {
    const overall = forecast.overall;
    const result = overall.result;
    if (!result) return "";
    const verdict = heroVerdict(forecast);
    const planned = forecast.plan?.planned || 0;
    const label = `Overall attendance ${forecast.historyFrom ? `from ${forecast.historyFrom} ` : ""}to now, ${pct(overall.now)}, and the forecast to ${forecast.end.label}: about ${pct(result.mid)}, likely ${pct(result.low)} to ${pct(result.high)}, ${pct(result.best)} if you attend every class.`;
    return `<section class="fc-hero is-${verdict.state}" aria-label="Semester forecast">
      <div class="fc-hero-top">
        <div class="fc-hero-figure">
          <p class="fc-eyebrow">Overall by ${esc(forecast.end.label)}${planned ? ` · with ${plural(planned, "planned skip")}` : ""}</p>
          <p class="fc-big"><span class="fc-approx">≈</span>${esc(pct(result.mid).replace("%", ""))}<span class="fc-unit">%</span></p>
          <p class="fc-range">likely ${esc(pct(result.low, 0))}–${esc(pct(result.high, 0))} · now ${esc(pct(overall.now))}</p>
        </div>
        <div class="fc-verdict" role="status">
          <span class="fc-verdict-icon" aria-hidden="true">${STATE_ICON[verdict.state]}</span>
          <strong>${esc(verdict.strong)}</strong>
          <span>${esc(verdict.small)}</span>
        </div>
      </div>
      ${figure("overall", overall.series, label, { height: 138 })}
      ${legend()}
      ${heroStats(forecast)}
      ${endControl(forecast)}
    </section>`;
  }

  // ---- planner ----

  function planCard(forecast) {
    const plan = forecast.plan;
    if (!plan) {
      const why = !forecast.timetableKnown ? "Your timetable has not been read yet. It comes with the next refresh." : "No classes left before the last day.";
      return `<section class="fc-card fc-plan" aria-label="Plan a skip"><div class="section-head"><h2 class="section-label">Plan a skip</h2></div><p class="fc-muted">${esc(why)}</p></section>`;
    }
    const days = plan.days
      .map(
        (day) => `<button type="button" class="fc-day${day.key === plan.day ? " is-on" : ""}" data-plan-day="${esc(day.key)}" aria-pressed="${day.key === plan.day}">
          <span class="fc-day-name">${esc(day.label)}</span>
          <span class="fc-day-date">${esc(day.date)}</span>
          ${day.planned ? `<span class="fc-day-dot" aria-label="${esc(plural(day.planned, "skip"))} planned">${day.planned}</span>` : ""}
        </button>`,
      )
      .join("");
    const rows = plan.classes
      .map((item) => {
        const kind = KIND[item.kind] ? `<span class="fc-class-kind">${KIND[item.kind]}</span>` : "";
        const now = item.now ? `<span class="fc-class-now">now</span>` : "";
        return `<li><button type="button" class="fc-class is-${item.verdict}" data-plan-key="${esc(item.key)}" aria-pressed="${item.skipping}">
          <span class="fc-class-time">${esc(item.time)}</span>
          <span class="fc-class-title"><span>${esc(item.title)}</span>${kind}${now}</span>
          <span class="fc-class-verdict">${item.skipping ? '<span aria-hidden="true">✕ </span>' : ""}${esc(VERDICT[item.verdict])}</span>
        </button></li>`;
      })
      .join("");
    const whole = plan.classes.length > 1 && !plan.classes.every((item) => item.skipping)
      ? `<button type="button" class="fc-whole is-${plan.wholeDay.state}" data-plan-whole>Skip the whole day<span>${WHOLE[plan.wholeDay.state]}</span></button>`
      : "";
    const summary = plan.maxSkips
      ? `skip up to ${plan.maxSkips} and stay at the goal`
      : plan.maxMakeUp
        ? `under the goal now; up to ${plan.maxMakeUp} can be made up later`
        : "attend every class";
    const lost = plan.overallLost
      ? `<p class="fc-plan-lost">${esc(whole_(forecast.goal.overall))} overall is out of reach this semester, so skips are judged on ${esc(whole_(forecast.goal.subject))} per subject.</p>`
      : "";
    return `<section class="fc-card fc-plan" aria-label="Plan a skip">
      <div class="section-head"><h2 class="section-label">Plan a skip</h2>${plan.planned ? `<button type="button" class="text-button" data-plan-clear="all">Clear plan (${plan.planned})</button>` : ""}</div>
      <div class="fc-days">${days}</div>
      <p class="fc-plan-sum"><strong>${esc(plural(plan.classes.length, "class"))} ${esc(plan.dayLabel)}</strong> · ${esc(summary)}</p>
      ${lost}
      <ul class="fc-classes">${rows}</ul>
      ${whole}
      ${impactPanel(forecast)}
      ${plan.impact ? "" : `<p class="fc-hint">Tap a class to see what skipping it does, now and by the last day.</p>`}
    </section>`;
  }

  function change(from, to, below, rule) {
    return `<span class="fc-from">${esc(pct(from))}</span><span class="fc-arrow" aria-label="to">→</span><span class="fc-to${below ? " is-below" : ""}">${esc(pct(to))}</span>${below ? `<span class="fc-flag">under ${esc(rule)}</span>` : ""}`;
  }

  function impactPanel(forecast) {
    const plan = forecast.plan;
    const impact = plan.impact;
    if (!impact) return "";
    const goal = forecast.goal;
    const rows = impact.subjects.map((subject) => `<li><span class="fc-impact-name">${esc(subject.title)}</span>${change(subject.from, subject.to, subject.below, whole(goal.subject))}</li>`);
    if (impact.overall && goal.overall) rows.push(`<li class="is-overall"><span class="fc-impact-name">Overall</span>${change(impact.overall.from, impact.overall.to, impact.overall.below, whole(goal.overall))}</li>`);
    const before = forecast.overall.unplanned;
    const after = forecast.overall.result;
    const semester = [];
    if (goal.overall && before && after) {
      if (before.reachable && after.reachable) semester.push(`Chance of ${whole(goal.overall)} overall <strong>${esc(chanceText(before.chance))} → ${esc(chanceText(after.chance))}</strong>`);
      if (before.reachable) semester.push(`Overall misses left <strong>${before.budget} → ${after.budget < 0 ? "none" : after.budget}</strong>`);
      semester.push(`Overall finish <strong>≈${esc(pct(before.mid))} → ${esc(pct(after.mid))}</strong>`);
    }
    for (const subject of forecast.subjects) {
      if (!subject.result || subject.result.planned === subject.unplanned.planned) continue;
      if (subject.unplanned.budget >= 0) semester.push(`${esc(subject.title)}: misses left <strong>${subject.unplanned.budget} → ${subject.result.budget < 0 ? "none" : subject.result.budget}</strong>`);
    }
    const day = esc(plan.isToday ? "today" : plan.dayLabel);
    const head = {
      safe: `✓ Safe: you stay at the goal after ${day}`,
      "make-up": `! Under the goal after ${day}, but you can make it up by the last day`,
      over: `✕ Too many: the goal is out of reach by the last day`,
    }[impact.state];
    return `<div class="fc-impact is-${impact.state}" role="status" aria-live="polite">
      <p class="fc-impact-head">${head}</p>
      <ul class="fc-impact-rows">${rows.join("")}</ul>
      ${semester.length ? `<div class="fc-impact-sem"><span>By the last day</span>${semester.map((line) => `<p>${line}</p>`).join("")}</div>` : ""}
      <button type="button" class="text-button" data-plan-clear="day">Clear ${esc(plan.isToday ? "today" : plan.dayLabel)}</button>
    </div>`;
  }

  // ---- subjects ----

  // One pip per class left: the ones to attend, the ones that can go, and
  // the planned skips. A long tail becomes a plain bar.
  function pips(result) {
    const left = result.left;
    if (!left) return "";
    const must = Math.min(left, result.need);
    const spare = Math.max(0, result.budget);
    const planned = result.planned;
    const short = Math.max(0, result.need - result.free);
    if (left <= 36) {
      const cells = [];
      for (let index = 0; index < left; index += 1) {
        const kind = index < planned ? "skip" : index < planned + Math.min(must, result.free) ? "must" : "spare";
        cells.push(`<span class="pip is-${kind}"></span>`);
      }
      return `<span class="fc-pips${short ? " is-short" : ""}" aria-hidden="true" style="--pips:${left}">${cells.join("")}</span>`;
    }
    const share = (value) => `${((value / left) * 100).toFixed(2)}%`;
    return `<span class="fc-bar${short ? " is-short" : ""}" aria-hidden="true">${planned ? `<span class="is-skip" style="width:${share(planned)}"></span>` : ""}<span class="is-must" style="width:${share(Math.min(must, result.free))}"></span>${spare ? `<span class="is-spare" style="width:${share(spare)}"></span>` : ""}</span>`;
  }

  function subjectLine(subject, goal) {
    const result = subject.result;
    if (!result || !result.left) return subject.now != null && subject.now / 100 + 1e-12 >= goal.subject ? "No classes left on the timetable" : "No classes left to recover";
    if (!result.reachable) return `Can't reach ${whole(goal.subject)}: best ${pct(result.best)}`;
    if (result.budget === 0) return `Attend all ${result.free} left`;
    return `Miss at most ${result.budget} of ${result.left}`;
  }

  function subjectDetail(subject, forecast) {
    const result = subject.result;
    const goal = forecast.goal;
    const facts = [];
    facts.push(["Now", `${pct(subject.now)}`, `${subject.attended}/${subject.delivered}`]);
    if (result) {
      facts.push(["Finish", `≈${pct(result.mid)}`, `likely ${pct(result.low, 0)}–${pct(result.high, 0)}`]);
      facts.push(["Attend all", pct(result.best), `${result.left} left`]);
      facts.push(["Your pace", whole(subject.pace), subject.evidence === "marks" ? "lately, recent classes count most" : "from the semester total"]);
      if (result.required != null) facts.push(["Need", whole(result.required), `of the rest for ${whole(goal.subject)}`]);
    }
    let note = "";
    if (result?.reachable && result.budget > 0) {
      note = subject.runsOut
        ? `At your pace the ${plural(result.budget, "miss")} run out around <strong>${esc(api.dayLabel(subject.runsOut))}</strong>. Spread them out: ${esc(pacing(subject.perWeek))}.`
        : `At your pace you stay clear to the last day. Room for ${esc(pacing(subject.perWeek))}.`;
    } else if (result?.reachable && result.left) note = "No room left: every class from here counts.";
    else if (result?.left) note = `Even attending all ${result.left} classes left ends at ${esc(pct(result.best))}. Approved duty or medical leave is the way back up.`;
    const label = `${subject.title}: attendance so far and the forecast to the last day.`;
    return `<div class="fc-detail" id="fc-detail-${esc(api.normCode(subject.code))}">
      ${figure(`s:${subject.code}`, subject.series, label, { height: 112, width: 300 })}
      <dl class="fc-facts">${facts.map(([name, value, small]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd><p>${esc(small)}</p></div>`).join("")}</dl>
      ${note ? `<p class="fc-note">${note}</p>` : ""}
    </div>`;
  }

  function subjectRow(subject, forecast, expanded) {
    const result = subject.result;
    const state = chanceState(result);
    const open = expanded === subject.code;
    const chance = result && result.left ? (result.reachable ? chanceText(result.chance) : "—") : "";
    const finish = result && result.left ? `≈${pct(result.mid, 0)}` : pct(subject.now);
    return `<li class="fc-subject is-${state}${open ? " is-open" : ""}">
      <button type="button" class="fc-subject-head" data-subject="${esc(subject.code)}" aria-expanded="${open}" aria-controls="fc-detail-${esc(api.normCode(subject.code))}">
        <span class="fc-s-top">
          <span class="fc-s-title">${esc(subject.title)}</span>
          <span class="fc-s-figures"><span class="fc-s-now">${esc(pct(subject.now))}</span><span class="fc-arrow" aria-label="heading for">→</span><span class="fc-s-end">${esc(finish)}</span></span>
        </span>
        ${result ? pips(result) : ""}
        <span class="fc-s-bottom">
          <span class="fc-s-line">${esc(subjectLine(subject, forecast.goal))}</span>
          ${chance ? `<span class="fc-chance is-${state}"><span aria-hidden="true">${STATE_ICON[state]}</span> ${esc(chance)}<span class="sr-only"> chance of ${esc(whole(forecast.goal.subject))}</span></span>` : ""}
        </span>
      </button>
      ${open ? subjectDetail(subject, forecast) : ""}
    </li>`;
  }

  function subjectsCard(forecast, expanded) {
    return `<section class="fc-card fc-subjects" aria-label="By subject">
      <div class="section-head"><h2 class="section-label">By subject</h2><span class="section-meta">most at risk first</span></div>
      <ul class="fc-subject-list">${forecast.subjects.map((subject) => subjectRow(subject, forecast, expanded)).join("")}</ul>
      <p class="fc-key" aria-hidden="true"><span class="pip is-must"></span>attend <span class="pip is-spare"></span>can miss <span class="pip is-skip"></span>planned skip · one per class left</p>
    </section>`;
  }

  // ---- habits ----

  function habitsCard(forecast) {
    const habits = forecast.patterns;
    if (!habits) {
      if (forecast.historySubjects) return "";
      return `<section class="fc-card fc-habits" aria-label="Your habits"><div class="section-head"><h2 class="section-label">Your habits</h2></div><p class="fc-muted">Your class-by-class record is read a few subjects at a time with each refresh. Your pace and habits appear once it is in.</p></section>`;
    }
    const top = Math.max(0.25, ...habits.weekdays.map((day) => day.rate));
    const bars = habits.weekdays
      .map((day) => {
        const height = Math.max(3, Math.round((day.rate / top) * 54));
        const worst = habits.worst?.id === day.id;
        return `<li class="${worst ? "is-worst" : ""}" title="${esc(`${day.label}: ${day.missed} of ${day.held} missed`)}">
          <span class="fc-col-value">${esc(whole(day.rate))}</span>
          <span class="fc-col" style="height:${height}px"></span>
          <span class="fc-col-label">${esc(day.label)}</span>
        </li>`;
      })
      .join("");
    const lines = [];
    if (habits.worst) lines.push(`<strong>${esc(DAY_FULL[habits.worst.id])}s</strong> are your weak spot: ${esc(whole(habits.worst.rate))} missed, against ${esc(whole(habits.average))} overall.`);
    if (habits.first) lines.push(`You miss the <strong>first class of the day</strong> more: ${esc(whole(habits.first.rate))}, against ${esc(whole(habits.first.rest))} for the rest.`);
    if (habits.recent != null && habits.before != null) {
      const delta = habits.recent - habits.before;
      const way = Math.abs(delta) < 0.02 ? "steady with" : delta > 0 ? "up from" : "down from";
      lines.push(`Last two weeks: <strong>${esc(whole(habits.recent))}</strong> attended, ${way} ${esc(whole(habits.before))} the two before.`);
    }
    if (habits.streak >= 5) lines.push(`Present for your last <strong>${habits.streak} classes</strong> in a row.`);
    const averageY = Math.round((habits.average / top) * 54);
    return `<section class="fc-card fc-habits" aria-label="Your habits">
      <div class="section-head"><h2 class="section-label">Your habits</h2><span class="section-meta">missed, by weekday</span></div>
      <div class="fc-cols-wrap">
        <ul class="fc-cols" role="list" aria-label="Classes missed by weekday">${bars}</ul>
        <span class="fc-avg" style="bottom:${averageY + 17}px" aria-hidden="true"><span>avg ${esc(whole(habits.average))}</span></span>
      </div>
      ${lines.length ? `<ul class="fc-insights">${lines.map((line) => `<li>${line}</li>`).join("")}</ul>` : ""}
    </section>`;
  }

  function method(forecast) {
    const ratio = forecast.goal.overall ? `${whole(forecast.goal.subject)} per subject and ${whole(forecast.goal.overall)} overall` : `${whole(forecast.goal.subject)} in every subject`;
    return `<details class="fc-method">
      <summary>How the forecast works</summary>
      <p><strong>Classes left</strong> come from your timetable, every week up to the last day of classes. Holidays are not known, so a week off means fewer classes and less room.</p>
      <p><strong>Your pace</strong> is the share of classes you attended lately; each class counts half as much every three weeks. A subject with few classes leans on your habit across all of them.</p>
      <p><strong>Likely range</strong> holds 8 of 10 outcomes at that pace, and the <strong>chance</strong> is how often the goal (${esc(ratio)}) is cleared. The goal sticks to what CUIMS counts: approved leave drops a class, pending leave counts as absent.</p>
      <p><strong>Plan a skip</strong> checks you stay at the goal right after that day, attending everything else.</p>
    </details>`;
  }

  // ---- the tab ----

  function bar(forecast, state) {
    const now = state.now || new Date();
    const note = state.working
      ? state.phase || "Refreshing…"
      : forecast?.fetchedAt
        ? `From your read ${api.ago(forecast.fetchedAt, now)}`
        : "";
    return `<div class="attendance-bar">
      <p class="attendance-note" role="status" aria-live="polite">${esc(note)}</p>
      <button type="button" class="refresh-button" data-action="refresh"${state.working ? " disabled" : ""}>${state.working ? "Refreshing" : "Refresh"}</button>
    </div>`;
  }

  function goalSwitch(goal) {
    const option = (entry) => `<button type="button" role="radio" data-goal="${entry.id}" aria-checked="${entry.id === goal.id}">${esc(entry.label)}</button>`;
    return `<div class="goal" role="radiogroup" aria-label="Attendance goal">${Object.values(api.GOALS).map(option).join("")}</div>`;
  }

  function renderForecast(forecast, state = {}) {
    charts.clear();
    if (!forecast) {
      return `<div class="fc-empty">
        <p class="fc-empty-title">Your semester, forecast</p>
        <p>Once your attendance is read, this tab shows where each subject finishes at your pace, the chance you clear the goal, and what skipping a class does.</p>
        <button type="button" class="save-button" data-goto="attendance">Go to Attendance</button>
      </div>`;
    }
    return `${bar(forecast, state)}
      ${goalSwitch(forecast.goal)}
      ${hero(forecast)}
      ${planCard(forecast)}
      ${subjectsCard(forecast, state.expanded)}
      ${habitsCard(forecast)}
      ${method(forecast)}`;
  }

  // ---- crosshair ----

  function nearest(chart, x) {
    let best = null;
    for (const point of chart.points) if (!best || Math.abs(point.x - x) < Math.abs(best.x - x)) best = point;
    return best;
  }

  function showPoint(figureEl, chart, point) {
    const svg = figureEl.querySelector("svg");
    const cross = svg?.querySelector(".fc-cross");
    const tip = figureEl.querySelector(".fc-tip");
    if (!svg || !cross || !tip || !point) return;
    const sx = chart.pad.left + ((point.x - chart.x0) / (chart.x1 - chart.x0)) * chart.plotW;
    const sy = chart.pad.top + (1 - (point.value - chart.min) / (chart.max - chart.min)) * chart.plotH;
    cross.removeAttribute("hidden");
    const line = cross.querySelector("line");
    line.setAttribute("x1", sx.toFixed(1));
    line.setAttribute("x2", sx.toFixed(1));
    const dot = cross.querySelector("circle");
    dot.setAttribute("cx", sx.toFixed(1));
    dot.setAttribute("cy", sy.toFixed(1));
    tip.hidden = false;
    tip.querySelector("strong").textContent = point.past ? pct(point.value) : `≈${pct(point.value)}`;
    tip.querySelector("span").textContent = point.past ? `${dateOf(point.x - (point.x % 1 ? 0 : 1))}` : `${dateOf(point.x - 1)} · likely ${pct(point.low, 0)}–${pct(point.high, 0)}`;
    const share = sx / chart.width;
    tip.style.left = `${(share * 100).toFixed(2)}%`;
    tip.classList.toggle("is-left", share > 0.6);
    figureEl.dataset.at = String(chart.points.indexOf(point));
  }

  function hide(figureEl) {
    figureEl.querySelector(".fc-cross")?.setAttribute("hidden", "");
    const tip = figureEl.querySelector(".fc-tip");
    if (tip) tip.hidden = true;
    delete figureEl.dataset.at;
  }

  // Pointer and arrow keys move the crosshair; it snaps to the nearest day.
  function bindCharts(container) {
    let active = false;
    container.addEventListener("pointermove", (event) => {
      const figureEl = event.target.closest?.(".fc-chart");
      if (!figureEl) return;
      const chart = charts.get(figureEl.dataset.chart);
      const box = figureEl.querySelector("svg")?.getBoundingClientRect();
      if (!chart || !box?.width) return;
      active = true;
      const px = ((event.clientX - box.left) / box.width) * chart.width;
      const x = chart.x0 + ((px - chart.pad.left) / chart.plotW) * (chart.x1 - chart.x0);
      showPoint(figureEl, chart, nearest(chart, x));
    });
    container.addEventListener("pointerout", (event) => {
      const figureEl = event.target.closest?.(".fc-chart");
      if (figureEl && !figureEl.contains(event.relatedTarget)) {
        hide(figureEl);
        active = false;
      }
    });
    container.addEventListener("keydown", (event) => {
      const figureEl = event.target.closest?.(".fc-chart");
      if (!figureEl || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const chart = charts.get(figureEl.dataset.chart);
      if (!chart?.points.length) return;
      event.preventDefault();
      const nowIndex = chart.points.findIndex((point) => !point.past) - 1;
      let index = figureEl.dataset.at != null ? Number(figureEl.dataset.at) : Math.max(0, nowIndex);
      if (event.key === "ArrowLeft") index -= 1;
      if (event.key === "ArrowRight") index += 1;
      if (event.key === "Home") index = 0;
      if (event.key === "End") index = chart.points.length - 1;
      index = Math.max(0, Math.min(chart.points.length - 1, index));
      showPoint(figureEl, chart, chart.points[index]);
    });
    container.addEventListener("focusout", (event) => {
      const figureEl = event.target.closest?.(".fc-chart");
      if (figureEl) hide(figureEl);
    });
    return { busy: () => active };
  }

  api.renderForecast = renderForecast;
  api.bindForecastCharts = bindCharts;
  api.chanceText = chanceText;
})(globalThis);
