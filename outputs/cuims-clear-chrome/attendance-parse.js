// Read CUIMS login forms, the attendance report, and the timetable out of raw
// HTML and JSON. No DOM, so the same parser runs in the background and in tests.

(function (root) {
  const api = root.CuimsAttendance || (root.CuimsAttendance = {});

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }

  function stripTags(html) {
    return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }

  function attr(tag, name) {
    const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    return match ? decodeEntities(match[2] ?? match[3] ?? "") : null;
  }

  // Every hidden input, so view state, event validation, and the per-browser
  // hfcurrentbackground token all go back exactly as the page sent them.
  function hiddenFields(html) {
    const fields = {};
    for (const [tag] of String(html || "").matchAll(/<input\b[^>]*>/gi)) {
      if ((attr(tag, "type") || "").toLowerCase() !== "hidden") continue;
      const name = attr(tag, "name");
      if (name) fields[name] = attr(tag, "value") ?? "";
    }
    return fields;
  }

  function formAction(html) {
    const tag = String(html || "").match(/<form\b[^>]*>/i)?.[0];
    return tag ? attr(tag, "action") || "" : "";
  }

  function captchaSrc(html) {
    for (const [tag] of String(html || "").matchAll(/<img\b[^>]*>/gi)) {
      const src = attr(tag, "src") || "";
      if (attr(tag, "id") === "imgCaptcha" || /GenerateCaptcha\.aspx/i.test(src)) return src;
    }
    return "";
  }

  function hasField(html, name) {
    return new RegExp(`<input\\b[^>]*name\\s*=\\s*["']${name}["']`, "i").test(html || "");
  }

  function isUidStep(html) {
    return hasField(html, "txtUserId");
  }

  function isPasswordStep(html) {
    return hasField(html, "txtLoginPassword");
  }

  function isLoginDocument(html) {
    return isUidStep(html) || isPasswordStep(html);
  }

  function extractReportMeta(html) {
    const source = String(html || "");
    const call = source.match(/getReport\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]?([0-9A-Za-z_-]+)['"]?\s*\)/i);
    if (call) return { reportId: call[1], sessionId: call[2] };
    const reportId = source.match(/getReport\s*\(\s*['"]([^'"]+)['"]/i)?.[1] || "";
    const sessionId = source.match(/CurrentSession\s*\(\s*'?([0-9A-Za-z_-]+)'?\s*\)/i)?.[1] || "";
    return { reportId, sessionId };
  }

  // GetReport answers {d: "[...]"}; GetFullReport answers {d: {Result: "[...]"}}.
  // "No Data Found" means the course has no marks yet, which is an empty list.
  function unwrapReport(payload) {
    let value = payload;
    for (let depth = 0; depth < 4; depth += 1) {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        if ("d" in value) value = value.d;
        else if ("Result" in value) value = value.Result;
        else return null;
        continue;
      }
      if (typeof value !== "string") return null;
      if (/^\s*no data found\s*$/i.test(value)) return [];
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    return Array.isArray(value) ? value : null;
  }

  function numberOrNull(value) {
    if (value == null) return null;
    const text = String(value).trim().replace(/%/g, "");
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  // Eligibility counts include duty and medical leave, which is what the 75%
  // rule is checked against. Plain totals are the fallback.
  function pickCounts(row) {
    const eligibleDelivered = numberOrNull(row.EligibilityDelivered);
    const eligibleAttended = numberOrNull(row.EligibilityAttended);
    if (eligibleDelivered != null && eligibleAttended != null && eligibleDelivered > 0) {
      return { attended: eligibleAttended, delivered: eligibleDelivered };
    }
    const totalDelivered = numberOrNull(row.Total_Delv ?? row.TotalDelivered);
    const totalAttended = numberOrNull(row.Total_Attd ?? row.TotalAttended);
    if (totalDelivered != null && totalAttended != null) {
      return { attended: totalAttended, delivered: totalDelivered };
    }
    if (eligibleDelivered != null && eligibleAttended != null) {
      return { attended: eligibleAttended, delivered: eligibleDelivered };
    }
    return null;
  }

  // Approved leave per subject. CUIMS lists IDL (industrial), ADL (assigned)
  // and VDL (voluntary) duty leave and medical leave; approved leave drops
  // the class from both counts, which the eligibility figures already do.
  function leaveCounts(row) {
    const count = (value) => Math.max(0, numberOrNull(value) ?? 0);
    return { idl: count(row.DutyLeave_N_P), adl: count(row.DutyLeave_ADL), vdl: count(row.DutyLeave_Others), ml: count(row.MedicalLeave) };
  }

  function normalizeSummary(row) {
    if (!row || typeof row !== "object") return null;
    const counts = pickCounts(row);
    if (!counts) return null;
    return {
      code: String(row.Code || row.SubjectCode || "").trim(),
      title: String(row.Title || row.Subject || row.Name || "Subject").trim(),
      attended: counts.attended,
      delivered: counts.delivered,
      leave: leaveCounts(row),
      encryptCode: row.EncryptCode ? String(row.EncryptCode) : "",
    };
  }

  // AttendanceCode is "P", "A", or a leave: "Absent (VDL -Departmental
  // Society Activities)", "Absent (Medical Leave)". A pending leave is still "A".
  function markKind(code) {
    const text = String(code || "").trim();
    if (/^(p|present)$/i.test(text)) return "present";
    if (/medical/i.test(text)) return "ml";
    if (/\b[IAV]?DL\b|duty/i.test(text)) return "dl";
    return "absent";
  }

  function normalizeMarks(rows) {
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => {
      const kind = markKind(row.AttendanceCode ?? row.Status);
      return {
        date: String(row.AttendanceDate || row.AttDate || row.Date || ""),
        time: String(row.Timing || row.Time || ""),
        present: kind === "present",
        kind,
      };
    });
  }

  // A history grid as a list of {header: cell} rows.
  function gridRows(html, id) {
    const rows = tableRows(tableInner(html, id));
    const headerIndex = rows.findIndex((row) => row.some((cell) => /status/i.test(cell)));
    if (headerIndex < 0) return [];
    const headers = rows[headerIndex].map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ""));
    return rows
      .slice(headerIndex + 1)
      .filter((row) => row.length === headers.length)
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
  }

  // CUIMS statuses seen: "Recommend and Approved", "Not Recommend",
  // "Cancel By You on 25 Sep 2026". A refusal is checked first so "Not
  // Approved" never reads as approved.
  function leaveState(status) {
    const text = String(status || "");
    if (/\bnot\s+(recommend|approv|sanction)|reject|disapprov|declin|cancel/i.test(text)) return "rejected";
    if (/approv/i.test(text)) return "approved";
    return "pending";
  }

  function dayKeysBetween(fromKey, toKey) {
    if (!fromKey) return [];
    const days = [];
    const cursor = new Date(`${fromKey}T00:00:00Z`);
    const end = new Date(`${toKey || fromKey}T00:00:00Z`);
    for (let guard = 0; cursor <= end && guard < 62; guard += 1) {
      days.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  // Duty Leave page, grid gvHistory: DL_No, Timing, Category, File Name,
  // Leave_Type ("Lecture Bases" or "Day Bases"), Dated ("25 Sep 2026" or
  // "From 03 Sep 2026 To 03 Sep 2026"), Status, Remarks.
  function parseDutyLeaves(html) {
    return gridRows(html, "gvHistory").map((row) => {
      const dated = row.dated || "";
      const range = dated.match(/from\s+(.+?)\s+to\s+(.+)$/i);
      const from = api.parseDateKey(range ? range[1] : dated);
      const to = range ? api.parseDateKey(range[2]) : from;
      const byLecture = /lecture/i.test(row.leavetype || "");
      const category = String(row.category || "");
      return {
        id: row.dlno || `${dated}|${row.timing}`,
        kind: "dl",
        // Voluntary duty leave (society events and the like) is the common
        // one; industrial and assigned duty leave are named as such.
        dlType: /industr/i.test(category) ? "idl" : /assign/i.test(category) ? "adl" : "vdl",
        days: dayKeysBetween(from, to),
        timings: byLecture ? String(row.timing || "").split(",").map((part) => part.trim()).filter(Boolean) : [],
        state: leaveState(row.status),
      };
    }).filter((leave) => leave.days.length);
  }

  // Medical Leave page, grid gvMlHistory: FromDate, ToDate, ReasonOfML,
  // Session, EntryDate, Status. Whole days.
  function parseMedicalLeaves(html) {
    return gridRows(html, "gvMlHistory").map((row) => {
      const from = api.parseDateKey(row.fromdate);
      const to = api.parseDateKey(row.todate) || from;
      return { id: `ml|${from}|${to}`, kind: "ml", days: dayKeysBetween(from, to), timings: [], state: leaveState(row.status) };
    }).filter((leave) => leave.days.length);
  }

  function tableInner(html, id) {
    const match = String(html || "").match(new RegExp(`<table\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</table>`, "i"));
    return match ? match[1] : "";
  }

  function tableRows(inner) {
    return [...String(inner || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
      [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1])),
    );
  }

  function normLoose(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // CUIMS has shipped this page under two sets of ids: the older
  // gvMyTimeTable pair, and grdMain with grdCourseDetail (October 2026).
  const TIMETABLE_IDS = ["ContentPlaceHolder1_gvMyTimeTable", "grdMain"];
  const COURSE_TABLE_IDS = ["ContentPlaceHolder1_gvMyTimeTableDetails", "ContentPlaceHolder1_grdCourseDetail"];

  function firstTable(html, ids) {
    for (const id of ids) {
      const inner = tableInner(html, id);
      if (inner) return inner;
    }
    return "";
  }

  function courseNamesFrom(html) {
    const names = {};
    for (const row of tableRows(firstTable(html, COURSE_TABLE_IDS))) {
      if (row.length < 2) continue;
      const code = row[0].toUpperCase();
      if (!/^[A-Z0-9-]{2,}$/.test(code)) continue;
      names[normLoose(code)] = row[1];
    }
    return names;
  }

  // Cells look like "24CSP-305:P :: GP-A: By Name(E1234) at 1-2-C".
  function parseSlotLabel(text, courseNames) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw || raw === "-" || /^(break|lunch|recess)$/i.test(raw)) return null;
    const coded = raw.match(/^([A-Z0-9-]{2,}):\s*([LPT])\b/i);
    if (!coded) return { shortCode: "", title: raw, kind: "L" };
    const shortCode = coded[1].toUpperCase();
    return {
      shortCode,
      title: courseNames[normLoose(shortCode)] || "",
      kind: coded[2].toUpperCase(),
    };
  }

  function isWeekday(value) {
    return /^(mon|tue|wed|thu|fri|sat|sun)/i.test(String(value || "").trim());
  }

  function parseTimetable(html) {
    const courseNames = courseNamesFrom(html);
    const rows = tableRows(firstTable(html, TIMETABLE_IDS));
    const headerIndex = rows.findIndex((row) => row.some(isWeekday));
    if (headerIndex < 0) return [];
    const days = rows[headerIndex]
      .map((cell, index) => (isWeekday(cell) ? { index, weekday: cell.slice(0, 3).toLowerCase() } : null))
      .filter(Boolean);
    const slots = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const range = api.parseRange(row[0] || "");
      if (!range) continue;
      for (const day of days) {
        const label = parseSlotLabel(row[day.index] || "", courseNames);
        if (!label) continue;
        slots.push({ weekday: day.weekday, start: range.start, end: range.end, ...label });
      }
    }
    return slots;
  }

  api.stripTags = stripTags;
  api.hiddenFields = hiddenFields;
  api.formAction = formAction;
  api.captchaSrc = captchaSrc;
  api.isUidStep = isUidStep;
  api.isPasswordStep = isPasswordStep;
  api.isLoginDocument = isLoginDocument;
  api.extractReportMeta = extractReportMeta;
  api.unwrapReport = unwrapReport;
  api.normalizeSummary = normalizeSummary;
  api.normalizeMarks = normalizeMarks;
  api.parseTimetable = parseTimetable;
  api.hasTimetable = (html) => Boolean(firstTable(html, TIMETABLE_IDS));
  api.leaveState = leaveState;
  api.parseDutyLeaves = parseDutyLeaves;
  api.parseMedicalLeaves = parseMedicalLeaves;
})(globalThis);
