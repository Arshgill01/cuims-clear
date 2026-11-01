// Marks View, read the way CU counts it. No DOM, so the same code runs on the
// CUIMS page, in the popup, in the background and in tests.
//
// CUIMS lists every assessment at the marks it was conducted for (a surprise
// test out of 12, each MST out of 20, each experiment out of 30). CU does not
// add those up: each kind of assessment carries a fixed share of the internal
// marks, and repeats of one kind are pooled into that share (the two MSTs make
// 20 of a theory course's 40, three assignments make 10, the experiments make
// 40 however many were held). Adding the raw rows over-weights whatever is
// conducted out of more, or held more often, which is why percentages read
// from the raw totals came out wrong.
//
// So a subject's percentage here is: each kind's own percentage (marks got
// over marks conducted, which pooling leaves unchanged), weighted by its CU
// share, over the kinds held so far. For a theory course that is exactly
// CU's internal: assignment 10, surprise test 4, quiz 4, MSTs 20,
// attendance 2.

(function (root) {
  const api = root.CuimsMarks || (root.CuimsMarks = {});

  // Order matters: the first match wins ("Practical Worksheet/Projects" is
  // an experiment, not a project; "Practical MST" is a lab test, not an MST).
  // `weight` is the kind's share where CU's scheme fixes it; otherwise the
  // share is one sitting's maximum (an assignment out of 10 is worth 10).
  const KINDS = [
    { key: "attendance", label: "Attendance", test: /attendance/i },
    { key: "surprise", label: "Surprise tests", test: /surprise/i, weight: 4 },
    { key: "lab-test", label: "Lab tests", test: /practical\s*mst|lab\s*mst|industry\s*aligned|mid[\s-]*term/i },
    { key: "mst", label: "MSTs", test: /\bmst\b|mid[\s-]*sem/i },
    { key: "experiment", label: "Experiments", test: /experiment|worksheet|practical\s*test/i, weight: 40 },
    { key: "quiz", label: "Quizzes", test: /quiz/i },
    { key: "assignment", label: "Assignments", test: /assignment|\bpbl\b/i },
    { key: "class", label: "Class performance", test: /class\s*performance/i },
    { key: "project", label: "Project", test: /project/i, weight: 10 },
    { key: "end-term", label: "End term", test: /end[\s-]*(sem|term)|final\s*(exam|practical)/i },
  ];

  // Aptitude and soft skills (training and development, the TDT and TDP
  // course codes) count towards the result in some programmes and not in
  // others; the student says which.
  function isSkillCourse(subject) {
    return /aptitude|soft\s*skill/i.test(subject?.title || "") || /^\d{2}TD[PT]-/i.test(subject?.code || "");
  }

  const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

  function number(text) {
    const value = clean(text);
    if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
    return Number(value);
  }

  // One row of a subject's table: an assessment, a letter grade (a graded
  // course, "- Grade | - | B+"), or nothing usable yet. ABSENT counts as zero:
  // CU marks a missed test absent. Anything else unposted is left out.
  function readRow(name, maxText, gotText) {
    const label = clean(name).replace(/^-\s*/, "");
    const max = number(maxText);
    const raw = clean(gotText);
    const absent = /^ab(sent)?$/i.test(raw);
    const got = absent ? 0 : number(raw);
    if (max == null) return /^(?:[A-F][+-]?|[OPIX])$/i.test(raw) ? { grade: raw.toUpperCase() } : null;
    if (max <= 0 || got == null) return null;
    return { name: label, max, got, absent };
  }

  function kindOf(name) {
    const found = KINDS.find((kind) => kind.test.test(name));
    if (found) return found;
    // Anything else is its own kind, repeats pooled by name without the
    // trailing number ("Write X (Soft Skills)", "Viva-2").
    const stem = clean(name).replace(/[\s-]*\(?\d+\)?\s*$/, "").trim() || clean(name);
    return { key: `other:${stem.toLowerCase()}`, label: stem };
  }

  // A subject's kinds, each with its pooled marks and its share.
  function kindsOf(items) {
    const groups = new Map();
    for (const item of items) {
      const kind = kindOf(item.name);
      let group = groups.get(kind.key);
      if (!group) {
        group = { key: kind.key, label: kind.label, fixed: kind.weight ?? null, got: 0, max: 0, sitting: 0, items: [] };
        groups.set(kind.key, group);
      }
      group.got += item.got;
      group.max += item.max;
      group.sitting = Math.max(group.sitting, item.max);
      group.items.push(item);
    }
    return [...groups.values()].map(({ fixed, sitting, ...group }) => {
      const weight = fixed ?? sitting;
      return { ...group, weight, percent: (group.got / group.max) * 100, points: (group.got / group.max) * weight };
    });
  }

  // A subject read for display and averaging. `counts` says whether it goes
  // into the average; `reason` says why not.
  function scoreSubject(subject, options = {}) {
    const items = (subject.items || []).filter((item) => item && item.max > 0 && Number.isFinite(item.got));
    const kinds = kindsOf(items);
    const outOf = kinds.reduce((sum, kind) => sum + kind.weight, 0);
    const points = kinds.reduce((sum, kind) => sum + kind.points, 0);
    const raw = { got: items.reduce((sum, item) => sum + item.got, 0), max: items.reduce((sum, item) => sum + item.max, 0) };
    const skill = isSkillCourse(subject);
    let reason = "";
    if (!items.length) reason = subject.grade ? "graded" : "empty";
    else if (kinds.every((kind) => kind.key === "attendance")) reason = "attendance-only";
    else if (skill && options.includeSkills === false) reason = "skill-off";
    return {
      title: subject.title || "",
      code: subject.code || "",
      grade: subject.grade || "",
      items,
      kinds,
      skill,
      points,
      outOf,
      percent: outOf > 0 ? (points / outOf) * 100 : null,
      raw: { ...raw, percent: raw.max > 0 ? (raw.got / raw.max) * 100 : null },
      absent: items.filter((item) => item.absent).length,
      counts: !reason,
      reason,
    };
  }

  // Every subject, the average of the ones that count (each subject equal,
  // whatever it was conducted out of), and the raw marks added up.
  function summarize(subjects, options = {}) {
    const scored = (subjects || []).map((subject) => scoreSubject(subject, options));
    const counted = scored.filter((subject) => subject.counts);
    const raw = counted.reduce((sum, subject) => ({ got: sum.got + subject.raw.got, max: sum.max + subject.raw.max }), { got: 0, max: 0 });
    return {
      subjects: scored,
      counted: counted.length,
      average: counted.length ? counted.reduce((sum, subject) => sum + subject.percent, 0) / counted.length : null,
      raw: { ...raw, percent: raw.max > 0 ? (raw.got / raw.max) * 100 : null },
      assessments: counted.reduce((sum, subject) => sum + subject.items.length, 0),
      skills: scored.filter((subject) => subject.skill).length,
    };
  }

  // ---- Marks View HTML (background reads and tests) ----

  function decode(value) {
    return String(value || "")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&amp;/g, "&");
  }

  const text = (html) => clean(decode(String(html || "").replace(/<[^>]+>/g, " ")));

  // "Computer Networks (24CST-302)"
  function splitTitle(value) {
    const match = clean(value).match(/^([\s\S]*?)\s*\(([A-Z0-9-]{2,})\)\s*$/i);
    return match ? { title: match[1], code: match[2].toUpperCase() } : { title: clean(value), code: "" };
  }

  // The session dropdown: CUIMS offers the current and the previous one.
  function parseSessions(html) {
    const select = String(html || "").match(/<select\b[^>]*name="[^"]*ddlCAndPSession"[^>]*>([\s\S]*?)<\/select>/i);
    if (!select) return [];
    return [...select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(([, attrs, label]) => ({
      value: decode(attrs.match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1] || ""),
      label: text(label),
      selected: /\bselected\b/i.test(attrs),
    }));
  }

  // Each accordion header and the table in the panel after it.
  function parseMarksPage(html) {
    const source = String(html || "");
    const start = source.search(/<div\b[^>]*\bid="accordion"/i);
    const subjects = [];
    if (start >= 0) {
      const parts = source.slice(start).split(/<h3\b[^>]*>/i).slice(1);
      for (const part of parts) {
        const end = part.indexOf("</h3>");
        if (end < 0) continue;
        const subject = { ...splitTitle(text(part.slice(0, end))), items: [], grade: "" };
        const body = part.slice(end).split(/<\/table>/i)[0];
        for (const [, row] of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => text(cell[1]));
          if (cells.length < 3) continue;
          const read = readRow(cells[0], cells[cells.length - 2], cells[cells.length - 1]);
          if (read?.grade) subject.grade = read.grade;
          else if (read) subject.items.push(read);
        }
        if (subject.title) subjects.push(subject);
      }
    }
    const sessions = parseSessions(source);
    const session = sessions.find((entry) => entry.selected) || sessions[0] || null;
    return { sessions, session, subjects };
  }

  // "CurrentSession-26271" -> "Current session"
  function sessionName(session) {
    const label = String(session?.label || "");
    if (/^current/i.test(label)) return "Current session";
    if (/^previous/i.test(label)) return "Previous session";
    return label || "Session";
  }

  // 87.25 -> "87.3"; one decimal everywhere, rounded half up.
  function formatPercent(value) {
    return value == null || !Number.isFinite(value) ? "—" : (Math.round(value * 10) / 10).toFixed(1);
  }

  const round2 = (value) => String(Math.round(value * 100) / 100);

  // Good, fair or low, for a share of marks.
  const band = (percent) => (percent == null ? "" : percent >= 80 ? "good" : percent >= 55 ? "fair" : "low");

  api.KINDS = KINDS;
  api.isSkillCourse = isSkillCourse;
  api.readRow = readRow;
  api.kindOf = kindOf;
  api.scoreSubject = scoreSubject;
  api.summarize = summarize;
  api.splitTitle = splitTitle;
  api.parseSessions = parseSessions;
  api.parseMarksPage = parseMarksPage;
  api.sessionName = sessionName;
  api.formatPercent = formatPercent;
  api.round2 = round2;
  api.band = band;
})(globalThis);
