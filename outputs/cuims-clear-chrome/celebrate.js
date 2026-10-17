// The 1.0 page: CUIMS Clear reached 100 students on the Chrome Web Store.
// Four things, all on this device and none of them a request to CUIMS:
//   - the Founding 100 stamp, for anyone who had it before 1.0;
//   - a receipt of what it did (ledger.js) and of the semester so far;
//   - Proxy Run (proxy-run.js);
//   - a time capsule: one line to yourself, sealed until the last day of
//     classes (academic-calendar.js), opened with your attendance beside it.
(function (root) {
  const DAY_MS = 86_400_000;
  const NOTE_MAX = 240;
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const KEYS = {
    founding: null,
    cuimsLedger: null,
    timeCapsule: null,
    clubSeen: null,
    attendanceSnapshot: null,
    attendanceHistory: null,
    uid: "",
    academicCalendar: "auto",
    proxyRunBest: 0,
    attendanceTimetable: null,
    attendanceDateSheet: null,
  };
  // Signs the extension was in use before 1.0, for when the update event
  // was missed (celebrate-bg.js decides on install or update).
  const EARLIER = ["uid", "attendanceSnapshot", "rateNudge", "updateDone", "popupView"];

  const esc = (value) => root.CuimsAttendance?.escapeHtml?.(String(value ?? "")) ?? String(value ?? "");
  const pad = (n) => String(n).padStart(2, "0");

  function dayKeyOf(date) {
    return root.CuimsAttendance?.campusParts?.(date)?.key || date.toISOString().slice(0, 10);
  }

  function keyToNumber(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return y && m && d ? Math.floor(Date.UTC(y, m - 1, d) / DAY_MS) : null;
  }

  function numberToKey(number) {
    return new Date(number * DAY_MS).toISOString().slice(0, 10);
  }

  // "16 OCT 2026"
  function stampDate(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return y ? `${pad(d)} ${MONTHS[m - 1]} ${y}` : "";
  }

  // "16 Oct"
  function shortDate(key) {
    const [, m, d] = String(key).split("-").map(Number);
    return m ? `${d} ${MONTHS[m - 1][0]}${MONTHS[m - 1].slice(1).toLowerCase()}` : "";
  }

  function duration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 1) return seconds > 0 ? "< 1 MIN" : "0 MIN";
    if (minutes < 60) return `${minutes} MIN`;
    return `${Math.floor(minutes / 60)}H ${pad(minutes % 60)}M`;
  }

  const thousands = (n) => Number(n || 0).toLocaleString("en-IN");

  // ---- the semester, from what the Attendance tab already has ----

  function semesterStats(snapshot, history, calendar) {
    const A = root.CuimsAttendance;
    if (!snapshot?.subjects?.length || !A?.buildAnalytics) return null;
    let analytics;
    try {
      analytics = A.buildAnalytics(snapshot, new Date(), { calendar });
    } catch {
      return null;
    }
    const overall = analytics.overall;
    if (!(overall?.delivered > 0)) return null;
    const marks = [];
    for (const subject of Object.values(history?.subjects || {})) {
      for (const mark of subject?.marks || []) if (mark?.[2] === "p" || mark?.[2] === "a") marks.push(mark);
    }
    marks.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));
    let streak = 0;
    let run = 0;
    const missed = new Array(7).fill(0);
    for (const [day, , kind] of marks) {
      if (kind === "p") {
        run += 1;
        streak = Math.max(streak, run);
      } else {
        run = 0;
        const number = keyToNumber(day);
        if (number != null) missed[new Date(number * DAY_MS).getUTCDay()] += 1;
      }
    }
    const most = Math.max(...missed);
    const best = [...analytics.subjects].filter((row) => row.percent != null).sort((a, b) => b.percent - a.percent)[0];
    return {
      attended: overall.attended,
      delivered: overall.delivered,
      percent: overall.percent,
      streak: marks.length ? streak : 0,
      missedDay: most > 0 ? WEEKDAYS[missed.indexOf(most)] : marks.length ? "NONE. LEGEND." : "",
      best: best ? { title: best.title, percent: best.percent } : null,
    };
  }

  // ---- the receipt: one list of lines, drawn as HTML and as an image ----

  function receiptLines(data) {
    const L = root.CuimsLedger;
    const ledger = L.normalize(data.ledger);
    const now = new Date();
    const lines = [];
    lines.push({ t: "brand" });
    lines.push({ t: "center", text: "CUIMS CLEAR", cls: "r-title" });
    lines.push({ t: "center", text: "student-built · runs on your device", cls: "r-small" });
    lines.push({ t: "gap" });
    lines.push({ t: "row", l: `ORDER #${data.version}`, r: `${stampDate(dayKeyOf(now))} ${pad(now.getHours())}:${pad(now.getMinutes())}` });
    lines.push({ t: "row", l: "SERVED BY", r: "YOUR OWN BROWSER" });
    lines.push({ t: "row", l: "SENT TO SERVERS", r: "NOTHING" });
    if (data.founder) lines.push({ t: "row", l: "FOUNDING MEMBER", r: data.from ? `SINCE v${data.from}` : "BEFORE 1.0" });

    const s = data.semester;
    if (s) {
      lines.push({ t: "rule" });
      lines.push({ t: "head", text: "THIS SEMESTER" });
      lines.push({ t: "row", l: "CLASSES ATTENDED", r: thousands(s.attended) });
      lines.push({ t: "row", l: "CLASSES HELD", r: thousands(s.delivered) });
      lines.push({ t: "row", l: "ATTENDANCE", r: `${(Math.floor(s.percent * 10) / 10).toFixed(1)} %`, cls: "r-strong" });
      if (s.streak > 1) lines.push({ t: "row", l: "LONGEST STREAK", r: `${s.streak} IN A ROW` });
      if (s.missedDay) lines.push({ t: "row", l: "MOST-MISSED DAY", r: s.missedDay });
      if (s.best) {
        lines.push({ t: "row", l: "TOP SUBJECT", r: `${Math.round(s.best.percent)} %` });
        for (const text of fitLines(s.best.title.toUpperCase(), 30, 2)) lines.push({ t: "indent", text });
      }
    }

    lines.push({ t: "rule" });
    const counted = ledger.captchas + ledger.logins + ledger.hidden + ledger.reads;
    lines.push({ t: "head", text: ledger.since ? `DONE FOR YOU · SINCE ${stampDate(dayKeyOf(new Date(ledger.since))).slice(0, 6)}` : "DONE FOR YOU" });
    if (!counted) {
      lines.push({ t: "note", text: "Counting from 1.0. Sign in a few times and print again." });
    } else {
      lines.push({ t: "row", l: "CAPTCHAS READ", r: thousands(ledger.captchas) });
      if (ledger.codes.length) lines.push({ t: "codes", codes: ledger.codes.slice(-12) });
      lines.push({ t: "row", l: "LOGINS PRESSED", r: thousands(ledger.logins) });
      lines.push({ t: "row", l: "POP-UPS HIDDEN", r: thousands(ledger.hidden) });
      lines.push({ t: "row", l: "ATTENDANCE READS", r: thousands(ledger.reads) });
      lines.push({ t: "rule" });
      lines.push({ t: "row", l: "KEYS NOT PRESSED", r: thousands(L.keystrokes(ledger, data.uidLength || 10)) });
      lines.push({ t: "row", l: "TIME BACK (ABOUT)", r: duration(L.savedSeconds(ledger)), cls: "r-strong" });
    }
    if (data.best > 0) lines.push({ t: "row", l: "PROXY RUN BEST", r: `${data.best} CLASSES` });

    lines.push({ t: "double" });
    // Founders' stamp lands here, like a PAID stamp.
    lines.push({ t: "row", l: "TOTAL", r: "₹0.00", cls: "r-total", stamp: Boolean(data.founder) });
    lines.push({ t: "row", l: "PAID WITH", r: "ATTENDANCE" });
    lines.push({ t: "double" });
    lines.push({ t: "barcode", seed: `${data.version}${ledger.codes.join("")}${ledger.captchas}` });
    lines.push({ t: "center", text: "THANK YOU. COME AGAIN.", cls: "r-thanks" });
    lines.push({ t: "center", text: "(you will. it's CUIMS.)", cls: "r-small" });
    return lines;
  }

  // Words onto lines of at most `width` characters; past `max` lines the
  // last one ends in an ellipsis.
  function fitLines(text, width, max) {
    const lines = [];
    let line = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    const out = lines.slice(0, max).map((entry) => (entry.length > width ? `${entry.slice(0, width - 1)}…` : entry));
    if (lines.length > max) out[max - 1] = `${out[max - 1].slice(0, width - 1).replace(/\s+\S*$/, "")}…`;
    return out;
  }

  // Bar widths from a string: a pretend barcode that is the same for the
  // same receipt.
  function bars(seed, count = 46) {
    let h = 2166136261;
    const out = [];
    for (let i = 0; i < count; i += 1) {
      h ^= seed.charCodeAt(i % Math.max(1, seed.length)) + i;
      h = Math.imul(h, 16777619) >>> 0;
      out.push(1 + (h % 3));
    }
    return out;
  }

  function barcodeSvg(seed) {
    const widths = bars(seed);
    let x = 0;
    let rects = "";
    widths.forEach((w, i) => {
      if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="34"/>`;
      x += w + 1;
    });
    return `<svg class="r-barcode" viewBox="0 0 ${x} 34" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
  }

  function receiptHtml(lines) {
    return lines
      .map((line, i) => {
        const style = ` style="--i:${i}"`;
        switch (line.t) {
          case "brand":
            return `<div class="r-line r-brand"${style} aria-hidden="true"><span>//</span></div>`;
          case "center":
            return `<p class="r-line r-center ${line.cls || ""}"${style}>${esc(line.text)}</p>`;
          case "gap":
            return `<div class="r-line r-gap"${style}></div>`;
          case "row":
            return `<p class="r-line r-row ${line.cls || ""}"${style}><span>${esc(line.l)}</span><span>${esc(line.r)}</span>${line.stamp ? `<span class="r-stamp" role="img" aria-label="Founding 100 stamp: you used CUIMS Clear before 1.0">${stampSvg()}</span>` : ""}</p>`;
          case "indent":
            return `<p class="r-line r-indent"${style}>${esc(line.text)}</p>`;
          case "head":
            return `<p class="r-line r-head"${style}>${esc(line.text)}</p>`;
          case "note":
            return `<p class="r-line r-note"${style}>${esc(line.text)}</p>`;
          case "codes":
            return `<p class="r-line r-codes"${style} aria-label="Latest codes read: ${esc(line.codes.join(", "))}">${line.codes.map((code) => `<span>${esc(code)}</span>`).join("")}</p>`;
          case "rule":
            return `<div class="r-line r-rule"${style}></div>`;
          case "double":
            return `<div class="r-line r-double"${style}></div>`;
          case "barcode":
            return `<div class="r-line r-bar"${style}>${barcodeSvg(line.seed)}</div>`;
          default:
            return "";
        }
      })
      .join("");
  }

  // The same receipt as a 1080×1920 picture: a phone story, receipt in the
  // middle of the mark's graphite.
  function receiptImage(lines, colours, stamp) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");
    const mono = (size, weight = 700) => `${weight} ${size}px "Courier New", Courier, "Nimbus Mono PS", monospace`;
    const sans = (size, weight = 800) => `${weight} ${size}px "Avenir Next", Avenir, Inter, -apple-system, "Segoe UI", sans-serif`;

    ctx.fillStyle = colours.bg;
    ctx.fillRect(0, 0, 1080, 1920);
    // The mark's two slashes, huge and faint.
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = colours.accent;
    ctx.font = "800 1100px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("//", 540, 1560);
    ctx.restore();

    ctx.fillStyle = colours.ink;
    ctx.font = sans(40);
    ctx.fillText("CUIMS Clear", 160, 150);
    ctx.fillStyle = colours.accent;
    ctx.font = sans(40);
    ctx.textAlign = "right";
    ctx.fillText("1.0", 920, 150);
    ctx.textAlign = "left";

    // The paper on its own canvas, then scaled into the space between the
    // header and the footer.
    const paper = paperCanvas(lines, colours, stamp);
    const room = { top: 200, bottom: 1780 };
    const fit = Math.min(1, (room.bottom - room.top) / paper.height, 820 / paper.width);
    const w = paper.width * fit;
    const h = paper.height * fit;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.drawImage(paper, (1080 - w) / 2, room.top + (room.bottom - room.top - h) / 2, w, h);
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = colours.muted;
    ctx.font = sans(30, 600);
    ctx.fillText("CUIMS Clear on the Chrome Web Store and Firefox Add-ons", 540, 1860);
    return canvas;
  }

  function paperCanvas(lines, colours, stamp) {
    const mono = (size, weight = 700) => `${weight} ${size}px "Courier New", Courier, "Nimbus Mono PS", monospace`;
    const width = 760;
    const left = 0;
    const top = 0;
    const pad = 54;
    const tooth = 20;
    const lh = { brand: 120, center: 44, gap: 20, row: 44, indent: 38, head: 54, note: 76, codes: 84, rule: 34, double: 38, barcode: 118 };
    const height = lines.reduce((sum, line) => sum + (lh[line.t] || 40), 0) + pad * 2;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height + tooth;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.fillStyle = colours.paper;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + width, top);
    // Torn bottom edge.
    ctx.lineTo(left + width, top + height);
    for (let x = left + width; x > left; x -= tooth) {
      ctx.lineTo(x - tooth / 2, top + height + tooth / 2);
      ctx.lineTo(x - tooth, top + height);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    let y = top + pad;
    let stampAt = null;
    const inner = { l: left + pad, r: left + width - pad, c: left + width / 2 };
    ctx.fillStyle = colours.paperInk;
    ctx.strokeStyle = colours.paperInk;
    for (const line of lines) {
      const h = lh[line.t] || 40;
      ctx.textBaseline = "middle";
      const mid = y + h / 2;
      if (line.t === "brand") {
        ctx.fillRect(inner.c - 40, y + 10, 80, 80);
        ctx.fillStyle = colours.paper;
        ctx.font = "800 58px ui-monospace, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillText("//", inner.c, y + 52);
        ctx.fillStyle = colours.paperInk;
      } else if (line.t === "center") {
        const size = line.cls === "r-title" ? 46 : line.cls === "r-small" ? 24 : line.cls === "r-founder" ? 34 : 30;
        ctx.font = mono(size, line.cls === "r-small" ? 400 : 700);
        ctx.textAlign = "center";
        ctx.fillText(line.text, inner.c, mid);
      } else if (line.t === "row") {
        if (line.stamp) stampAt = { x: inner.c + 10, y: mid + 20 };
        const size = line.cls === "r-total" ? 40 : 28;
        ctx.font = mono(size);
        ctx.textAlign = "left";
        ctx.fillText(line.l, inner.l, mid);
        ctx.textAlign = "right";
        ctx.fillText(line.r, inner.r, mid);
      } else if (line.t === "indent") {
        ctx.font = mono(22, 400);
        ctx.textAlign = "left";
        ctx.fillText(line.text, inner.l + 24, mid);
      } else if (line.t === "head") {
        ctx.font = mono(26);
        ctx.textAlign = "left";
        ctx.fillText(line.text, inner.l, mid + 4);
      } else if (line.t === "note") {
        ctx.font = mono(24, 400);
        ctx.textAlign = "left";
        const words = line.text.split(" ");
        let row = "";
        let ry = y + 22;
        for (const word of words) {
          if (ctx.measureText(`${row} ${word}`).width > inner.r - inner.l && row) {
            ctx.fillText(row, inner.l, ry);
            row = word;
            ry += 32;
          } else row = row ? `${row} ${word}` : word;
        }
        ctx.fillText(row, inner.l, ry);
      } else if (line.t === "codes") {
        ctx.font = mono(24, 400);
        ctx.textAlign = "left";
        const step = (inner.r - inner.l - 24) / 6;
        line.codes.forEach((code, i) => ctx.fillText(code, inner.l + 24 + (i % 6) * step, y + 22 + Math.floor(i / 6) * 34));
      } else if (line.t === "rule" || line.t === "double") {
        ctx.save();
        ctx.lineWidth = 3;
        ctx.setLineDash(line.t === "rule" ? [10, 9] : []);
        ctx.beginPath();
        ctx.moveTo(inner.l, mid);
        ctx.lineTo(inner.r, mid);
        if (line.t === "double") {
          ctx.moveTo(inner.l, mid + 8);
          ctx.lineTo(inner.r, mid + 8);
        }
        ctx.stroke();
        ctx.restore();
      } else if (line.t === "barcode") {
        const widths = bars(line.seed);
        const total = widths.reduce((sum, w) => sum + w + 1, 0);
        const unit = (inner.r - inner.l) / total;
        let x = inner.l;
        widths.forEach((w, i) => {
          if (i % 2 === 0) ctx.fillRect(x, y + 14, w * unit, 86);
          x += (w + 1) * unit;
        });
      }
      y += h;
    }
    if (stamp && stampAt) {
      const size = 250;
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.globalCompositeOperation = "multiply";
      ctx.translate(stampAt.x, stampAt.y);
      ctx.rotate((-13 * Math.PI) / 180);
      ctx.drawImage(stamp, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    return canvas;
  }

  // The stamp as a picture for the saved image, in the receipt's ink.
  function loadStamp(colour) {
    const svg = stampSvg()
      .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="264" height="264" style="color:${colour}" font-family="Avenir Next, Avenir, Inter, Segoe UI, sans-serif" `);
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  }

  function imageColours() {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      bg: v("--brand-bg", "#181a17"),
      ink: v("--hero-ink", "#ededec"),
      muted: v("--hero-muted", "#b0b1b0"),
      accent: v("--brand-ink", "#b7f34a"),
      paper: "#f6f3ea",
      paperInk: "#23221f",
      stamp: "#b4322a",
    };
  }

  // ---- the stamp ----

  function stampSvg() {
    const ring = "FOUNDING 100 ★ CUIMS CLEAR ★ BEFORE 1.0 ★ ";
    return `<svg viewBox="0 0 132 132" aria-hidden="true">
      <defs>
        <filter id="club-ink" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.4" result="rough"/>
          <feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="3" seed="5" result="speck"/>
          <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -7 5.1" result="holes"/>
          <feComposite in="rough" in2="holes" operator="in"/>
        </filter>
        <path id="club-ring" d="M66 66 m-49 0 a49 49 0 1 1 98 0 a49 49 0 1 1 -98 0"/>
      </defs>
      <g filter="url(#club-ink)">
        <circle cx="66" cy="66" r="62" fill="none" stroke="currentColor" stroke-width="3.2"/>
        <circle cx="66" cy="66" r="39" fill="none" stroke="currentColor" stroke-width="1.4"/>
        <text font-size="10.2" font-weight="800" letter-spacing="1.1" fill="currentColor"><textPath href="#club-ring" textLength="304" lengthAdjust="spacing">${ring}</textPath></text>
        <text x="66" y="56" text-anchor="middle" font-size="12" font-weight="800" fill="currentColor" font-family="ui-monospace, Menlo, monospace" letter-spacing="-2">//</text>
        <text x="66" y="80" text-anchor="middle" font-size="27" font-weight="900" fill="currentColor" letter-spacing="-1">100</text>
        <text x="66" y="92" text-anchor="middle" font-size="6.6" font-weight="800" fill="currentColor" letter-spacing="1.2">EST. 2026</text>
      </g>
    </svg>`;
  }

  // ---- every class, day by day ----

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Each class day of the semester as a square, weeks across, Monday to
  // Saturday down: green as far as you were there, red for what you missed.
  function heatmapModel(history, calendar, todayKey) {
    const A = root.CuimsAttendance;
    const days = new Map();
    for (const subject of Object.values(history?.subjects || {})) {
      for (const mark of subject?.marks || []) {
        const [day, , kind] = mark || [];
        if ((kind !== "p" && kind !== "a") || keyToNumber(day) == null) continue;
        const entry = days.get(day) || { p: 0, a: 0 };
        entry[kind] += 1;
        days.set(day, entry);
      }
    }
    if (days.size < 3) return null;
    const keys = [...days.keys()].sort();
    const today = keyToNumber(todayKey);
    const firstMark = keyToNumber(keys[0]);
    const lastMark = keyToNumber(keys[keys.length - 1]);
    const first = firstMark;
    const lastTeach = A?.lastTeachingDay?.(today, { calendar });
    const last = Math.max(lastMark, lastTeach != null && lastTeach >= today && lastTeach - today < 120 ? lastTeach : today);
    const monday = first - ((new Date(first * DAY_MS).getUTCDay() + 6) % 7);
    const weeks = Math.floor((last - monday) / 7) + 1;
    const cells = [];
    for (let w = 0; w < weeks; w += 1) {
      for (let d = 0; d < 6; d += 1) {
        const n = monday + w * 7 + d;
        const key = numberToKey(n);
        const entry = days.get(key) || null;
        const reason = entry ? null : A?.noClassReason?.(key, { calendar });
        cells.push({ w, d, key, entry, today: n === today, future: n > today, off: Boolean(reason && reason.kind !== "over"), reason: reason?.label || "" });
      }
    }
    let perfect = 0;
    let run = 0;
    let bestRun = 0;
    const months = new Map();
    for (const key of keys) {
      const entry = days.get(key);
      if (entry.a === 0) {
        perfect += 1;
        run += 1;
        bestRun = Math.max(bestRun, run);
      } else run = 0;
      const month = months.get(key.slice(0, 7)) || { p: 0, n: 0 };
      month.p += entry.p;
      month.n += entry.p + entry.a;
      months.set(key.slice(0, 7), month);
    }
    const best = [...months.entries()].filter(([, month]) => month.n >= 20).sort((a, b) => b[1].p / b[1].n - a[1].p / a[1].n)[0];
    return {
      cells,
      weeks,
      monday,
      days: keys.length,
      perfect,
      bestRun,
      bestMonth: best ? { name: MONTH_NAMES[Number(best[0].slice(5, 7)) - 1], rate: (best[1].p / best[1].n) * 100 } : null,
    };
  }

  function heatmapSvg(model) {
    const cell = 11;
    const step = 13;
    const left = 14;
    const top = 14;
    const width = left + model.weeks * step;
    const height = top + 6 * step;
    let out = `<svg class="heat-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Attendance by day, ${model.days} class days">`;
    out += `<defs><pattern id="heat-off" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" class="heat-off-bg"/><rect width="1.6" height="4" class="heat-off-line"/></pattern></defs>`;
    ["M", "", "W", "", "F", ""].forEach((name, d) => {
      if (name) out += `<text x="0" y="${top + d * step + 9}" class="heat-label">${name}</text>`;
    });
    let lastMonth = "";
    for (let w = 0; w < model.weeks; w += 1) {
      const key = numberToKey(model.monday + w * 7);
      const month = key.slice(5, 7);
      if (month !== lastMonth && w < model.weeks - 1) {
        out += `<text x="${left + w * step}" y="9" class="heat-label">${MONTHS[Number(month) - 1][0]}${MONTHS[Number(month) - 1].slice(1).toLowerCase()}</text>`;
        lastMonth = month;
      }
    }
    for (const c of model.cells) {
      const x = left + c.w * step;
      const y = top + c.d * step;
      const when = shortDate(c.key);
      if (c.entry) {
        const total = c.entry.p + c.entry.a;
        const h = c.entry.a ? Math.max(2.5, (cell * c.entry.a) / total) : 0;
        out += `<g class="heat-day${c.today ? " is-today" : ""}"><title>${esc(`${when}: ${c.entry.p} of ${total} ${total === 1 ? "class" : "classes"}`)}</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" class="heat-p"/>`;
        if (h) out += `<rect x="${x}" y="${(y + cell - h).toFixed(2)}" width="${cell}" height="${h.toFixed(2)}" rx="${c.entry.p ? 1 : 2.5}" class="heat-a"/>`;
        out += `</g>`;
      } else if (c.off && !c.future) {
        out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="url(#heat-off)"><title>${esc(`${when}: ${c.reason}`)}</title></rect>`;
      } else if (c.future) {
        out += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${cell - 1}" height="${cell - 1}" rx="2.5" class="heat-future${c.today ? " is-today" : ""}"/>`;
      } else {
        out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" class="heat-none${c.today ? " is-today" : ""}"/>`;
      }
    }
    return `${out}</svg>`;
  }

  // ---- the time capsule ----

  // The last day of classes this semester, or of the next one when this
  // one is nearly over. A plain three months when the calendar runs out.
  function capsuleOpensOn(todayKey, calendar, exams) {
    const A = root.CuimsAttendance;
    const today = keyToNumber(todayKey);
    for (const ahead of [0, 30, 60, 90, 120, 150, 180]) {
      const last = A?.lastTeachingDay?.(today + ahead, { calendar, exams });
      if (last != null && last >= today + 7) return numberToKey(last);
    }
    return numberToKey(today + 90);
  }

  function capsuleHtml(capsule, ctx) {
    const today = ctx.todayKey;
    if (!capsule) {
      const opens = capsuleOpensOn(today, ctx.calendar, ctx.exams);
      return `
        <div class="capsule-write">
          <p class="capsule-copy">Write one line to yourself. It stays sealed on this device until <strong>${esc(shortDate(opens))}</strong>, the last day of classes, then opens with your attendance beside it.</p>
          <label class="sr-only" for="capsule-note">A line to yourself</label>
          <textarea id="capsule-note" class="capsule-note" maxlength="${NOTE_MAX}" rows="3" placeholder="Dear me, by now you…"></textarea>
          <div class="capsule-actions">
            <span class="capsule-count" id="capsule-count">${NOTE_MAX}</span>
            <button type="button" class="capsule-seal" data-capsule="seal" data-opens="${esc(opens)}" disabled>Seal until ${esc(shortDate(opens))}</button>
          </div>
        </div>`;
    }
    const open = capsule.broken || today >= capsule.opensOn;
    if (!open) {
      const days = keyToNumber(capsule.opensOn) - keyToNumber(today);
      return `
        <div class="capsule-sealed">
          <div class="envelope" role="img" aria-label="A sealed envelope">
            <span class="envelope-flap"></span>
            <span class="envelope-seal" aria-hidden="true"><span>//</span></span>
          </div>
          <div>
            <p class="capsule-when">Opens ${esc(shortDate(capsule.opensOn))}</p>
            <p class="capsule-copy">Sealed ${esc(shortDate(capsule.sealedOn))}. ${days === 1 ? "Tomorrow." : `${days} days to go.`}</p>
            <button type="button" class="text-button capsule-break" data-capsule="break">Open it early</button>
          </div>
        </div>`;
    }
    const then = capsule.percent;
    const now = ctx.percent;
    const fmt = (p) => (p == null ? "—" : `${(Math.floor(p * 10) / 10).toFixed(1)}%`);
    const delta = then != null && now != null ? now - then : null;
    return `
      <div class="capsule-letter">
        <p class="letter-from">From you, ${esc(shortDate(capsule.sealedOn))}</p>
        <blockquote class="letter-note">${esc(capsule.note)}</blockquote>
        <dl class="letter-then">
          <div><dt>Then</dt><dd>${fmt(then)}</dd></div>
          <div><dt>Now</dt><dd>${fmt(now)}</dd></div>
          ${delta == null ? "" : `<div class="${delta >= 0 ? "is-up" : "is-down"}"><dt>Change</dt><dd>${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}</dd></div>`}
        </dl>
        <button type="button" class="text-button" data-capsule="again">Write the next one</button>
      </div>`;
  }

  // ---- the page ----

  function mount(view, { announce } = {}) {
    let data = null;
    let game = null;
    let shown = false;
    let breakArmed = false;
    let breakTimer;
    let pendingPlay = false;

    function load(done) {
      chrome.storage.local.get({ ...KEYS, ...Object.fromEntries(EARLIER.map((key) => [key, null])) }, (stored) => {
        let founding = stored.founding;
        if (!founding || typeof founding !== "object") {
          const earlier = EARLIER.some((key) => stored[key]);
          founding = { founder: earlier, from: "", at: Date.now() };
          chrome.storage.local.set({ founding });
        }
        const calendar = root.CuimsAttendance?.calendarFor?.(stored.academicCalendar, stored.uid) || "cu";
        const semester = semesterStats(stored.attendanceSnapshot, stored.attendanceHistory, calendar);
        data = {
          founding,
          founder: founding.founder === true,
          from: founding.founder === true ? String(founding.from || "") : "",
          ledger: stored.cuimsLedger,
          capsule: stored.timeCapsule && typeof stored.timeCapsule === "object" ? stored.timeCapsule : null,
          seen: stored.clubSeen && typeof stored.clubSeen === "object" ? stored.clubSeen : {},
          semester,
          calendar,
          exams: Array.isArray(stored.attendanceSnapshot?.exams) ? stored.attendanceSnapshot.exams : [],
          uidLength: String(stored.uid || "").length,
          best: Number(stored.proxyRunBest) || 0,
          version: chrome.runtime.getManifest().version,
          snapshot: stored.attendanceSnapshot,
          history: stored.attendanceHistory,
          timetable: Array.isArray(stored.attendanceTimetable?.slots) ? stored.attendanceTimetable.slots : Array.isArray(stored.attendanceSnapshot?.slots) ? stored.attendanceSnapshot.slots : [],
          sheet: Array.isArray(stored.attendanceDateSheet?.exams) ? stored.attendanceDateSheet.exams : [],
          todayKey: dayKeyOf(new Date()),
        };
        done?.(data);
      });
    }

    function receiptCard(printing) {
      const lines = receiptLines(data);
      return `
        <section class="club-card receipt-card" aria-labelledby="receipt-title">
          <div class="section-head">
            <h2 class="section-label" id="receipt-title">CUIMS Clear 1.0 · your receipt</h2>
            <button type="button" class="text-button" data-receipt="print">Print again</button>
          </div>
          <div class="printer" aria-hidden="true"><span class="printer-light"></span><span class="printer-slot"></span></div>
          <div class="receipt-roll">
            <article class="receipt${printing ? " is-printing" : ""}" style="--lines:${lines.length}" aria-label="Receipt">${receiptHtml(lines)}</article>
          </div>
          <div class="receipt-actions">
            <button type="button" class="receipt-button" data-receipt="save">Save image</button>
            <button type="button" class="receipt-button is-quiet" data-receipt="copy">Copy image</button>
          </div>
        </section>`;
    }

    // Semester Wrapped: sealed like the capsule until the last teaching day.
    function wrappedCard() {
      const last = root.CuimsAttendance?.lastTeachingDay?.(keyToNumber(data.todayKey), { calendar: data.calendar });
      const opens = last != null ? numberToKey(last) : capsuleOpensOn(data.todayKey, data.calendar, data.exams);
      const open = last != null && keyToNumber(data.todayKey) >= last;
      const ready = Boolean(root.CuimsWrapped && data.history && Object.keys(data.history.subjects || {}).length);
      const days = keyToNumber(opens) - keyToNumber(data.todayKey);
      return `
        <section class="club-card wrapped-card${open ? " is-open" : ""}" aria-labelledby="wrapped-title">
          <div class="wrapped-teaser">
            <p class="wrapped-kicker" id="wrapped-title">Semester Wrapped</p>
            <p class="wrapped-headline">${open ? "Your semester, wrapped." : `Opens ${esc(shortDate(opens))}`}</p>
            <p class="wrapped-copy">${
              !ready
                ? "Needs your attendance first: open the Attendance tab once."
                : open
                  ? "Your days, your subjects, your closest call. Six cards, each one saves as a story."
                  : `${days === 1 ? "Tomorrow" : `${days} days`}, on the last day of classes. Your days, your subjects, your closest call.`
            }</p>
            ${ready ? `<div class="wrapped-actions"><button type="button" class="receipt-button" data-wrapped-open="${open ? "full" : "peek"}">${open ? "Open it" : "Peek at it so far"}</button></div>` : ""}
          </div>
        </section>`;
    }

    function heatCard() {
      const model = data.history ? heatmapModel(data.history, data.calendar, data.todayKey) : null;
      if (!model) return "";
      const facts = [
        `${model.perfect} of ${model.days} days without a miss`,
        model.bestRun > 2 ? `best run ${model.bestRun} days` : "",
        model.bestMonth ? `${model.bestMonth.name} was your best month (${Math.round(model.bestMonth.rate)}%)` : "",
      ].filter(Boolean);
      return `
        <section class="club-card heat-card" aria-labelledby="heat-title">
          <div class="section-head">
            <h2 class="section-label" id="heat-title">Every class, this semester</h2>
          </div>
          <div class="heat-wrap">${heatmapSvg(model)}</div>
          <p class="heat-legend" aria-hidden="true"><span class="k k-p"></span>there <span class="k k-a"></span>missed <span class="k k-off"></span>no classes</p>
          <p class="heat-facts">${facts.map(esc).join(" · ")}.</p>
        </section>`;
    }

    // Classes and exams for the student's own calendar app.
    function calendarCard() {
      const classes = calendarClasses();
      const exams = calendarExams();
      if (!classes.length && !exams.length) return "";
      const until = root.CuimsAttendance?.lastTeachingDay?.(keyToNumber(data.todayKey), { calendar: data.calendar });
      return `
        <section class="club-card cal-card" aria-labelledby="cal-title">
          <div class="section-head">
            <h2 class="section-label" id="cal-title">Take your week with you</h2>
          </div>
          <p class="cal-copy">Your classes in Google Calendar, Apple Calendar or Outlook${until != null ? `, every week until ${esc(shortDate(numberToKey(until)))}` : ""}, holidays left out. Exams come with reminders the day before and an hour before.</p>
          <div class="receipt-actions">
            <button type="button" class="receipt-button" data-cal="classes"${classes.length ? "" : " disabled"}>Classes (.ics)</button>
            <button type="button" class="receipt-button is-quiet" data-cal="exams"${exams.length ? "" : " disabled"}>${exams.length ? `Exams (.ics)` : "No exams ahead"}</button>
          </div>
        </section>`;
    }

    function titleFor(code) {
      const key = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const subject = (data.snapshot?.subjects || []).find((entry) => String(entry.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === key);
      const slot = data.timetable.find((entry) => String(entry.shortCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === key && entry.title);
      return subject?.title || slot?.title || "";
    }

    function calendarClasses() {
      return data.timetable
        .filter((slot) => slot.weekday && slot.end > slot.start && slot.shortCode)
        .map((slot) => ({ day: slot.weekday, start: slot.start, end: slot.end, code: slot.shortCode, kind: slot.kind, title: slot.title || titleFor(slot.shortCode), room: slot.room || "", teacher: slot.teacher || "", group: slot.group || "" }));
    }

    function calendarExams() {
      const today = data.todayKey;
      const seen = new Set();
      return data.sheet
        .filter((exam) => exam.day >= today)
        .filter((exam) => {
          const key = [exam.code, exam.day, exam.type].join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((exam) => ({ day: exam.day, start: root.CuimsAttendance?.parseRange?.(`${exam.time} - 23:59`)?.start ?? null, code: exam.code, type: exam.type, name: titleFor(exam.code) }));
    }

    function exportCalendar(kind) {
      const exporter = root.CuimsCalendarExport;
      if (!exporter) return;
      const result = kind === "classes"
        ? exporter.classesIcs(calendarClasses(), { todayKey: data.todayKey, calendar: data.calendar, exams: data.exams })
        : exporter.examsIcs(calendarExams());
      if (!result) return announce?.("Nothing to add yet.");
      exporter.download(result.text, kind === "classes" ? "cuims-classes.ics" : "cuims-exams.ics");
      announce?.(`Saved ${result.count} ${kind === "classes" ? (result.count === 1 ? "class" : "classes") : result.count === 1 ? "exam" : "exams"}. Open the file to add ${result.count === 1 ? "it" : "them"}.`);
    }

    function openWrapped(mode) {
      const W = root.CuimsWrapped;
      const s = W?.stats({ snapshot: data.snapshot, history: data.history, ledger: data.ledger, best: data.best, calendar: data.calendar, todayKey: data.todayKey });
      if (!s) return announce?.("Not enough classes posted yet for a Wrapped.");
      game?.pause();
      W.open(document.body, s, { soFar: mode !== "full", announce });
    }

    function gameCard() {
      return `
        <section class="club-card game-card" id="club-game" aria-labelledby="game-title">
          <div class="section-head">
            <h2 class="section-label" id="game-title">Proxy Run</h2>
            <button type="button" class="text-button" data-game="play">Play</button>
          </div>
          <canvas class="proxy-canvas" width="336" height="168" tabindex="0" aria-label="Proxy Run. Space or Up to jump, Down to duck, Escape to pause. Collect P marks and keep attendance above 75 percent." aria-describedby="game-help"></canvas>
          <p class="sr-only" id="game-live" aria-live="polite"></p>
          <p class="game-help" id="game-help">Collect <b class="k-p">P</b>, jump the captchas, duck the feedback forms. Below 75% you're detained. It's here when CUIMS makes you wait, too.</p>
        </section>`;
    }

    function capsuleCard() {
      const percent = data.semester?.percent ?? null;
      return `
        <section class="club-card capsule-card" aria-labelledby="capsule-title">
          <div class="section-head">
            <h2 class="section-label" id="capsule-title">Time capsule</h2>
          </div>
          <div id="capsule-body">${capsuleHtml(data.capsule, { todayKey: dayKeyOf(new Date()), calendar: data.calendar, exams: data.exams, percent })}</div>
        </section>`;
    }

    function render({ printing = false } = {}) {
      game?.pause();
      view.innerHTML = `<div class="club">${receiptCard(printing)}${wrappedCard()}${heatCard()}${gameCard()}${capsuleCard()}${calendarCard()}</div>`;
      const canvas = view.querySelector(".proxy-canvas");
      game = root.CuimsProxyRun?.create(canvas, {
        storage: chrome.storage.local,
        announce: (message) => {
          const live = view.querySelector("#game-live");
          if (live) live.textContent = message;
        },
        onOver: ({ best }) => {
          data.best = best;
        },
      });
      bindCapsule();
    }

    function show({ play = false } = {}) {
      load(() => {
        const first = !data.seen.printed;
        render({ printing: first && !reducedMotion() });
        shown = true;
        const seen = { ...data.seen, at: Date.now(), printed: true, stamped: data.founder || data.seen.stamped };
        if (JSON.stringify(seen) !== JSON.stringify(data.seen)) chrome.storage.local.set({ clubSeen: seen });
        if (play || pendingPlay) playNow();
        pendingPlay = false;
      });
    }

    function hide() {
      game?.pause();
      shown = false;
    }

    function playNow() {
      const card = view.querySelector("#club-game");
      card?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      game?.start();
    }

    function reducedMotion() {
      return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    }

    // ---- receipt actions ----

    async function receiptBlob() {
      const colours = imageColours();
      const stamp = data.founder ? await loadStamp(colours.stamp) : null;
      const canvas = receiptImage(receiptLines(data), colours, stamp);
      return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }

    async function saveImage() {
      const blob = await receiptBlob();
      if (!blob) return announce?.("Couldn't draw the image.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cuims-clear-receipt-${dayKeyOf(new Date())}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      announce?.("Receipt saved to Downloads.");
    }

    async function copyImage() {
      try {
        const blob = await receiptBlob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        announce?.("Receipt copied. Paste it anywhere.");
      } catch {
        announce?.("This browser won't copy images. Use Save image.");
      }
    }

    // ---- capsule actions ----

    function bindCapsule() {
      const note = view.querySelector("#capsule-note");
      const count = view.querySelector("#capsule-count");
      const seal = view.querySelector('[data-capsule="seal"]');
      note?.addEventListener("input", () => {
        const left = NOTE_MAX - note.value.length;
        if (count) count.textContent = String(left);
        if (seal) seal.disabled = !note.value.trim();
      });
    }

    function paintCapsule() {
      const body = view.querySelector("#capsule-body");
      if (body) body.innerHTML = capsuleHtml(data.capsule, { todayKey: dayKeyOf(new Date()), calendar: data.calendar, exams: data.exams, percent: data.semester?.percent ?? null });
      bindCapsule();
    }

    function capsuleAction(action, button) {
      if (action === "seal") {
        const note = view.querySelector("#capsule-note")?.value.trim().slice(0, NOTE_MAX);
        if (!note) return;
        data.capsule = { v: 1, note, sealedOn: dayKeyOf(new Date()), opensOn: button.dataset.opens, percent: data.semester?.percent ?? null, broken: false };
        chrome.storage.local.set({ timeCapsule: data.capsule });
        paintCapsule();
        view.querySelector(".envelope")?.classList.add("is-sealing");
        announce?.(`Sealed until ${shortDate(data.capsule.opensOn)}.`);
      } else if (action === "break") {
        if (!breakArmed) {
          breakArmed = true;
          button.textContent = "Press again to open early";
          clearTimeout(breakTimer);
          breakTimer = setTimeout(() => {
            breakArmed = false;
            button.textContent = "Open it early";
          }, 4000);
          return;
        }
        breakArmed = false;
        data.capsule = { ...data.capsule, broken: true };
        chrome.storage.local.set({ timeCapsule: data.capsule });
        paintCapsule();
      } else if (action === "again") {
        data.capsule = null;
        chrome.storage.local.remove("timeCapsule");
        paintCapsule();
        view.querySelector("#capsule-note")?.focus();
      }
    }

    view.addEventListener("click", (event) => {
      const button = event.target.closest?.("button");
      if (!button || !data) return;
      if (button.dataset.receipt === "print") {
        view.querySelector(".receipt-card").outerHTML = receiptCard(!reducedMotion());
        view.querySelector('[data-receipt="print"]')?.focus();
      } else if (button.dataset.receipt === "save") saveImage();
      else if (button.dataset.receipt === "copy") copyImage();
      else if (button.dataset.game === "play") playNow();
      else if (button.dataset.capsule) capsuleAction(button.dataset.capsule, button);
      else if (button.dataset.wrappedOpen) openWrapped(button.dataset.wrappedOpen);
      else if (button.dataset.cal) exportCalendar(button.dataset.cal);
    });

    return {
      show,
      hide,
      // Before the tab opens (a button elsewhere), play once it has.
      play: () => {
        if (shown) playNow();
        else pendingPlay = true;
      },
      repaint: () => game?.repaint(),
    };
  }

  // Whether the 1.0 tab has something new: never visited, or a capsule
  // that has come due since.
  function hasNews(stored, todayKey) {
    const seen = stored?.clubSeen;
    if (!seen?.at) return true;
    const capsule = stored?.timeCapsule;
    if (capsule && !capsule.broken && todayKey >= capsule.opensOn && Number(seen.at) < Date.parse(`${capsule.opensOn}T00:00:00+05:30`)) return true;
    // Semester Wrapped opened since the last visit.
    const A = root.CuimsAttendance;
    const calendar = A?.calendarFor?.(stored?.academicCalendar, stored?.uid) || "cu";
    const last = A?.lastTeachingDay?.(keyToNumber(todayKey), { calendar });
    return last != null && keyToNumber(todayKey) >= last && Number(seen.at) < Date.parse(`${numberToKey(last)}T00:00:00+05:30`);
  }

  root.CuimsClub = { mount, hasNews, receiptLines, semesterStats, capsuleOpensOn, bars, heatmapModel, fitLines };
})(globalThis);
