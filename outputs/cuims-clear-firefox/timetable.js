// Full weekly timetable, using attendance's CUIMS request and parser.
(function (root) {
  const api = root.CuimsAttendance;
  const CACHE_VERSION = 1;
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  function sort(slots) {
    return [...slots].sort((a, b) => DAYS.indexOf(a.weekday) - DAYS.indexOf(b.weekday)
      || a.start - b.start || a.end - b.end || (a.shortCode || a.title).localeCompare(b.shortCode || b.title));
  }
  function cacheFor(cache, uid) {
    return cache?.v === CACHE_VERSION && cache.uid === String(uid || "").trim() && Array.isArray(cache.slots) ? cache : null;
  }
  async function read(request) {
    let html = "";
    const slots = await api.readTimetable(async (target, options) => {
      const page = await request(target, options);
      if (!api.isLoginUrl(page.url) && !api.isLoginDocument(page.html)) {
        const location = new URL(page.url);
        if (location.origin !== "https://students.cuchd.in" || location.pathname.toLowerCase() !== "/frmmytimetable.aspx")
          throw api.coded("portal-redirect", "CUIMS did not open My Time Table. Open CUIMS once, then try again.");
      }
      html = page.html || "";
      return page;
    });
    if (!/id=["']ContentPlaceHolder1_gvMyTimeTable["']/i.test(html))
      throw api.coded("timetable-shape", "CUIMS answered without its timetable. Try again later.");
    if (!slots.length && !/\bno\s+(?:data|records?|classes|timetable)\b/i.test(api.stripTags(html)) && !/<th\b[^>]*>[\s\S]*?(?:mon|tue|wed|thu|fri|sat|sun)/i.test(html))
      throw api.coded("timetable-shape", "Could not read the timetable. Try again later.");
    const uid = [...html.matchAll(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi)]
      .map(match => api.stripTags(match[1]).match(/\b\d{2}[A-Z]{2,6}\d{3,8}\b/i)?.[0]).find(Boolean) || "";
    return { slots: sort(api.parseTimetable(html, { details: true })), uid };
  }
  root.CuimsTimetable = { CACHE_VERSION, DAYS, sort, cacheFor, read };
})(globalThis);
