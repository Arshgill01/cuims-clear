// Connects the attendance daemon to the browser: popup refreshes, what CUIMS
// tabs hand over, and the shared login guard. There is no timer: CUIMS only hears from the extension
// when the student uses the popup. Runs in the Firefox background page and in
// Chrome's service worker.

const CUIMS_ORIGINS = { origins: ["https://students.cuchd.in/*"] };

function startAttendanceBackground(solveCaptcha) {
  const attendance = CuimsAttendance.createDaemon({
    storage: {
      get: (defaults) => chrome.storage.local.get(defaults),
      set: (values) => chrome.storage.local.set(values),
    },
    fetchImpl: (url, options) => fetch(url, options),
    solveCaptcha,
  });

  // Nothing talks to CUIMS before the stale locks are gone: the task that
  // woke this background must not have its own fresh locks cleared.
  const settled = clearStaleLocks();
  const hasAccess = () => settled.then(() => chrome.permissions.contains(CUIMS_ORIGINS));

  // Only this extension's own pages. A content script's sender URL is the
  // web page it runs in.
  function fromExtensionPage(sender) {
    return sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "cuims-clear:attendance-refresh" || !fromExtensionPage(sender)) return;
    cuimsKeepAwake(() =>
      hasAccess().then((granted) => {
        if (!granted) return { error: "The browser has switched off access to CUIMS. Use Allow access at the top.", code: "no-access" };
        return attendance.refresh("manual");
      }),
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error), code: "network" }));
    return true;
  });

  // What a CUIMS tab's content script hands over: a leave page or the
  // timetable the student opened, and each page load for the local log.
  const fromCuimsTab = (sender) =>
    /^https:\/\/students\.cuchd\.in\//i.test(String(sender?.url || sender?.tab?.url || "")) && (!sender?.id || sender.id === chrome.runtime.id);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!fromCuimsTab(sender)) return;
    let work = null;
    if (message?.type === "cuims-clear:leave-page") work = () => attendance.ingestLeavePage(message.which, String(message.html || ""));
    if (message?.type === "cuims-clear:timetable-page") work = () => attendance.ingestTimetablePage(String(message.html || ""));
    if (message?.type === "cuims-clear:tab-page") work = () => attendance.noteTabPage({ path: message.path, result: message.result });
    if (work) cuimsKeepAwake(() => settled.then(work)).catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // A changed UID or password lifts the "rejected login" pause, and a
    // different student's UID drops the last student's reads.
    if (changes.uid || changes.password) {
      chrome.storage.local.get({ loginGuard: null }, ({ loginGuard }) => {
        if (loginGuard?.rejectedUid) chrome.storage.local.set({ loginGuard: { ...loginGuard, rejectedUid: "" } });
      });
    }
    if (changes.uid) cuimsKeepAwake(() => settled.then(() => attendance.checkStudent())).catch(() => {});
    // A CUIMS tab finished signing in after a refresh gave way to it.
    if (changes.sessionAlive?.newValue === true) {
      cuimsKeepAwake(() => hasAccess().then((granted) => (granted ? attendance.afterTabSignIn() : null))).catch(() => {});
    }
  });

  return attendance;
}

// A background that was stopped mid-task (by a browser update, a crash, or a
// build without keep-awake.js) left its locks behind: the CUIMS tab held back
// its own login for 90 s, Refresh answered "busy" for 2 min, and the popup
// showed a read in progress. A background that has just started has nothing
// running, so they are stale.
function clearStaleLocks() {
  return chrome.storage.local
    .get({ attendanceRunUntil: 0, bgSignInUntil: 0, attendanceStatus: null })
    .then(({ attendanceRunUntil, bgSignInUntil, attendanceStatus }) => {
      const stale = {};
      if (Number(attendanceRunUntil) > 0) stale.attendanceRunUntil = 0;
      if (Number(bgSignInUntil) > 0) stale.bgSignInUntil = 0;
      if (attendanceStatus?.working) stale.attendanceStatus = { ...attendanceStatus, working: false, phase: "" };
      if (Object.keys(stale).length) return chrome.storage.local.set(stale);
    })
    .catch(() => {});
}

// The captcha solver is plain JavaScript (captcha-solver.js), so it runs
// right here: Firefox's background page and Chrome's service worker alike.
startAttendanceBackground((bytes) => CuimsCaptcha.readBytes(bytes));
