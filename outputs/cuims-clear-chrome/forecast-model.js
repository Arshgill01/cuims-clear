// The Forecast tab: where each subject and the overall figure finish by the
// last day of classes if the student keeps their recent pace, the chance that
// clears the goal, how many classes are left to miss, and what skipping a
// given class does. Pure data in, view model out.
//
// Pace is the share of classes attended lately (each class counts half as
// much every three weeks), pulled toward the student's own habit across all
// subjects so a subject with few classes is not judged on two of them. The
// classes still to come are counted from the timetable. How many of them the
// student attends is modelled as a beta-binomial draw at that pace, which
// gives the likely range and the chance of clearing the goal.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});
  const DAY_MS = 86_400_000;
  const HALF_LIFE_DAYS = 21;
  // Two classes' worth of pull toward the student's own habit.
  const PRIOR = 4;
  // Habits change, so a long record never makes the range razor-thin.
  const MAX_EVIDENCE = 30;
  // Without a mark list, the semester total stands in for recent pace.
  const TOTAL_EVIDENCE = 12;
  // The planner covers today and the next six days with classes.
  const PLAN_DAYS = 7;
  const LOW = 0.1;
  const HIGH = 0.9;
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const DAY_NAMES = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- calendar ----

  function dayNumber(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
  }

  function dayKeyOf(number) {
    return new Date(number * DAY_MS).toISOString().slice(0, 10);
  }

  function weekdayOf(number) {
    return WEEKDAYS[new Date(number * DAY_MS).getUTCDay()];
  }

  // "Fri 27 Nov".
  function dayLabel(number) {
    const date = new Date(number * DAY_MS);
    return `${DAY_NAMES[weekdayOf(number)]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
  }

  // The last day of classes the student set, else an estimate: 20 November
  // for the July semester, 30 April for the January one (nearby universities
  // end teaching then; CU publishes no calendar to read it from). Past it,
  // classes are over.
  function semesterEnd(setKey, todayN) {
    const set = dayNumber(setKey);
    if (set != null) return { day: set, estimated: false };
    const date = new Date(todayN * DAY_MS);
    const year = date.getUTCFullYear();
    const day = date.getUTCMonth() >= 6 ? Date.UTC(year, 10, 20) / DAY_MS : Date.UTC(year, 3, 30) / DAY_MS;
    return { day: Math.max(day, todayN), estimated: true };
  }

  // ---- the draw ----

  // P(k of n classes attended) when the attendance rate is Beta(a, b).
  function betaBinomial(n, a, b) {
    if (!(n > 0)) return [1];
    const logs = new Array(n + 1);
    let acc = 0;
    for (let i = 0; i < n; i += 1) acc += Math.log(b + i) - Math.log(a + b + i);
    logs[0] = acc;
    for (let k = 0; k < n; k += 1) logs[k + 1] = logs[k] + Math.log((n - k) / (k + 1)) + Math.log((a + k) / (b + n - k - 1));
    let top = -Infinity;
    for (const value of logs) if (value > top) top = value;
    const pmf = logs.map((value) => Math.exp(value - top));
    const total = pmf.reduce((sum, value) => sum + value, 0);
    return pmf.map((value) => value / total);
  }

  function quantile(pmf, q) {
    let acc = 0;
    for (let k = 0; k < pmf.length; k += 1) {
      acc += pmf[k];
      if (acc >= q - 1e-12) return k;
    }
    return pmf.length - 1;
  }

  function atLeast(pmf, k) {
    if (k <= 0) return 1;
    if (k >= pmf.length) return 0;
    let acc = 0;
    for (let j = k; j < pmf.length; j += 1) acc += pmf[j];
    return Math.min(1, acc);
  }

  // ---- pace ----

  // Weighted classes held and attended from a compact mark list. Leave is
  // neither: approved leave leaves both counts.
  function weighted(marks, todayN) {
    let held = 0;
    let attended = 0;
    let count = 0;
    for (const [day, , kind] of marks || []) {
      if (kind !== "p" && kind !== "a") continue;
      const age = Math.max(0, todayN - (dayNumber(day) ?? todayN));
      const weight = 0.5 ** (age / HALF_LIFE_DAYS);
      held += weight;
      if (kind === "p") attended += weight;
      count += 1;
    }
    return { held, attended, count };
  }

  function posterior(evidence, habit) {
    let { held, attended } = evidence;
    if (held > MAX_EVIDENCE) {
      attended *= MAX_EVIDENCE / held;
      held = MAX_EVIDENCE;
    }
    const a = Math.max(0.05, PRIOR * habit + attended);
    const b = Math.max(0.05, PRIOR * (1 - habit) + held - attended);
    return { a, b, pace: a / (a + b) };
  }

  // ---- what is still to come ----

  // Every class left this semester, per subject: today's that have not ended,
  // then each weekday's slots up to the last day.
  function upcomingClasses(rows, slots, todayN, endN) {
    const classes = [];
    const add = (row, day, start, kind) => {
      classes.push({ row, day, start, kind: kind || "L", key: `${dayKeyOf(day)}|${api.slotKey(row.code, start)}` });
    };
    for (const row of rows) {
      for (const item of row.today) if (item.state === "next" || item.state === "now") add(row, todayN, item.start, item.kind);
    }
    const byDay = new Map();
    for (const slot of slots || []) {
      const row = rows.find((candidate) => api.slotBelongsTo(slot, candidate));
      if (!row) continue;
      if (!byDay.has(slot.weekday)) byDay.set(slot.weekday, []);
      byDay.get(slot.weekday).push({ slot, row });
    }
    for (let day = todayN + 1; day <= endN; day += 1) {
      for (const { slot, row } of byDay.get(weekdayOf(day)) || []) add(row, day, slot.start, slot.kind);
    }
    return classes.sort((left, right) => left.day - right.day || left.start - right.start);
  }

  // ---- figures ----

  // Where one subject (or the whole set) finishes. `free` classes are left to
  // choose; planned skips are already missed.
  function finish({ attended, held, upcoming, planned, ratio, a, b }) {
    const free = upcoming - planned;
    const total = held + upcoming;
    if (!(total > 0)) return null;
    const pmf = betaBinomial(free, a, b);
    const pace = a / (a + b);
    const need = Math.ceil(ratio * total - attended - 1e-9);
    const chance = upcoming === 0 ? (attended / total + 1e-12 >= ratio ? 1 : 0) : need > free ? 0 : atLeast(pmf, need);
    return {
      held: total,
      left: upcoming,
      planned,
      free,
      need: Math.max(0, need),
      budget: free - Math.max(0, need),
      required: free > 0 ? Math.min(1, Math.max(0, need / free)) : null,
      chance,
      mid: ((attended + free * pace) / total) * 100,
      low: ((attended + quantile(pmf, LOW)) / total) * 100,
      high: ((attended + quantile(pmf, HIGH)) / total) * 100,
      best: ((attended + free) / total) * 100,
      reachable: (attended + free) / total + 1e-12 >= ratio,
    };
  }

  // The day the misses run out if the student keeps missing at their pace.
  function runway(classes, budget, pace) {
    if (!(budget >= 0) || pace >= 0.999) return null;
    let expected = 0;
    for (const item of classes) {
      if (item.planned) continue;
      expected += 1 - pace;
      if (expected > budget + 0.5) return item.day;
    }
    return null;
  }

  // Attendance by day from the mark list, reconciled to today's official
  // counts: CUIMS's eligibility figures fold in leave the marks only hint at,
  // so the gap is spread across the semester in proportion to classes held.
  function history(marks, attended, delivered, nowX, settle = 12) {
    const days = new Map();
    for (const [day, , kind] of marks || []) {
      if (kind !== "p" && kind !== "a") continue;
      const n = dayNumber(day);
      if (n == null) continue;
      const entry = days.get(n) || { held: 0, attended: 0 };
      entry.held += 1;
      if (kind === "p") entry.attended += 1;
      days.set(n, entry);
    }
    const ordered = [...days].sort((left, right) => left[0] - right[0]);
    const totalHeld = ordered.reduce((sum, [, entry]) => sum + entry.held, 0);
    const totalAttended = ordered.reduce((sum, [, entry]) => sum + entry.attended, 0);
    const extraHeld = delivered - totalHeld;
    const extraAttended = attended - totalAttended;
    const points = [];
    let held = 0;
    let present = 0;
    for (const [day, entry] of ordered) {
      held += entry.held;
      present += entry.attended;
      const share = totalHeld ? held / totalHeld : 1;
      const h = held + extraHeld * share;
      const a = present + extraAttended * share;
      const x = Math.min(day + 1, nowX);
      // The first few classes swing between 0 and 100%; the line starts once
      // the figure means something.
      if (held < settle) continue;
      if (h > 0) points.push({ x, value: Math.max(0, Math.min(100, (a / h) * 100)) });
    }
    if (delivered > 0) {
      while (points.length && points[points.length - 1].x >= nowX) points.pop();
      points.push({ x: nowX, value: (attended / delivered) * 100 });
    }
    return points;
  }

  // From now to the last day: the pace line, its likely range, and the
  // attend-everything line.
  function projection({ attended, held, classes, ratio, a, b, nowX }) {
    const start = held > 0 ? (attended / held) * 100 : null;
    const points = start == null ? [] : [{ x: nowX, mid: start, low: start, high: start, best: start }];
    const pace = a / (a + b);
    let upcoming = 0;
    let planned = 0;
    for (let index = 0; index < classes.length; index += 1) {
      const item = classes[index];
      upcoming += 1;
      if (item.planned) planned += 1;
      if (classes[index + 1]?.day === item.day) continue;
      const free = upcoming - planned;
      const total = held + upcoming;
      const pmf = betaBinomial(free, a, b);
      points.push({
        x: item.day + 1,
        mid: ((attended + free * pace) / total) * 100,
        low: ((attended + quantile(pmf, LOW)) / total) * 100,
        high: ((attended + quantile(pmf, HIGH)) / total) * 100,
        best: ((attended + free) / total) * 100,
      });
    }
    return { points, goal: ratio * 100 };
  }

  // ---- habits ----

  function patterns(allMarks, todayN) {
    const counted = allMarks.filter(([, , kind]) => kind === "p" || kind === "a");
    if (counted.length < 20) return null;
    const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat"].map((id) => ({ id, label: DAY_NAMES[id], held: 0, missed: 0 }));
    const firsts = new Map();
    let missed = 0;
    for (const [day, start, kind] of counted) {
      const n = dayNumber(day);
      const entry = weekdays.find((item) => item.id === weekdayOf(n));
      if (entry) {
        entry.held += 1;
        if (kind === "a") entry.missed += 1;
      }
      if (kind === "a") missed += 1;
      if (start >= 0 && (!firsts.has(day) || start < firsts.get(day))) firsts.set(day, start);
    }
    for (const entry of weekdays) entry.rate = entry.held ? entry.missed / entry.held : null;
    const days = weekdays.filter((entry) => entry.held > 0);
    const average = missed / counted.length;

    // First class of the day against the rest.
    let firstHeld = 0;
    let firstMissed = 0;
    let restHeld = 0;
    let restMissed = 0;
    for (const [day, start, kind] of counted) {
      if (start < 0) continue;
      if (start === firsts.get(day)) {
        firstHeld += 1;
        if (kind === "a") firstMissed += 1;
      } else {
        restHeld += 1;
        if (kind === "a") restMissed += 1;
      }
    }
    const first = firstHeld >= 6 && restHeld >= 6 ? { rate: firstMissed / firstHeld, rest: restMissed / restHeld } : null;

    const span = (from, to) => {
      const inside = counted.filter(([day]) => {
        const age = todayN - dayNumber(day);
        return age >= from && age < to;
      });
      return inside.length >= 6 ? inside.filter(([, , kind]) => kind === "p").length / inside.length : null;
    };

    // Present for the last N classes in a row, newest first.
    let streak = 0;
    for (let index = counted.length - 1; index >= 0 && counted[index][2] === "p"; index -= 1) streak += 1;

    const worst = days.filter((entry) => entry.held >= 4).sort((left, right) => right.rate - left.rate)[0] || null;
    return {
      weekdays: days,
      average,
      worst: worst && worst.missed >= 2 && worst.rate >= average + 0.05 ? worst : null,
      first: first && first.rate >= first.rest + 0.08 ? first : null,
      recent: span(0, 14),
      before: span(14, 28),
      streak,
      counted: counted.length,
    };
  }

  // ---- the planner ----

  function planner(subjects, classes, plan, goal, todayN, chosenDay) {
    const days = [];
    for (const item of classes) {
      if (days.length && days[days.length - 1].day === item.day) continue;
      if (days.length >= PLAN_DAYS) break;
      days.push({ day: item.day });
    }
    if (!days.length) return null;
    const window = new Set(days.map((entry) => entry.day));
    const inWindow = classes.filter((item) => window.has(item.day));
    const chosen = days.find((entry) => entry.day === dayNumber(chosenDay))?.day ?? days[0].day;

    // Figures at the end of `day` with `skips` missed and every other class
    // up to then attended.
    const figuresAt = (day, skips) => {
      const bySubject = new Map();
      let attended = 0;
      let held = 0;
      for (const subject of subjects) {
        let a = subject.attended;
        let h = subject.held;
        for (const item of subject.classes) {
          if (item.day > day) break;
          h += 1;
          if (!skips.has(item.key)) a += 1;
        }
        bySubject.set(subject, { attended: a, held: h });
        attended += a;
        held += h;
      }
      return { bySubject, attended, held };
    };

    const dayOf = new Map(inWindow.map((item) => [item.key, item]));
    // A set is safe when, at the end of every day with a skip, each subject
    // skipped that day and the overall figure (when the goal has one) still
    // meet the goal.
    const safe = (skips) => {
      const skipDays = new Set([...skips].map((key) => dayOf.get(key)?.day).filter((day) => day != null));
      for (const day of skipDays) {
        const figures = figuresAt(day, skips);
        for (const [subject, entry] of figures.bySubject) {
          const skipped = subject.classes.some((item) => item.day === day && skips.has(item.key));
          if (skipped && entry.attended / entry.held + 1e-12 < goal.subject) return false;
        }
        if (goal.overall && figures.attended / figures.held + 1e-12 < goal.overall) return false;
      }
      return true;
    };

    // Still reachable by the last day: every subject skipped, and the overall
    // figure, can reach the goal attending everything else. An overall goal
    // already out of reach drops out, so the per-subject rule still guides.
    const overallTotals = subjects.reduce((sum, subject) => ({ attended: sum.attended + subject.attended, held: sum.held + subject.held + subject.classes.length, left: sum.left + subject.classes.length }), { attended: 0, held: 0, left: 0 });
    const overallLost = Boolean(goal.overall) && overallTotals.attended + overallTotals.left + 1e-9 < goal.overall * overallTotals.held;
    const reachable = (skips) => {
      for (const subject of subjects) {
        const skipped = subject.classes.filter((item) => skips.has(item.key)).length;
        if (!skipped) continue;
        const left = subject.classes.length;
        if (subject.attended + left - skipped + 1e-9 < goal.subject * (subject.held + left)) return false;
      }
      if (!goal.overall || overallLost) return true;
      return overallTotals.attended + overallTotals.left - skips.size + 1e-9 >= goal.overall * overallTotals.held;
    };
    // "safe": at the goal right after; "make-up": under it for now, still
    // reachable by the last day; "over": out of reach.
    const standing = (skips) => (safe(skips) ? "safe" : reachable(skips) ? "make-up" : "over");

    const planState = standing(plan);
    for (const entry of days) {
      entry.key = dayKeyOf(entry.day);
      entry.label = entry.day === todayN ? "Today" : DAY_NAMES[weekdayOf(entry.day)];
      entry.date = dayLabel(entry.day).replace(/^\w+ /, "");
      entry.count = inWindow.filter((item) => item.day === entry.day).length;
      entry.planned = inWindow.filter((item) => item.day === entry.day && plan.has(item.key)).length;
    }

    const PLANNED = { safe: "planned", "make-up": "planned-make-up", over: "too-many" };
    const OPEN = { safe: "can-skip", "make-up": "make-up", over: "attend" };
    const todays = inWindow.filter((item) => item.day === chosen);
    const others = new Set([...plan].filter((key) => dayOf.get(key)?.day !== chosen));
    const items = todays.map((item) => {
      const skipping = plan.has(item.key);
      const next = new Set(plan);
      next.add(item.key);
      return {
        key: item.key,
        time: api.formatClock(item.start),
        start: item.start,
        title: item.row.title,
        code: item.row.code,
        kind: item.kind,
        now: item.day === todayN && item.row.today.some((entry) => entry.start === item.start && entry.state === "now"),
        skipping,
        verdict: skipping ? PLANNED[planState] : OPEN[standing(next)],
      };
    });

    // The most of this day's classes that can go, the rest of the plan kept:
    // staying at the goal, and still reachable by the last day.
    let maxSkips = 0;
    let maxMakeUp = 0;
    const limit = Math.min(todays.length, 12);
    for (let mask = 1; mask < 1 << limit; mask += 1) {
      const set = new Set(others);
      let size = 0;
      todays.slice(0, limit).forEach((item, index) => {
        if (mask & (1 << index)) {
          set.add(item.key);
          size += 1;
        }
      });
      if (size > maxMakeUp && reachable(set)) maxMakeUp = size;
      if (size > maxSkips && safe(set)) maxSkips = size;
    }
    const wholeDay = new Set([...others, ...todays.map((item) => item.key)]);

    // Before and after this day's skips, the rest of the plan kept.
    let impact = null;
    const dayPlanned = todays.filter((item) => plan.has(item.key));
    if (dayPlanned.length) {
      const before = figuresAt(chosen, others);
      const after = figuresAt(chosen, plan);
      const touched = subjects.filter((subject) => dayPlanned.some((item) => item.row === subject.row));
      impact = {
        skipped: dayPlanned.length,
        state: planState,
        safe: planState === "safe",
        subjects: touched.map((subject) => {
          const from = before.bySubject.get(subject);
          const to = after.bySubject.get(subject);
          return {
            title: subject.title,
            from: (from.attended / from.held) * 100,
            to: (to.attended / to.held) * 100,
            below: to.attended / to.held + 1e-12 < goal.subject,
          };
        }),
        overall: before.held > 0 ? { from: (before.attended / before.held) * 100, to: (after.attended / after.held) * 100, below: Boolean(goal.overall) && after.attended / after.held + 1e-12 < goal.overall } : null,
      };
    }
    return {
      days,
      day: dayKeyOf(chosen),
      dayLabel: chosen === todayN ? "today" : dayLabel(chosen),
      isToday: chosen === todayN,
      classes: items,
      maxSkips,
      maxMakeUp,
      overallLost,
      wholeDay: { keys: todays.map((item) => item.key), state: standing(wholeDay) },
      impact,
      planned: plan.size,
      plannedDays: days.filter((entry) => entry.planned).length,
    };
  }

  // ---- the whole view ----

  function buildForecast(snapshot, stored, now = new Date(), options = {}) {
    const analytics = api.buildAnalytics(snapshot, now, { goal: options.goal });
    if (!analytics.subjects.length) return null;
    const goal = analytics.goal;
    const campus = api.campusParts(now);
    const todayN = dayNumber(campus.key);
    const nowX = todayN + campus.minutes / 1440;
    const marksBy = stored?.v === 1 ? stored.subjects || {} : {};
    const rows = analytics.subjects.filter((row) => row.delivered + row.pending > 0 || row.today.length);

    const allMarks = rows.flatMap((row) => marksBy[api.normCode(row.code)]?.marks || []).sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] - right[1]));
    const firstDay = allMarks.length ? dayNumber(allMarks[0][0]) : null;
    const end = semesterEnd(options.end, todayN);

    const classes = upcomingClasses(rows, snapshot?.slots, todayN, end.day);
    const window = new Set();
    for (const item of classes) {
      if (!window.has(item.day) && window.size >= PLAN_DAYS) break;
      window.add(item.day);
    }
    const plan = new Set((options.plan || []).filter((key) => classes.some((item) => item.key === key && window.has(item.day))));
    for (const item of classes) item.planned = plan.has(item.key);

    // The student's habit across every subject, for the pull.
    const pooled = weighted(allMarks, todayN);
    const totalAttended = rows.reduce((sum, row) => sum + row.attended, 0);
    const totalDelivered = rows.reduce((sum, row) => sum + row.delivered, 0);
    const habit = pooled.held >= 3 ? pooled.attended / pooled.held : totalDelivered > 0 ? totalAttended / totalDelivered : 0.85;

    const subjects = rows.map((row) => {
      const marks = marksBy[api.normCode(row.code)]?.marks || null;
      const recent = weighted(marks, todayN);
      const fromMarks = recent.count > 0;
      const evidence = fromMarks
        ? recent
        : row.delivered > 0
          ? { held: Math.min(row.delivered, TOTAL_EVIDENCE), attended: (Math.min(row.delivered, TOTAL_EVIDENCE) * row.attended) / row.delivered }
          : { held: 0, attended: 0 };
      const { a, b, pace } = posterior(evidence, habit);
      const mine = classes.filter((item) => item.row === row);
      const held = row.delivered + row.pending;
      const planned = mine.filter((item) => item.planned).length;
      const base = { attended: row.attended, held, upcoming: mine.length, ratio: goal.subject, a, b };
      const result = finish({ ...base, planned });
      const unplanned = planned ? finish({ ...base, planned: 0 }) : result;
      const weeks = Math.max(1, (end.day - todayN) / 7);
      return {
        row,
        code: row.code,
        title: row.title,
        tone: row.tone,
        attended: row.attended,
        delivered: row.delivered,
        held,
        now: row.percent,
        classes: mine,
        pace,
        a,
        b,
        evidence: fromMarks ? "marks" : "total",
        recentClasses: recent.count,
        result,
        unplanned,
        perWeek: result && result.budget > 0 && end.day > todayN ? result.budget / weeks : null,
        runsOut: result ? runway(mine, result.budget, pace) : null,
        marks,
      };
    });

    // Overall: the pace across what is left, with the evidence of all of it.
    const sum = (pick) => subjects.reduce((total, subject) => total + pick(subject), 0);
    const left = classes.length;
    const pace = left ? sum((subject) => subject.classes.length * subject.pace) / left : habit;
    const concentration = Math.min(MAX_EVIDENCE, pooled.held || Math.min(totalDelivered, TOTAL_EVIDENCE)) + PRIOR;
    const oa = Math.max(0.05, pace * concentration);
    const ob = Math.max(0.05, (1 - pace) * concentration);
    const overallRatio = goal.overall || goal.subject;
    const overallBase = { attended: sum((s) => s.attended), held: sum((s) => s.held), upcoming: left, ratio: overallRatio, a: oa, b: ob };
    const overallResult = finish({ ...overallBase, planned: plan.size });
    const overallUnplanned = plan.size ? finish({ ...overallBase, planned: 0 }) : overallResult;

    for (const subject of subjects) {
      subject.series = {
        past: history(subject.marks, subject.attended, subject.delivered, nowX, 5),
        future: projection({ attended: subject.attended, held: subject.held, classes: subject.classes, ratio: goal.subject, a: subject.a, b: subject.b, nowX }),
      };
    }
    const mergedPast = history(allMarks, overallBase.attended, sum((s) => s.delivered), nowX, 30);
    const overallSeries = {
      past: mergedPast,
      future: projection({ attended: overallBase.attended, held: overallBase.held, classes, ratio: overallRatio, a: oa, b: ob, nowX }),
    };

    // Most at risk first.
    const order = (subject) => (subject.result ? subject.result.chance : 2);
    subjects.sort((left, right) => order(left) - order(right) || (left.now ?? 101) - (right.now ?? 101));

    const onTrack = subjects.filter((subject) => subject.result && subject.result.chance >= 0.5).length;
    return {
      fetchedAt: analytics.fetchedAt,
      goal,
      todayKey: campus.key,
      today: todayN,
      nowX,
      end: {
        key: dayKeyOf(end.day),
        label: dayLabel(end.day),
        estimated: end.estimated,
        days: end.day - todayN,
        weeks: Math.max(0, Math.round(((end.day - todayN) / 7) * 10) / 10),
      },
      timetableKnown: analytics.timetableKnown,
      historyFrom: firstDay != null ? dayLabel(firstDay) : null,
      historySubjects: subjects.filter((subject) => subject.evidence === "marks").length,
      overall: {
        now: analytics.overall.percent,
        attended: overallBase.attended,
        delivered: sum((s) => s.delivered),
        pace,
        habit,
        result: overallResult,
        unplanned: overallUnplanned,
        series: overallSeries,
        runsOut: overallResult ? runway(classes, overallResult.budget, pace) : null,
      },
      subjects,
      onTrack,
      plan: planner(subjects, classes, plan, goal, todayN, options.day),
      patterns: patterns(allMarks, todayN),
    };
  }

  api.betaBinomial = betaBinomial;
  api.semesterEnd = semesterEnd;
  api.dayNumber = dayNumber;
  api.dayKeyOf = dayKeyOf;
  api.dayLabel = dayLabel;
  api.buildForecast = buildForecast;
})(globalThis);
