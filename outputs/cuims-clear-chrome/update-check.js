// Whether a newer CUIMS Clear is out, and what the popup and CUIMS tabs say
// about it. Browsers check for add-on updates on their own (Firefox about
// once a day, Chrome every few hours), but students went weeks on an old
// build without knowing, and neither store's page offers an update button.
//
// Chrome: chrome.runtime.requestUpdateCheck asks the Web Store and downloads
// the update; chrome.runtime.reload installs it.
// Firefox has no requestUpdateCheck, so the version comes from AMO's public
// API (it allows any origin). Firefox installs an update only from a web
// page the student clicks on: an extension page or a tab the extension opens
// is refused. So the Update link sits on CUIMS (update-bar.js), and Firefox
// asks "Allow students.cuchd.in to install an add-on?", then "Add". It
// upgrades in place: the saved login and attendance stay.
// The Firefox build must never listen to runtime.onUpdateAvailable: with a
// listener, Firefox holds every update until the browser restarts.
(function (root) {
  const HOUR_MS = 60 * 60 * 1000;
  // A check on its own: popup opens and CUIMS pages, at most this often.
  const CHECK_EVERY_MS = 6 * HOUR_MS;
  // Check now in Settings.
  const MANUAL_GAP_MS = 60 * 1000;
  // × on the CUIMS bar.
  const SNOOZE_MS = 24 * HOUR_MS;
  // The What's new card, after an update, until Got it or this long.
  const NEWS_MS = 3 * 24 * HOUR_MS;

  const AMO_API = "https://addons.mozilla.org/api/v5/addons/addon/cuims-clear/";
  const AMO_XPI = "https://addons.mozilla.org/firefox/downloads/latest/cuims-clear/latest.xpi";
  // Opened by the popup's Update now on Firefox, which first clears the
  // bar's ×. (A #hash would not survive CUIMS's redirect to its login page.)
  const UPDATE_PAGE = "https://students.cuchd.in/StudentHome.aspx";

  // What the What's new card lists, by version. A version with no entry
  // shows no card.
  const NOTES = {
    "1.0.0": [
      "CUIMS Clear is 1.0: 100 students on the Chrome Web Store. Thank you.",
      "A new 1.0 tab: your semester receipt, every class day by day, Proxy Run, a time capsule, and Semester Wrapped on the last day of classes.",
      "Had it before 1.0? You're a founder: a stamp on your receipt and two themes only founders get, Founding 100 and Black Card.",
      "My Time Table, Datesheet and Marks View on CUIMS are redesigned, with Add to calendar for your classes and exams.",
      "Pending duty leave shows again after CUIMS's Duty Leave redesign, one stray exam no longer cancels a week of classes, and absent marks count in totals.",
    ],
    "0.10.6": [
      "Tells you when a new version is out, in the popup, on the toolbar icon and on CUIMS, with an Update button.",
      "Settings shows your version and can check for updates.",
    ],
  };

  function parts(version) {
    return String(version || "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  }

  // Is version a newer than b?
  function newer(a, b) {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const step = (x[i] || 0) - (y[i] || 0);
      if (step) return step > 0;
    }
    return false;
  }

  // updateInfo in storage: the last check and what it found.
  function normalize(info) {
    const value = info && typeof info === "object" ? info : {};
    return {
      checkedAt: Number(value.checkedAt) || 0,
      // The store's version; "" when it has nothing newer.
      latest: typeof value.latest === "string" ? value.latest : "",
      // Chrome only: downloaded, installed on the next restart.
      ready: value.ready === true,
      error: typeof value.error === "string" ? value.error : "",
    };
  }

  function due(info, now, manual = false) {
    const last = normalize(info).checkedAt;
    if (last > now) return true;
    return now - last >= (manual ? MANUAL_GAP_MS : CHECK_EVERY_MS);
  }

  function available(info, current) {
    const value = normalize(info);
    return Boolean(value.latest) && newer(value.latest, current);
  }

  // AMO's answer: the listed version, if this Firefox can run it.
  function amoLatest(json, browserVersion) {
    const version = json?.current_version;
    if (!version?.version) return "";
    const min = version.compatibility?.firefox?.min;
    if (min && browserVersion && newer(min, browserVersion)) return "";
    return String(version.version);
  }

  // updateDone in storage: { from, to, at, seen }, set when an update lands.
  function news(done, current, now) {
    if (!done || typeof done !== "object" || done.seen || done.to !== current) return null;
    if (!(Number(done.at) > 0) || now - Number(done.at) > NEWS_MS) return null;
    const notes = NOTES[current];
    return notes?.length ? { from: String(done.from || ""), to: current, notes } : null;
  }

  // "checked 2 h ago" for Settings.
  function ago(at, now) {
    const minutes = Math.round((now - at) / 60000);
    if (!(at > 0)) return "";
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  root.CuimsUpdate = {
    newer,
    normalize,
    due,
    available,
    amoLatest,
    news,
    ago,
    NOTES,
    AMO_API,
    AMO_XPI,
    UPDATE_PAGE,
    CHECK_EVERY_MS,
    MANUAL_GAP_MS,
    SNOOZE_MS,
    NEWS_MS,
  };
})(globalThis);
