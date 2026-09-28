const DEFAULT_SETTINGS = {
  uid: "",
  password: "",
  autoAdvanceUid: true,
  autoSolveCaptcha: true,
  autoSubmitLogin: true,
  blockEvents: true,
  blockFeedback: true,
};

const ATTENDANCE_KEYS = [
  "attendanceSnapshot",
  "attendanceTimetable",
  "attendanceStatus",
  "attendanceAuto",
  "attendanceMeta",
  "attendanceLastBad",
  "attendanceBackoffUntil",
  "attendanceFailStreak",
  "attendanceLastAttemptAt",
  "sessionAlive",
  "sessionCheckedAt",
];
const STALE_MS = 10 * 60 * 1000;
const SITE_ORIGINS = ["https://students.cuchd.in/*", "https://lms.cuchd.in/*"];

const form = document.querySelector("#settings-form");
const uid = document.querySelector("#uid");
const password = document.querySelector("#password");
const autoAdvance = document.querySelector("#auto-advance");
const autoSolveCaptcha = document.querySelector("#auto-solve-captcha");
const autoSubmitLogin = document.querySelector("#auto-submit-login");
const blockEvents = document.querySelector("#block-events");
const blockFeedback = document.querySelector("#block-feedback");
const status = document.querySelector("#status");
const togglePassword = document.querySelector("#toggle-password");
const clearLogin = document.querySelector("#clear-login");

const tabs = { login: document.querySelector("#tab-login"), attendance: document.querySelector("#tab-attendance") };
const views = { login: document.querySelector("#view-login"), attendance: document.querySelector("#view-attendance") };

const accessBanner = document.querySelector("#access-banner");

let statusTimer;
let attendance = { snapshot: null, status: null, error: "" };
let repaintTimer;

function showStatus(message) {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

chrome.storage.local.get(DEFAULT_SETTINGS, (settings) => {
  uid.value = settings.uid;
  password.value = settings.password;
  autoAdvance.checked = settings.autoAdvanceUid;
  autoSolveCaptcha.checked = settings.autoSolveCaptcha;
  autoSubmitLogin.checked = settings.autoSubmitLogin;
  blockEvents.checked = settings.blockEvents;
  blockFeedback.checked = settings.blockFeedback;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  chrome.storage.local.set(
    {
      uid: uid.value.trim(),
      password: password.value,
      autoAdvanceUid: autoAdvance.checked,
      autoSolveCaptcha: autoSolveCaptcha.checked,
      autoSubmitLogin: autoSubmitLogin.checked,
      blockEvents: blockEvents.checked,
      blockFeedback: blockFeedback.checked,
    },
    () => {
      showStatus("Changes saved");
    },
  );
});

togglePassword.addEventListener("click", () => {
  const isHidden = password.type === "password";
  password.type = isHidden ? "text" : "password";
  togglePassword.textContent = isHidden ? "Hide" : "Show";
  togglePassword.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

clearLogin.addEventListener("click", () => {
  chrome.storage.local.remove(["uid", "password", ...ATTENDANCE_KEYS], () => {
    attendance = { snapshot: null, status: null, error: "" };
    if (!views.attendance.hidden) paintAttendance();
    uid.value = "";
    password.value = "";
    password.type = "password";
    togglePassword.textContent = "Show";
    togglePassword.setAttribute("aria-label", "Show password");
    showStatus("Saved login and attendance cleared");
    uid.focus();
  });
});

document.querySelector(".lms-open-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  showStatus("Opening LMS…");
  chrome.runtime.sendMessage({ type: "cuims-clear:launch-lms" }, (response) => {
    if (chrome.runtime.lastError || response?.error) {
      showStatus("Could not open LMS. Refresh CUIMS and try again.");
      return;
    }
    window.close();
  });
});

function paintAttendance() {
  const status = attendance.status || {};
  const working = Boolean(status.working) && Date.now() - Number(status.at || 0) < 2 * 60 * 1000;
  const analytics = attendance.snapshot?.subjects?.length ? CuimsAttendance.buildAnalytics(attendance.snapshot, new Date()) : null;
  views.attendance.innerHTML = CuimsAttendance.renderAttendance(analytics, {
    working,
    phase: status.phase,
    error: working ? "" : attendance.error || status.error || "",
  });
  return working;
}

function fetchAttendance() {
  attendance.error = "";
  attendance.status = { working: true, phase: "Checking your CUIMS session…", at: Date.now() };
  paintAttendance();
  chrome.runtime.sendMessage({ type: "cuims-clear:attendance-refresh" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      attendance.status = null;
      attendance.error = "Could not reach the extension background. Try again.";
    } else {
      attendance.snapshot = response.snapshot || attendance.snapshot;
      attendance.error = response.error || "";
      attendance.status = { working: false };
    }
    paintAttendance();
  });
}

function showView(name) {
  for (const key of Object.keys(views)) {
    const active = key === name;
    views[key].hidden = !active;
    tabs[key].setAttribute("aria-selected", String(active));
    tabs[key].tabIndex = active ? 0 : -1;
  }
  chrome.storage.local.set({ popupView: name });
  window.clearInterval(repaintTimer);
  if (name !== "attendance") return;
  const working = paintAttendance();
  repaintTimer = window.setInterval(paintAttendance, 30_000);
  const fetchedAt = Date.parse(attendance.snapshot?.fetchedAt || "") || 0;
  if (!working && Date.now() - fetchedAt > STALE_MS) fetchAttendance();
}

for (const [name, tab] of Object.entries(tabs)) {
  tab.addEventListener("click", () => showView(name));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = name === "login" ? "attendance" : "login";
    showView(next);
    tabs[next].focus();
  });
}

views.attendance.addEventListener("click", (event) => {
  if (event.target.closest("#fetch-attendance")) fetchAttendance();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.attendanceSnapshot) attendance.snapshot = changes.attendanceSnapshot.newValue || null;
  if (changes.attendanceStatus) attendance.status = changes.attendanceStatus.newValue || null;
  if ((changes.attendanceSnapshot || changes.attendanceStatus) && !views.attendance.hidden) paintAttendance();
});

chrome.storage.local.get({ attendanceSnapshot: null, attendanceStatus: null, popupView: "login" }, (stored) => {
  attendance.snapshot = stored.attendanceSnapshot;
  attendance.status = stored.attendanceStatus;
  if (stored.popupView === "attendance") showView("attendance");
});

// Firefox lets people withdraw an MV3 add-on's site access. Without it the
// login page is left alone and the background cannot reach CUIMS.
function checkSiteAccess() {
  chrome.permissions.contains({ origins: SITE_ORIGINS }, (granted) => {
    accessBanner.hidden = Boolean(granted);
  });
}

document.querySelector("#grant-access").addEventListener("click", () => {
  chrome.permissions.request({ origins: SITE_ORIGINS }, (granted) => {
    accessBanner.hidden = Boolean(granted);
    if (granted) showStatus("Access allowed. Reload CUIMS.");
  });
});

checkSiteAccess();
