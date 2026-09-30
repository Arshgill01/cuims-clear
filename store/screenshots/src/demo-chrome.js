// Demo-only chrome.* stub for store screenshots. Invented student, invented
// numbers; the clock is frozen at Wednesday 11:05 IST so today's chips show.
(() => {
  const FROZEN = Date.UTC(2026, 8, 30, 5, 35); // Wed 30 Sep 2026, 11:05 IST
  const RealDate = Date;
  class DemoDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [FROZEN])); }
    static now() { return FROZEN; }
  }
  window.Date = DemoDate;
  const day = "2026-09-30";
  const slot = (h, m, code, title, kind = "L") => ({ weekday: "wed", start: h * 60 + m, end: h * 60 + m + 40, shortCode: code, title, kind });
  const snapshot = {
    fetchedAt: new RealDate(FROZEN - 2 * 60000).toISOString(),
    marksDay: day,
    slots: [
      slot(9, 40, "23CSP-305", "Competitive Coding", "P"),
      slot(10, 20, "23CST-302", "Computer Networks"),
      slot(11, 0, "23CST-301", "Operating Systems"),
      slot(13, 0, "23CSH-303", "Design and Analysis of Algorithms"),
      slot(14, 0, "23SMT-341", "Probability and Statistics"),
      slot(15, 20, "23CST-302", "Computer Networks", "P"),
    ],
    leaves: { checkedAt: new RealDate(FROZEN - 95 * 60000).toISOString(), pending: { "23CSP305": { vdl: 2, idl: 0, adl: 0, ml: 0 } } },
    subjects: [
      { code: "23CST-301", title: "Operating Systems", attended: 41, delivered: 42, leave: { vdl: 3, ml: 2 } },
      { code: "23CST-302", title: "Computer Networks", attended: 35, delivered: 37, leave: { vdl: 9, ml: 0 }, marks: [{ date: day, time: "10:20 - 11:00 AM", present: true }] },
      { code: "23CSH-303", title: "Design and Analysis of Algorithms", attended: 31, delivered: 36, leave: { vdl: 2, ml: 2 } },
      { code: "23CSH-304", title: "Full Stack Development", attended: 34, delivered: 35, leave: { vdl: 5, ml: 2 } },
      { code: "23CSP-305", title: "Competitive Coding", attended: 25, delivered: 32, leave: { vdl: 4, ml: 2 }, marks: [{ date: day, time: "09:40 - 10:20 AM", present: true }] },
      { code: "23SMT-341", title: "Probability and Statistics", attended: 23, delivered: 31, leave: { vdl: 6, ml: 2 } },
      { code: "23CSH-301", title: "Project Based Learning in Java", attended: 30, delivered: 31 },
      { code: "23TDP-311", title: "Soft Skills", attended: 19, delivered: 19 },
      { code: "23TDT-312", title: "Aptitude", attended: 16, delivered: 16 },
    ],
  };
  const query = new URLSearchParams(location.search);
  const view = query.get("view") || "attendance";
  try { localStorage.setItem("cuims-clear:theme", query.get("theme") || "clear"); } catch {}
  const data = { uid: "23BCS12345", password: "demo-password", autoAdvanceUid: true, autoSolveCaptcha: true, autoSubmitLogin: true, blockEvents: true, blockFeedback: true, popupView: view, attendanceSnapshot: snapshot, attendanceStatus: null, theme: query.get("theme") || "clear", attendanceGoal: query.get("goal") || "standard", attendancePlan: { day, skips: (query.get("plan") || "").split(",").filter(Boolean) } };
  const pick = (d) => (typeof d === "string" ? { [d]: data[d] } : Array.isArray(d) ? Object.fromEntries(d.map((k) => [k, data[k]])) : Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in data ? data[k] : v])));
  const local = { get: (d, cb) => { const v = pick(d); cb?.(v); return Promise.resolve(v); }, set: (v, cb) => { Object.assign(data, v); cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } };
  window.chrome = {
    storage: { local, onChanged: { addListener() {} } },
    runtime: { sendMessage: (m, cb) => cb?.({ snapshot }), getManifest: () => ({ version: "0.8.0" }), lastError: null, getURL: (p) => p },
    permissions: { contains: (o, cb) => cb?.(true), request: (o, cb) => cb?.(true) },
    tabs: { query: async () => [] },
  };
})();
