// Connects the attendance daemon to the browser: popup refreshes, the
// class-hours alarm, and the shared login guard. Runs in the Firefox
// background page and in Chrome's service worker.

const ATTENDANCE_ALARM = "cuims-clear-attendance";
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

  const hasAccess = () => chrome.permissions.contains(CUIMS_ORIGINS);

  function fromExtensionPage(sender) {
    return Boolean(sender) && !sender.tab && (!sender.id || sender.id === chrome.runtime.id);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "cuims-clear:attendance-refresh" || !fromExtensionPage(sender)) return;
    hasAccess()
      .then((granted) => {
        if (!granted) return { error: "The browser has switched off access to CUIMS. Use Allow access at the top.", code: "no-access" };
        return attendance.refresh("manual");
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error), code: "network" }));
    return true;
  });

  // Re-creating an alarm restarts its period, and this script runs on every
  // wake, so only create it when it is missing.
  chrome.alarms.get(ATTENDANCE_ALARM).then((alarm) => {
    if (!alarm) chrome.alarms.create(ATTENDANCE_ALARM, { periodInMinutes: 5 });
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== ATTENDANCE_ALARM) return;
    hasAccess()
      .then((granted) => (granted ? attendance.tick() : null))
      .catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // A changed UID or password lifts the "rejected login" pause.
    if (changes.uid || changes.password) {
      chrome.storage.local.get({ loginGuard: null }, ({ loginGuard }) => {
        if (loginGuard?.rejectedUid) chrome.storage.local.set({ loginGuard: { ...loginGuard, rejectedUid: "" } });
      });
    }
    // A CUIMS tab finished signing in after a refresh gave way to it.
    if (changes.sessionAlive?.newValue === true) {
      hasAccess()
        .then((granted) => (granted ? attendance.afterTabSignIn() : null))
        .catch(() => {});
    }
  });

  // lms-open.js asks for a signed-in session before it opens a tab.
  globalThis.cuimsEnsureSession = () =>
    hasAccess().then((granted) => (granted ? attendance.ensureSession() : { alive: false, reason: "no-access" }));

  return attendance;
}

// Firefox runs the OCR solver in this same background page.
if (typeof solveCaptchaBytes === "function") startAttendanceBackground(solveCaptchaBytes);
