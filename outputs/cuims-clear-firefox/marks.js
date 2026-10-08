// Regular examination marks. Uses the same raw-HTML helpers and request
// wrapper as attendance; no per-subject requests or remote dependencies.
(function (root) {
  const api = root.CuimsAttendance;
  const PAGE = "https://students.cuchd.in/frmStudentMarksView.aspx";
  const SESSION_NAME = "ctl00$ContentPlaceHolder1$wucStudentMarksView$ddlCAndPSession";
  const CACHE_VERSION = 1;

  function attribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    return match ? api.stripTags(match[2] ?? match[3]) : "";
  }

  function parseRegularMarks(html) {
    const clean = String(html || "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const select = [...clean.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
      .find((match) => attribute(match[1], "name") === SESSION_NAME);
    if (!select) throw api.coded("marks-shape", "CUIMS answered without the Regular Marks session selector.");
    const sessions = [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
      .map((match) => ({ id: attribute(match[1], "value"), label: api.stripTags(match[2]), selected: /\bselected(?:\s|=|$)/i.test(match[1]) }))
      .filter((session) => /^\d{1,10}$/.test(session.id));
    const session = sessions.find((entry) => entry.selected) || sessions[0];
    if (!session) throw api.coded("marks-shape", "CUIMS did not provide an examination session.");
    const accordion = clean.match(/<div\b[^>]*\bid\s*=\s*["']accordion["'][^>]*>([\s\S]*)/i)?.[1];
    const subjects = [];
    if (accordion != null) {
      const headings = [...accordion.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
      for (let index = 0; index < headings.length; index++) {
        const heading = headings[index];
        const title = api.stripTags(heading[1]);
        const section = accordion.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? accordion.length);
        const exams = [];
        for (const [table] of section.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
          if (!/Exam\s*Description/i.test(api.stripTags(table)) || !/Max\.\s*Marks/i.test(api.stripTags(table))) continue;
          for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
            const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => api.stripTags(cell[1]));
            if (cells.length === 3 && cells[0]) exams.push({ name: cells[0], maximum: cells[1], obtained: cells[2] });
          }
        }
        if (title) subjects.push({ title, code: title.match(/\(([^()]+)\)\s*$/)?.[1] || "", exams });
      }
    }
    // Only accept an empty result when CUIMS explicitly says there is no data.
    if (!subjects.length && !/\bno\s+(?:data|records?|marks)(?:\s+(?:found|available))?\b/i.test(api.stripTags(clean))) {
      throw api.coded("marks-shape", "CUIMS answered without its marks tables. Your saved marks were kept.");
    }
    const identity = [...clean.matchAll(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi)]
      .map((match) => api.stripTags(match[1]).match(/\b\d{2}[A-Z]{2,6}\d{3,8}\b/i)?.[0]).find(Boolean) || "";
    return { sessionId: session.id, label: session.label, sessions: sessions.map(({ id, label }) => ({ id, label })), subjects, uid: identity };
  }

  async function readRegularMarks(request) {
    let page = await request(PAGE);
    function check(result) {
      if (api.isLoginUrl(result.url) || api.isLoginDocument(result.html)) throw api.coded("signed-out");
      if (new URL(result.url).origin !== new URL(PAGE).origin || new URL(result.url).pathname.toLowerCase() !== "/frmstudentmarksview.aspx") {
        throw api.coded("portal-redirect", "CUIMS did not open the Regular Marks page. Open CUIMS once, then try again.");
      }
      return parseRegularMarks(result.html);
    }
    let parsed = check(page);
    const current = parsed.sessions.find((entry) => /^Current\s*Session\b|^CurrentSession[-\s(]/i.test(entry.label));
    if (!current) throw api.coded("marks-session", "CUIMS did not identify the current examination session.");
    if (parsed.sessionId !== current.id) {
      // A full ASP.NET postback, just like the existing UID and timetable
      // requests. Do not persist viewstate, event-validation or SSO tokens.
      const body = new URLSearchParams({ ...api.hiddenFields(page.html), __EVENTTARGET: SESSION_NAME, __EVENTARGUMENT: "", [SESSION_NAME]: current.id });
      page = await request(PAGE, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
      parsed = check(page);
      if (parsed.sessionId !== current.id) throw api.coded("marks-session", "CUIMS did not switch to the current examination session.");
    }
    return parsed;
  }

  function marksCacheFor(cache, uid) {
    if (cache?.v !== CACHE_VERSION || cache.uid !== String(uid || "").trim()) return null;
    // Old builds could cache previous sessions. Only expose the session that
    // CUIMS labels CurrentSession, even if the old popup last showed another.
    const current = cache.sessions?.find((entry) => /^Current\s*Session\b|^CurrentSession[-\s(]/i.test(entry.label));
    if (!current || !cache.snapshots?.[current.id]) return null;
    return { ...cache, currentSession: current.id, sessions: [current], snapshots: { [current.id]: cache.snapshots[current.id] } };
  }

  root.CuimsMarks = { PAGE, SESSION_NAME, CACHE_VERSION, parseRegularMarks, readRegularMarks, marksCacheFor };
})(globalThis);
