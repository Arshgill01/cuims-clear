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

    const s = data.semester;
    if (s) {
      lines.push({ t: "rule" });
      lines.push({ t: "head", text: "THIS SEMESTER" });
      lines.push({ t: "row", l: "CLASSES ATTENDED", r: thousands(s.attended) });
      lines.push({ t: "row", l: "CLASSES HELD", r: thousands(s.delivered) });
      lines.push({ t: "row", l: "ATTENDANCE", r: `${(Math.floor(s.percent * 10) / 10).toFixed(1)} %`, cls: "r-strong" });
      if (s.streak > 1) lines.push({ t: "row", l: "LONGEST STREAK", r: `${s.streak} IN A ROW` });
      if (s.missedDay) lines.push({ t: "row", l: "MOST-MISSED DAY", r: s.missedDay });
      if (s.best) lines.push({ t: "row", l: "TOP SUBJECT", r: `${Math.round(s.best.percent)} %` }, { t: "indent", text: s.best.title.toUpperCase().slice(0, 30) });
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
    lines.push({ t: "row", l: "TOTAL", r: "₹0.00", cls: "r-total" });
    lines.push({ t: "row", l: "PAID WITH", r: "ATTENDANCE" });
    lines.push({ t: "double" });
    lines.push({ t: "barcode", seed: `${data.version}${ledger.codes.join("")}${ledger.captchas}` });
    if (data.founder) lines.push({ t: "center", text: "★ FOUNDING 100 ★", cls: "r-founder" });
    lines.push({ t: "center", text: "THANK YOU. COME AGAIN.", cls: "r-thanks" });
    lines.push({ t: "center", text: "(you will. it's CUIMS.)", cls: "r-small" });
    return lines;
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
            return `<p class="r-line r-row ${line.cls || ""}"${style}><span>${esc(line.l)}</span><span>${esc(line.r)}</span></p>`;
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
  function receiptImage(lines, colours) {
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
    ctx.font = "800 900px ui-monospace, Menlo, monospace";
    ctx.fillText("//", 330, 1500);
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
    const paper = paperCanvas(lines, colours);
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

  function paperCanvas(lines, colours) {
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
    return canvas;
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
            <span class="envelope-seal"><span>//</span></span>
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
          ledger: stored.cuimsLedger,
          capsule: stored.timeCapsule && typeof stored.timeCapsule === "object" ? stored.timeCapsule : null,
          seen: stored.clubSeen && typeof stored.clubSeen === "object" ? stored.clubSeen : {},
          semester,
          calendar,
          exams: Array.isArray(stored.attendanceSnapshot?.exams) ? stored.attendanceSnapshot.exams : [],
          uidLength: String(stored.uid || "").length,
          best: Number(stored.proxyRunBest) || 0,
          version: chrome.runtime.getManifest().version,
        };
        done?.(data);
      });
    }

    function heroHtml() {
      const f = data.founding;
      return `
        <section class="club-hero${data.founder ? " is-founder" : ""}" aria-labelledby="club-title">
          <p class="club-kicker">CUIMS Clear</p>
          <h2 id="club-title" class="club-big">1<span>.</span>0</h2>
          <p class="club-line">${data.founder
            ? "100 students on the Chrome Web Store. You were one of them before it was 1.0."
            : "100 students on the Chrome Web Store, so it's 1.0 now. Welcome in."}</p>
          ${data.founder ? `
            <div class="club-stamp${data.seen.stamped ? "" : " is-new"}" role="img" aria-label="Founding 100 stamp: you used CUIMS Clear before 1.0">${stampSvg()}</div>
            <p class="club-founder-note">Founding 100${f.from ? ` · from v${esc(f.from)}` : ""}. The stamp stays on this page.</p>` : ""}
        </section>`;
    }

    function receiptCard(printing) {
      const lines = receiptLines(data);
      return `
        <section class="club-card receipt-card" aria-labelledby="receipt-title">
          <div class="section-head">
            <h2 class="section-label" id="receipt-title">Your receipt</h2>
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
      view.innerHTML = `<div class="club">${heroHtml()}${receiptCard(printing)}${gameCard()}${capsuleCard()}</div>`;
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

    function receiptBlob() {
      const canvas = receiptImage(receiptLines(data), imageColours());
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
    return Boolean(capsule && !capsule.broken && todayKey >= capsule.opensOn && Number(seen.at) < Date.parse(`${capsule.opensOn}T00:00:00+05:30`));
  }

  root.CuimsClub = { mount, hasNews, receiptLines, semesterStats, capsuleOpensOn, bars };
})(globalThis);
