// Semester Wrapped: the semester told back as a few story cards, from the
// attendance the extension already saved (every posted class, per subject)
// and the receipt's own counts. Opens on the last teaching day, with the
// time capsule; a peek before then is marked "so far". Each card is drawn
// at 1080×1920, shown scaled in the popup and saved as the same picture.
// Nothing here is a request to CUIMS.
(function (root) {
  const DAY_MS = 86_400_000;
  const W = 1080;
  const H = 1920;
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const keyToNumber = (key) => {
    const [y, m, d] = String(key).split("-").map(Number);
    return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / DAY_MS) : null;
  };
  const numberToKey = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const shortDate = (key) => {
    const [, m, d] = String(key).split("-").map(Number);
    return m ? `${d} ${MONTHS[m - 1]}` : "";
  };
  const norm = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const share = (p, n) => (n > 0 ? (p / n) * 100 : null);
  const fmt1 = (value) => `${(Math.floor(value * 10) / 10).toFixed(1)}%`;

  // ---- the numbers ----

  // `data`: { snapshot, history, ledger, best, calendar, todayKey }.
  // Null when there is too little to tell (fewer than 20 classes posted).
  function stats(data) {
    const subjects = data.history?.subjects || {};
    const titles = new Map();
    for (const subject of data.snapshot?.subjects || []) titles.set(norm(subject.code), subject.title || subject.code);
    const lengths = new Map();
    for (const slot of data.snapshot?.slots || []) lengths.set(`${norm(slot.shortCode)}@${slot.start}`, slot.end - slot.start);

    const marks = [];
    for (const [code, subject] of Object.entries(subjects)) {
      for (const mark of subject?.marks || []) {
        const [day, start, kind] = mark || [];
        if ((kind === "p" || kind === "a") && keyToNumber(day) != null) marks.push({ day, start: Number(start) || 0, kind, code: norm(code) });
      }
    }
    if (marks.length < 20) return null;
    marks.sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
    const attended = marks.filter((mark) => mark.kind === "p").length;
    const delivered = marks.length;

    // Weekdays: the one you never missed, the one you missed most.
    const weekdays = Array.from({ length: 7 }, () => ({ p: 0, n: 0 }));
    for (const mark of marks) {
      const w = new Date(keyToNumber(mark.day) * DAY_MS).getUTCDay();
      weekdays[w].n += 1;
      if (mark.kind === "p") weekdays[w].p += 1;
    }
    const usable = weekdays.map((entry, i) => ({ ...entry, i, missed: entry.n - entry.p, rate: share(entry.p, entry.n) })).filter((entry) => entry.n >= 8);
    const bestDay = [...usable].sort((a, b) => b.rate - a.rate || b.n - a.n)[0] || null;
    const worstDay = [...usable].sort((a, b) => b.missed - a.missed || a.rate - b.rate)[0] || null;

    // Subjects: the best, and the comeback (second half beat the first).
    const bySubject = new Map();
    for (const mark of marks) {
      if (!bySubject.has(mark.code)) bySubject.set(mark.code, []);
      bySubject.get(mark.code).push(mark);
    }
    const subjectRows = [...bySubject.entries()].map(([code, list]) => {
      const half = Math.floor(list.length / 2);
      const p = (part) => part.filter((mark) => mark.kind === "p").length;
      return {
        code,
        title: titles.get(code) || code,
        n: list.length,
        rate: share(p(list), list.length),
        first: half >= 8 ? share(p(list.slice(0, half)), half) : null,
        second: half >= 8 ? share(p(list.slice(half)), list.length - half) : null,
      };
    });
    const topSubject = [...subjectRows].filter((row) => row.n >= 10).sort((a, b) => b.rate - a.rate || b.n - a.n)[0] || null;
    const comeback = [...subjectRows]
      .filter((row) => row !== topSubject && row.first != null && row.second - row.first >= 5)
      .sort((a, b) => b.second - b.first - (a.second - a.first))[0] || null;

    // The closest call: the lowest the running total got, once there was
    // enough of it to mean something.
    let p = 0;
    let n = 0;
    let lowest = null;
    let lastDay = "";
    for (const mark of marks) {
      n += 1;
      if (mark.kind === "p") p += 1;
      if (mark.day !== lastDay) lastDay = mark.day;
      if (n >= 30) {
        const value = share(p, n);
        if (!lowest || value < lowest.value) lowest = { value, day: mark.day };
      }
    }

    // Streaks: classes in a row, and weeks without a single miss.
    let run = 0;
    let streak = 0;
    for (const mark of marks) {
      run = mark.kind === "p" ? run + 1 : 0;
      streak = Math.max(streak, run);
    }
    const weeks = new Map();
    for (const mark of marks) {
      const number = keyToNumber(mark.day);
      const monday = number - ((new Date(number * DAY_MS).getUTCDay() + 6) % 7);
      const week = weeks.get(monday) || { p: 0, n: 0 };
      week.n += 1;
      if (mark.kind === "p") week.p += 1;
      weeks.set(monday, week);
    }
    const perfectWeeks = [...weeks.values()].filter((week) => week.n >= 5 && week.p === week.n).length;

    // Time in class, and first periods you turned up for.
    let minutes = 0;
    const firstStart = Math.min(...marks.map((mark) => mark.start).filter((start) => start > 0));
    let early = 0;
    for (const mark of marks) {
      if (mark.kind !== "p") continue;
      minutes += lengths.get(`${mark.code}@${mark.start}`) || 50;
      if (mark.start === firstStart) early += 1;
    }

    const days = new Map();
    for (const mark of marks) {
      const entry = days.get(mark.day) || { p: 0, a: 0 };
      entry[mark.kind] += 1;
      days.set(mark.day, entry);
    }

    const ledger = root.CuimsLedger?.normalize(data.ledger) || null;
    return {
      from: marks[0].day,
      to: marks[marks.length - 1].day,
      attended,
      delivered,
      percent: share(attended, delivered),
      bestDay: bestDay && { name: WEEKDAY_NAMES[bestDay.i], rate: bestDay.rate, n: bestDay.n },
      worstDay: worstDay && worstDay.missed > 0 ? { name: WEEKDAY_NAMES[worstDay.i], missed: worstDay.missed, n: worstDay.n } : null,
      topSubject,
      comeback,
      lowest,
      streak,
      perfectWeeks,
      weeks: weeks.size,
      hours: Math.round(minutes / 60),
      early,
      firstStart: Number.isFinite(firstStart) ? firstStart : null,
      days,
      subjects: subjectRows.sort((a, b) => b.rate - a.rate),
      ledger,
      best: Number(data.best) || 0,
    };
  }

  // ---- drawing ----

  const SANS = `"Avenir Next", Avenir, "Segoe UI Variable Display", "Segoe UI", "Helvetica Neue", sans-serif`;
  const MONO = `ui-monospace, Menlo, Consolas, "Courier New", monospace`;
  const font = (size, weight = 700, family = SANS) => `${weight} ${size}px ${family}`;

  // The three looks the cards rotate through, all in the mark's colours.
  function palettes(colours) {
    return {
      graphite: { bg: colours.brand, ink: colours.paper, muted: colours.muted, accent: colours.accent, line: colours.line },
      accent: { bg: colours.accent, ink: colours.brand, muted: "rgba(24,26,23,.62)", accent: colours.brand, line: "rgba(24,26,23,.14)" },
      paper: { bg: "#f6f3ea", ink: "#1d1c19", muted: "#6c685d", accent: colours.brand, line: "rgba(29,28,25,.12)", stamp: "#b4322a" },
    };
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // Draws text wrapped to `maxWidth`; returns the y below it.
  function paragraph(ctx, text, x, y, maxWidth, size, lineHeight, weight = 700, colour) {
    ctx.font = font(size, weight);
    if (colour) ctx.fillStyle = colour;
    for (const line of wrapText(ctx, text, maxWidth)) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    return y;
  }

  function frame(ctx, look, index, total, soFar) {
    ctx.fillStyle = look.bg;
    ctx.fillRect(0, 0, W, H);
    // The mark's two slashes, huge and faint, behind everything.
    ctx.save();
    ctx.fillStyle = look.line;
    ctx.font = font(1100, 800, MONO);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("//", W + 110, H + 120);
    ctx.restore();
    // Story progress, as on a phone.
    const gap = 10;
    const width = (W - 120 - gap * (total - 1)) / total;
    for (let i = 0; i < total; i += 1) {
      ctx.fillStyle = i <= index ? look.ink : look.line;
      ctx.globalAlpha = i <= index ? 0.9 : 1;
      ctx.fillRect(60 + i * (width + gap), 56, width, 8);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = look.ink;
    ctx.font = font(36, 800);
    ctx.fillText("CUIMS Clear", 60, 140);
    ctx.textAlign = "right";
    ctx.fillStyle = look.muted;
    ctx.font = font(32, 700);
    ctx.fillText(soFar ? "WRAPPED · SO FAR" : "SEMESTER WRAPPED", W - 60, 140);
    ctx.textAlign = "left";
  }

  function label(ctx, look, text, y) {
    ctx.fillStyle = look.muted;
    ctx.font = font(34, 800);
    ctx.save();
    ctx.letterSpacing = "6px";
    ctx.fillText(text.toUpperCase(), 80, y);
    ctx.restore();
  }

  function bigNumber(ctx, look, value, unit, y, size = 300) {
    ctx.fillStyle = look.ink;
    ctx.font = font(size, 800);
    ctx.save();
    ctx.letterSpacing = `${-size * 0.05}px`;
    ctx.fillText(value, 64, y);
    const w = ctx.measureText(value).width;
    ctx.restore();
    if (unit) {
      ctx.fillStyle = look.accent;
      ctx.font = font(size * 0.32, 800);
      ctx.fillText(unit, 64 + w + 18, y);
    }
  }

  function footer(ctx, look, text) {
    ctx.fillStyle = look.muted;
    ctx.font = font(30, 600);
    ctx.textAlign = "center";
    ctx.fillText(text, W / 2, H - 70);
    ctx.textAlign = "left";
  }

  // Every class day of the semester, a square each, weeks across.
  function miniHeatmap(ctx, look, s, x, y, width, colours) {
    const keys = [...s.days.keys()].sort();
    const first = keyToNumber(keys[0]);
    const last = keyToNumber(keys[keys.length - 1]);
    const monday = first - ((new Date(first * DAY_MS).getUTCDay() + 6) % 7);
    const weeks = Math.floor((last - monday) / 7) + 1;
    const cell = Math.min(46, Math.floor(width / weeks) - 6);
    const step = cell + 6;
    for (let w = 0; w < weeks; w += 1) {
      for (let d = 0; d < 6; d += 1) {
        const day = s.days.get(numberToKey(monday + w * 7 + d));
        const cx = x + w * step;
        const cy = y + d * step;
        if (!day) {
          ctx.fillStyle = look.line;
          ctx.fillRect(cx, cy, cell, cell);
          continue;
        }
        const total = day.p + day.a;
        ctx.fillStyle = colours.good;
        ctx.fillRect(cx, cy, cell, cell);
        if (day.a) {
          const h = Math.max(6, Math.round((cell * day.a) / total));
          ctx.fillStyle = colours.bad;
          ctx.fillRect(cx, cy + cell - h, cell, h);
        }
      }
    }
    return y + 6 * step;
  }

  // The cards, each a function drawing onto a context. Cards without the
  // numbers to back them are left out.
  function cards(s, colours, soFar) {
    const looks = palettes(colours);
    const list = [];
    const range = `${shortDate(s.from)} – ${shortDate(s.to)}`;

    list.push((ctx, i, n) => {
      const look = looks.graphite;
      frame(ctx, look, i, n, soFar);
      label(ctx, look, range, 700);
      ctx.fillStyle = look.ink;
      ctx.font = font(150, 800);
      ctx.fillText("Your", 64, 900);
      ctx.fillText("semester,", 64, 1060);
      ctx.fillStyle = look.accent;
      ctx.fillText("wrapped.", 64, 1220);
      paragraph(ctx, soFar ? "A peek at the semester so far. The full one opens on the last day of classes." : "Every class CUIMS posted, from the first day to the last.", 80, 1400, W - 160, 44, 62, 500, look.muted);
      footer(ctx, look, "Tap to go on");
    });

    list.push((ctx, i, n) => {
      const look = looks.accent;
      frame(ctx, look, i, n, soFar);
      label(ctx, look, "You showed up for", 520);
      bigNumber(ctx, look, String(s.attended), "", 840);
      paragraph(ctx, `of ${s.delivered} classes. That's ${fmt1(s.percent)}.`, 80, 960, W - 160, 64, 84, 800, look.ink);
      const y = miniHeatmap(ctx, look, s, 80, 1180, W - 160, { good: colours.brand, bad: colours.bad });
      paragraph(ctx, `${s.hours} hours in class, give or take.`, 80, y + 80, W - 160, 44, 60, 600, look.muted);
    });

    if (s.bestDay || s.worstDay) {
      list.push((ctx, i, n) => {
        const look = looks.graphite;
        frame(ctx, look, i, n, soFar);
        let y = 560;
        if (s.bestDay) {
          label(ctx, look, "Your day", y);
          ctx.fillStyle = look.accent;
          ctx.font = font(170, 800);
          ctx.fillText(`${s.bestDay.name}s`, 64, y + 190);
          y = paragraph(ctx, `${fmt1(s.bestDay.rate)} of ${s.bestDay.name} classes attended.`, 80, y + 290, W - 160, 48, 64, 600, look.ink) + 120;
        }
        if (s.worstDay) {
          label(ctx, look, "Your weak spot", y);
          ctx.fillStyle = look.ink;
          ctx.font = font(120, 800);
          ctx.fillText(`${s.worstDay.name}s`, 64, y + 150);
          paragraph(ctx, `${s.worstDay.missed} ${s.worstDay.missed === 1 ? "class" : "classes"} missed. We all have one.`, 80, y + 240, W - 160, 44, 60, 500, look.muted);
        }
      });
    }

    if (s.topSubject) {
      list.push((ctx, i, n) => {
        const look = looks.paper;
        frame(ctx, look, i, n, soFar);
        label(ctx, look, "Most faithful to", 480);
        let y = paragraph(ctx, s.topSubject.title, 80, 640, W - 160, 112, 124, 800, look.ink);
        bigNumber(ctx, look, String(Math.round(s.topSubject.rate)), "%", y + 220, 260);
        y += 330;
        if (s.comeback) {
          label(ctx, look, "Comeback of the semester", y + 60);
          y = paragraph(ctx, s.comeback.title, 80, y + 160, W - 160, 64, 76, 800, look.ink);
          paragraph(ctx, `${Math.round(s.comeback.first)}% in the first half, ${Math.round(s.comeback.second)}% in the second.`, 80, y + 20, W - 160, 44, 60, 500, look.muted);
        } else {
          // Every subject as a bar.
          for (const row of s.subjects.slice(0, 6)) {
            ctx.fillStyle = look.line;
            ctx.fillRect(80, y, W - 160, 22);
            ctx.fillStyle = row.rate >= 75 ? look.ink : look.stamp;
            ctx.fillRect(80, y, ((W - 160) * row.rate) / 100, 22);
            ctx.fillStyle = look.muted;
            ctx.font = font(30, 600);
            ctx.fillText(`${row.title.slice(0, 34)} · ${Math.round(row.rate)}%`, 80, y + 66);
            y += 116;
          }
        }
      });
    }

    if (s.lowest) {
      list.push((ctx, i, n) => {
        const look = looks.graphite;
        frame(ctx, look, i, n, soFar);
        // Never near the line: a lowest point, not a close call.
        const safe = s.lowest.value >= 85;
        label(ctx, look, safe ? "Your lowest point" : "The closest call", 520);
        ctx.fillStyle = look.ink;
        ctx.font = font(96, 800);
        ctx.fillText(shortDate(s.lowest.day), 64, 660);
        bigNumber(ctx, look, (Math.floor(s.lowest.value * 10) / 10).toFixed(1), "%", 940, 250);
        const climbed = s.percent >= s.lowest.value + 0.5;
        const copy = safe
          ? `Even at your lowest, nowhere near the line.${climbed ? ` Now ${fmt1(s.percent)}.` : ""}`
          : climbed
            ? `The lowest you got. You climbed back to ${fmt1(s.percent)}.`
            : "The lowest you got, and you're still right there. Careful.";
        paragraph(ctx, copy, 80, 1080, W - 160, 52, 70, 600, look.muted);
        label(ctx, look, "Longest streak", 1400);
        ctx.fillStyle = look.accent;
        ctx.font = font(150, 800);
        ctx.fillText(`${s.streak}`, 64, 1570);
        const w = ctx.measureText(`${s.streak}`).width;
        ctx.fillStyle = look.ink;
        ctx.font = font(52, 700);
        ctx.fillText("classes in a row", 64 + w + 24, 1570);
        if (s.perfectWeeks) paragraph(ctx, `${s.perfectWeeks} perfect ${s.perfectWeeks === 1 ? "week" : "weeks"}, not one class missed.`, 80, 1660, W - 160, 44, 60, 500, look.muted);
      });
    }

    list.push((ctx, i, n) => {
      const look = looks.accent;
      frame(ctx, look, i, n, soFar);
      label(ctx, look, "And CUIMS Clear", 480);
      const l = s.ledger || {};
      const rows = [
        ["captchas read", l.captchas],
        ["logins pressed", l.logins],
        ["pop-ups hidden", l.hidden],
        ["attendance reads", l.reads],
      ].filter(([, value]) => value > 0);
      let y = 620;
      if (rows.length) {
        for (const [what, value] of rows) {
          ctx.fillStyle = look.ink;
          ctx.font = font(130, 800);
          ctx.fillText(Number(value).toLocaleString("en-IN"), 64, y + 110);
          const w = ctx.measureText(Number(value).toLocaleString("en-IN")).width;
          ctx.font = font(46, 700);
          ctx.fillText(what, 64 + w + 22, y + 110);
          y += 170;
        }
      } else {
        y = paragraph(ctx, "kept out of the way, which was the point.", 80, y + 60, W - 160, 64, 80, 800, look.ink);
      }
      if (s.best) paragraph(ctx, `Proxy Run best: ${s.best} classes.`, 80, y + 60, W - 160, 44, 60, 600, look.muted);
      ctx.fillStyle = look.ink;
      ctx.font = font(90, 800);
      ctx.fillText("See you next", 64, 1600);
      ctx.fillText("semester.", 64, 1700);
    });
    return list;
  }

  function colours() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      brand: v("--brand-bg", "#181a17"),
      paper: v("--hero-ink", "#ededec"),
      muted: v("--hero-muted", "#b0b1b0"),
      line: v("--hero-line", "#363835"),
      accent: v("--brand-ink", "#b7f34a"),
      bad: "#c9553f",
    };
  }

  function draw(card, index, total) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    card(canvas.getContext("2d"), index, total);
    return canvas;
  }

  // ---- the viewer ----

  // A full-popup story: tap the right two thirds (or →) for the next card,
  // the left third (or ←) for the one before; Esc closes.
  function open(host, s, { soFar = false, announce } = {}) {
    const list = cards(s, colours(), soFar);
    let index = 0;
    const overlay = document.createElement("div");
    overlay.className = "wrapped";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", soFar ? "Semester Wrapped, so far" : "Semester Wrapped");
    overlay.innerHTML = `
      <div class="wrapped-stage"><canvas class="wrapped-canvas" width="${W}" height="${H}" tabindex="0"></canvas></div>
      <p class="sr-only" aria-live="polite" id="wrapped-live"></p>
      <div class="wrapped-bar">
        <button type="button" class="wrapped-button is-quiet" data-wrapped="close">Close</button>
        <span class="wrapped-count" id="wrapped-count"></span>
        <button type="button" class="wrapped-button" data-wrapped="save">Save card</button>
      </div>`;
    host.append(overlay);
    const canvas = overlay.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const live = overlay.querySelector("#wrapped-live");
    const count = overlay.querySelector("#wrapped-count");
    const previous = document.activeElement;

    const DESCRIBE = ["The opening card.", `${s.attended} of ${s.delivered} classes attended, ${fmt1(s.percent)}.`];
    function paint() {
      ctx.clearRect(0, 0, W, H);
      list[index](ctx, index, list.length);
      count.textContent = `${index + 1} / ${list.length}`;
      live.textContent = `Card ${index + 1} of ${list.length}. ${DESCRIBE[index] || ""}`;
    }
    function go(step) {
      const next = index + step;
      if (next < 0) return;
      if (next >= list.length) return close();
      index = next;
      paint();
    }
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    }
    function save() {
      draw(list[index], index, list.length).toBlob((blob) => {
        if (!blob) return announce?.("Couldn't draw the card.");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `cuims-clear-wrapped-${index + 1}.png`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        announce?.("Card saved to Downloads.");
      }, "image/png");
    }
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    }
    canvas.addEventListener("click", (event) => {
      const bounds = canvas.getBoundingClientRect();
      go(event.clientX - bounds.left < bounds.width / 3 ? -1 : 1);
    });
    overlay.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-wrapped]")?.dataset.wrapped;
      if (action === "close") close();
      else if (action === "save") save();
    });
    document.addEventListener("keydown", onKey, true);
    paint();
    canvas.focus({ preventScroll: true });
    return { close, go };
  }

  root.CuimsWrapped = { stats, cards, open, draw, W, H };
})(globalThis);
