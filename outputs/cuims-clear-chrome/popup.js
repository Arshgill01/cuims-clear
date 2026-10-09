// Switches save the moment they change. The saved login is the only thing
// with an explicit Save, since a half-typed password should never be stored.
const SWITCH_DEFAULTS = {
  autoAdvanceUid: true,
  autoSolveCaptcha: true,
  autoSubmitLogin: true,
  blockEvents: true,
  blockFeedback: true,
  lmsClear: true,
  themeCuims: true,
  cuimsTidy: true,
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
  "attendanceLeaves",
  "attendanceCourses",
  "attendancePlan",
  "attendanceHistory",
  "marksCache",
  "marksStatus",
  "marksRefreshAt",
  "marksSession",
  "timetableCache",
  "timetableStatus",
  "newTabRequests",
  "newTabRequestCounts",
];
const STALE_MS = 10 * 60 * 1000;
const SITE_ORIGINS = ["https://students.cuchd.in/*", "https://lms.cuchd.in/*"];
const CONFIRM_MS = 4000;

const form = document.querySelector("#settings-form");
const uid = document.querySelector("#uid");
const password = document.querySelector("#password");
const saveButton = document.querySelector("#save-button");
const dirtyNote = document.querySelector("#dirty-note");
const status = document.querySelector("#status");
const togglePassword = document.querySelector("#toggle-password");
const clearLogin = document.querySelector("#clear-login");
const loginDot = document.querySelector("#login-dot");
const summaryList = document.querySelector("#summary-list");
const viewport = document.querySelector("#views");
const switches = [...document.querySelectorAll('input[role="switch"][data-key]')];

// Rail order: what a student checks daily first, setup after.
const tabs = {
  attendance: document.querySelector("#tab-attendance"),
  forecast: document.querySelector("#tab-forecast"),
  marks: document.querySelector("#tab-marks"),
  timetable: document.querySelector("#tab-timetable"),
  login: document.querySelector("#tab-login"),
  theme: document.querySelector("#tab-theme"),
  settings: document.querySelector("#tab-settings"),
};
const views = {
  attendance: document.querySelector("#view-attendance"),
  forecast: document.querySelector("#view-forecast"),
  marks: document.querySelector("#view-marks"),
  timetable: document.querySelector("#view-timetable"),
  login: document.querySelector("#view-login"),
  theme: document.querySelector("#view-theme"),
  settings: document.querySelector("#view-settings"),
};

const themeGroups = document.querySelector("#theme-groups");
let currentTheme = CuimsThemes.mirrored();

const accessBanner = document.querySelector("#access-banner");
const rateNudge = document.querySelector("#rate-nudge");
document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;

let statusTimer;
let confirmTimer;
let repaintTimer;
let currentView = "";
let settings = { ...SWITCH_DEFAULTS };
let savedLogin = { uid: "", password: "" };
let attendance = { snapshot: null, status: null, error: "", code: "", history: null };
// The student's goal and last day of classes are preferences; planned skips
// are "<day>|<class>" keys, dropped once their day has passed.
let prefs = { goal: "standard", plan: [], end: "" };
// Which day the planner shows and which subject is open, for this popup only.
let forecastUi = { day: "", expanded: "" };
// "", "ask" or "confirm", decided once per popup open (rate-nudge.js).
let rateShow = "";
let marksState = { cache: null, status: null };
let timetableState = { cache: null, status: null };
let timetablePending = false;
let timetableSequence = 0;
let timetableDay = "";
let marksPending = false;
let marksReadSequence = 0;

function todayKey() {
  return CuimsAttendance.campusParts(new Date()).key;
}

function plannedSkips() {
  const today = todayKey();
  return prefs.plan.filter((key) => String(key).slice(0, 10) >= today);
}

// 0.9.5 kept one day's skips as { day, skips: ["<class>"] }.
function readPlan(stored) {
  if (Array.isArray(stored?.keys)) return stored.keys.map(String);
  if (stored?.day && Array.isArray(stored.skips)) return stored.skips.map((key) => `${stored.day}|${key}`);
  return [];
}

function savePlan(keys) {
  prefs.plan = [...new Set(keys)];
  chrome.storage.local.set({ attendancePlan: { v: 2, keys: prefs.plan } });
}

function showStatus(message) {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  status.classList?.add("is-shown");
  statusTimer = window.setTimeout(() => {
    status.classList?.remove("is-shown");
    status.textContent = "";
  }, 1800);
}

function hasLogin() {
  return Boolean(savedLogin.uid && savedLogin.password);
}

// ---- saved login ----

function loginDirty() {
  return uid.value.trim() !== savedLogin.uid || password.value !== savedLogin.password;
}

function syncLoginState() {
  const dirty = loginDirty();
  saveButton.disabled = !dirty;
  dirtyNote.textContent = dirty ? "Unsaved changes" : "";
  // Saving only the UID is a supported setup (the student types the
  // password), so the dot asks for a UID, not for both.
  loginDot.hidden = Boolean(savedLogin.uid);
}

uid.addEventListener("input", syncLoginState);
password.addEventListener("input", syncLoginState);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!loginDirty()) return;
  const next = { uid: uid.value.trim(), password: password.value };
  if (next.uid !== savedLogin.uid) {
    marksReadSequence += 1;
    marksPending = false;
    marksState = { cache: null, status: null };
    timetableState = { cache: null, status: null };
    timetablePending = false;
    timetableSequence += 1;
    chrome.storage.local.remove(["marksCache", "marksStatus", "marksSession", "timetableCache", "timetableStatus"]);
  }
  chrome.storage.local.set(next, () => {
    savedLogin = next;
    if (hasLogin()) {
      if (marksState.status?.code === "needs-login") marksState.status = null;
      if (timetableState.status?.code === "needs-login") timetableState.status = null;
    }
    uid.value = next.uid;
    syncLoginState();
    showStatus("Login saved");
    paintData();
  });
});

togglePassword.addEventListener("click", () => {
  const isHidden = password.type === "password";
  password.type = isHidden ? "text" : "password";
  togglePassword.textContent = isHidden ? "Hide" : "Show";
  togglePassword.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

function resetClearButton() {
  window.clearTimeout(confirmTimer);
  clearLogin.classList?.remove("is-confirming");
  clearLogin.textContent = "Clear login";
}

// Clearing removes the password and every attendance read, so the first
// press only asks.
clearLogin.addEventListener("click", () => {
  if (!clearLogin.classList?.contains("is-confirming")) {
    clearLogin.classList?.add("is-confirming");
    clearLogin.textContent = "Press again to clear";
    confirmTimer = window.setTimeout(resetClearButton, CONFIRM_MS);
    return;
  }
  resetClearButton();
  chrome.storage.local.remove(["uid", "password", ...ATTENDANCE_KEYS], () => {
    attendance = { snapshot: null, status: null, error: "", code: "", history: null };
    prefs.plan = [];
    marksReadSequence += 1;
    marksPending = false;
    marksState = { cache: null, status: null };
    timetableState = { cache: null, status: null };
    timetablePending = false;
    timetableSequence += 1;
    savedLogin = { uid: "", password: "" };
    uid.value = "";
    password.value = "";
    password.type = "password";
    togglePassword.textContent = "Show";
    togglePassword.setAttribute("aria-label", "Show password");
    syncLoginState();
    paintData();
    if (!views.timetable.hidden) paintTimetable();
    if (!views.marks.hidden) paintMarks();
    showStatus("Saved login, attendance, marks, and timetable cleared");
    uid.focus();
  });
});
clearLogin.addEventListener("blur", resetClearButton);

// ---- switches ----

// What the login page will do, in words, on the Login tab.
function renderSummary() {
  if (!summaryList) return;
  const quiet = settings.blockEvents && settings.blockFeedback
    ? "Hides event and feedback dialogs"
    : settings.blockEvents
      ? "Hides event dialogs"
      : settings.blockFeedback
        ? "Hides feedback dialogs"
        : "";
  const rows = [
    [settings.autoAdvanceUid, "Moves past the UID step", "Stops at the UID step"],
    [settings.autoSolveCaptcha, "Solves the CAPTCHA on-device", "Leaves the CAPTCHA to you"],
    [settings.autoSolveCaptcha && settings.autoSubmitLogin, "Presses Login, up to three tries", "Leaves Login to you"],
    [Boolean(quiet), quiet, "Shows event and feedback dialogs"],
  ];
  summaryList.replaceChildren(
    ...rows.map(([on, yes, no]) => {
      const item = document.createElement("li");
      const glyph = document.createElement("span");
      const text = document.createElement("span");
      if (on) item.className = "is-on";
      glyph.className = "glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = on ? "✓" : "–";
      text.textContent = on ? yes : no;
      item.append(glyph, text);
      return item;
    }),
  );
}

// Auto-submit presses Login with the solver's read, so it needs the solver.
function syncDependents() {
  const submit = switches.find((input) => input.dataset.key === "autoSubmitLogin");
  if (!submit) return;
  const off = !settings.autoSolveCaptcha;
  // Shown as it acts (off) while unavailable; the stored choice comes back
  // with the solver.
  submit.disabled = off;
  submit.checked = !off && settings.autoSubmitLogin !== false;
  submit.closest?.(".switch-row")?.classList.toggle("is-disabled", off);
  const note = document.querySelector("#auto-submit-note");
  if (note) note.textContent = off ? "Needs Solve CAPTCHA turned on" : "Presses Login for you, up to three tries";
}

function paintSwitches() {
  for (const input of switches) input.checked = settings[input.dataset.key] !== false;
  syncDependents();
  renderSummary();
}

function switchName(input) {
  return input.closest?.(".switch-row")?.querySelector("strong")?.textContent.trim() || "Setting";
}

for (const input of switches) {
  input.addEventListener("change", () => {
    const key = input.dataset.key;
    settings[key] = input.checked;
    syncDependents();
    renderSummary();
    chrome.storage.local.set({ [key]: input.checked }, () => showStatus(`${switchName(input)}: ${input.checked ? "on" : "off"}`));
  });
}

// ---- opening CUIMS and LMS ----

async function activeTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id || 0;
  } catch {
    return 0;
  }
}

// The background signs in first when the session has ended, and opens LMS
// without showing CUIMS.
function bindOpenLink(link, type, busyLabel) {
  link?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    link.setAttribute("aria-busy", "true");
    const label = link.querySelector("span");
    const idle = label?.textContent;
    if (label) label.textContent = busyLabel;
    chrome.runtime.sendMessage({ type, tabId: await activeTabId() }, (response) => {
      if (chrome.runtime.lastError || !response || response.error) {
        link.removeAttribute("aria-busy");
        if (label) label.textContent = idle;
        showStatus(response?.error || (type === "cuims-clear:launch-lms" ? "Could not open LMS. Try again." : "Could not open CUIMS. Try again."));
        return;
      }
      window.close();
    });
  });
}

bindOpenLink(document.querySelector(".cuims-open-link"), "cuims-clear:open-cuims", "Opening…");
bindOpenLink(document.querySelector(".lms-open-link"), "cuims-clear:launch-lms", "Opening LMS…");

// ---- attendance ----

// The attendance view is redrawn from scratch (every 30 s, and on every
// background update), so keyboard focus is carried over by what it points at.
function focusKey(node, view = views.attendance) {
  if (!node || node === view || !view.contains?.(node)) return "";
  if (node.id) return `#${CSS.escape(node.id)}`;
  for (const name of ["planKey", "planDay", "planClear", "planWhole", "goal", "goto", "subject", "endStep", "endReset", "endInput", "action", "chart"]) {
    const value = node.dataset?.[name];
    if (value != null && name in (node.dataset || {})) return `[data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value)}"]`;
  }
  return "";
}

// A control redrawn disabled (Refresh while refreshing) cannot hold focus;
// its key is kept and focus goes back to it once it is enabled again.
let carriedFocus = "";
let refreshReadyTimer;

// When the wait between refreshes ends, Refresh comes back on its own,
// without a request.
function scheduleRefreshReady() {
  window.clearTimeout(refreshReadyTimer);
  const remaining = Number(attendance.nextRefreshAt || 0) - Date.now();
  if (remaining > 0 && (currentView === "attendance" || currentView === "forecast")) refreshReadyTimer = window.setTimeout(paintData, remaining);
}

function readWorking() {
  const status = attendance.status || {};
  return Boolean(status.working) && Date.now() - Number(status.at || 0) < 2 * 60 * 1000;
}

// Redraws a view and puts keyboard focus back on what it pointed at.
function repaint(view, html) {
  const active = document.activeElement;
  const key = focusKey(active, view) || (active === view || active === document.body ? carriedFocus : "");
  view.innerHTML = html;
  carriedFocus = "";
  const target = key ? view.querySelector(key) : null;
  if (target?.disabled) {
    carriedFocus = key;
    view.focus({ preventScroll: true });
  } else target?.focus();
}

function paintAttendance() {
  const status = attendance.status || {};
  const working = readWorking();
  const analytics = attendance.snapshot?.subjects?.length
    ? CuimsAttendance.buildAnalytics(attendance.snapshot, new Date(), { goal: prefs.goal })
    : null;
  repaint(views.attendance, CuimsAttendance.renderAttendance(analytics, {
    working,
    nextRefreshAt: attendance.nextRefreshAt,
    phase: status.phase,
    needsLogin: !hasLogin(),
    error: working ? "" : attendance.error || status.error || "",
    code: working ? "" : attendance.code || status.code || "",
  }));
  scheduleRefreshReady();
  updateRate();
  paintRate();
  return working;
}

// The crosshair lives on the drawn chart, so the half-minute redraw waits
// while the student is reading one.
const forecastCharts = CuimsAttendance.bindForecastCharts(views.forecast);

function paintForecast({ force = true } = {}) {
  if (!force && forecastCharts.busy()) return readWorking();
  const status = attendance.status || {};
  const working = readWorking();
  const forecast = attendance.snapshot?.subjects?.length
    ? CuimsAttendance.buildForecast(attendance.snapshot, attendance.history, new Date(), { goal: prefs.goal, plan: plannedSkips(), end: prefs.end, day: forecastUi.day })
    : null;
  if (forecast?.plan) forecastUi.day = forecast.plan.day;
  repaint(views.forecast, CuimsAttendance.renderForecast(forecast, {
    working,
    phase: status.phase,
    expanded: forecastUi.expanded,
    nextRefreshAt: attendance.nextRefreshAt,
    error: working ? "" : attendance.error || status.error || "",
    code: working ? "" : attendance.code || status.code || "",
  }));
  scheduleRefreshReady();
  return working;
}

function paintData() {
  if (currentView === "attendance") return paintAttendance();
  if (currentView === "forecast") return paintForecast();
  return readWorking();
}

function fetchAttendance() {
  if (Date.now() < Number(attendance.nextRefreshAt || 0)) return;
  attendance.error = "";
  attendance.code = "";
  attendance.status = { working: true, phase: "Checking your CUIMS session…", at: Date.now() };
  paintData();
  chrome.runtime.sendMessage({ type: "cuims-clear:attendance-refresh" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      attendance.status = null;
      attendance.error = "Could not reach the extension background. Try again.";
      attendance.code = "";
    } else {
      attendance.snapshot = response.snapshot || attendance.snapshot;
      attendance.error = response.error || "";
      attendance.code = response.code || "";
      attendance.nextRefreshAt = response.nextRefreshAt || 0;
      attendance.status = { working: false };
    }
    paintData();
  });
}

// ---- views ----

function paintMarks() {
  const cache = CuimsMarks.marksCacheFor(marksState.cache, savedLogin.uid);
  let state = marksState.status?.uid && marksState.status.uid !== savedLogin.uid ? null : marksState.status;
  if (state?.working && !marksPending && Date.now() - Number(state.at || 0) > 2 * 60 * 1000) {
    state = { working: false, error: "The previous marks read stopped. Try again." };
  }
  views.marks.innerHTML = CuimsMarksView.render(cache, { ...state, needsLogin: !hasLogin() });
}

function fetchMarks(refresh = false) {
  if (!hasLogin()) {
    marksState.status = { error: "Save your UID and password on the Login tab first.", code: "needs-login" };
    paintMarks();
    return;
  }
  if (marksPending) return;
  const sequence = ++marksReadSequence;
  const uidAtStart = savedLogin.uid;
  marksPending = true;
  marksState.status = { working: true, phase: "Reading regular marks…" };
  paintMarks();
  chrome.runtime.sendMessage({ type: "cuims-clear:marks-read", refresh }, (response) => {
    if (sequence !== marksReadSequence || uidAtStart !== savedLogin.uid) return;
    marksPending = false;
    if (chrome.runtime.lastError || !response) {
      marksState.status = { error: "Could not reach the extension background. Try again.", working: false };
    } else {
      if (response.cache) marksState.cache = response.cache;
      marksState.status = { working: false, error: response.error || "", code: response.code || "" };
    }
    if (!views.marks.hidden) paintMarks();
  });
}

views.marks.addEventListener("click", (event) => {
  if (event.target.closest("#fetch-marks")) fetchMarks(true);
});

function paintTimetable() {
  const cache = CuimsTimetable.cacheFor(timetableState.cache, savedLogin.uid);
  let state = timetableState.status?.uid && timetableState.status.uid !== savedLogin.uid ? null : timetableState.status;
  if (state?.working && !timetablePending && Date.now() - Number(state.at || 0) > 2 * 60 * 1000)
    state = { error: "The previous read stopped. Try again." };
  views.timetable.innerHTML = CuimsTimetableView.render(cache, { ...state, needsLogin: !hasLogin() }, { day: timetableDay });
}
function fetchTimetable() {
  if (!hasLogin()) {
    timetableState.status = { error: "Save your UID and password on the Login tab first.", code: "needs-login" };
    paintTimetable();
    return;
  }
  if (timetablePending) return;
  const sequence = ++timetableSequence, uidAtStart = savedLogin.uid;
  timetablePending = true;
  timetableState.status = { working: true };
  paintTimetable();
  chrome.runtime.sendMessage({ type: "cuims-clear:timetable-read" }, response => {
    if (sequence !== timetableSequence || uidAtStart !== savedLogin.uid) return;
    timetablePending = false;
    if (chrome.runtime.lastError || !response) timetableState.status = { error: "Could not reach the extension background. Try again." };
    else {
      if (response.cache) timetableState.cache = response.cache;
      timetableState.status = { error: response.error || "", code: response.code || "" };
    }
    if (!views.timetable.hidden) paintTimetable();
  });
}
views.timetable.addEventListener("click", event => {
  if (event.target.closest("#fetch-timetable")) fetchTimetable();
  const day = event.target.closest("[data-timetable-day]")?.dataset.timetableDay;
  if (day && CuimsTimetable.DAYS.includes(day)) {
    timetableDay = day;
    paintTimetable();
    viewport.scrollTop = 0;
    views.timetable.querySelector('[data-timetable-day="' + day + '"]')?.focus({ preventScroll: true });
  }
});

views.timetable.addEventListener("keydown", event => {
  const day = event.target.closest("[data-timetable-day]")?.dataset.timetableDay;
  const index = CuimsTimetable.DAYS.indexOf(day);
  if (index < 0) return;
  let next;
  if (event.key === "ArrowRight") next = (index + 1) % 7;
  else if (event.key === "ArrowLeft") next = (index + 6) % 7;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = 6;
  else return;
  event.preventDefault();
  views.timetable.querySelector('[data-timetable-day="' + CuimsTimetable.DAYS[next] + '"]')?.click();
});

function showView(name, { remember = true } = {}) {
  if (!views[name]) name = "login";
  for (const key of Object.keys(views)) {
    const active = key === name;
    views[key].hidden = !active;
    tabs[key].setAttribute("aria-selected", String(active));
    tabs[key].tabIndex = active ? 0 : -1;
  }
  if (currentView && currentView !== name && viewport) viewport.scrollTop = 0;
  currentView = name;
  if (remember) chrome.storage.local.set({ popupView: name });
  window.clearInterval(repaintTimer);
  window.clearTimeout(refreshReadyTimer);
  paintRate();
  if (name === "theme") renderThemes();
  if (name === "timetable") {
    paintTimetable();
    if (!CuimsTimetable.cacheFor(timetableState.cache, savedLogin.uid) && (!timetableState.status || (!timetableState.status.working && !timetableState.status.error) || timetableState.status.code === "tab-login") && hasLogin()) fetchTimetable();
  }
  if (name === "marks") {
    paintMarks();
    // A failure is retried only with the button; a successful read never
    // expires. Switching tabs or reopening the popup sends no repeat read.
    if (!CuimsMarks.marksCacheFor(marksState.cache, savedLogin.uid) && (!marksState.status || (!marksState.status.working && !marksState.status.error) || marksState.status.code === "tab-login") && hasLogin()) fetchMarks();
  }
  if (name !== "attendance" && name !== "forecast") return;
  const working = paintData();
  repaintTimer = window.setInterval(() => (currentView === "forecast" ? paintForecast({ force: false }) : paintAttendance()), 30_000);
  const fetchedAt = Date.parse(attendance.snapshot?.fetchedAt || "") || 0;
  if (!working && Date.now() - fetchedAt > STALE_MS) fetchAttendance();
}

// A vertical tab list: arrows move and select, Home and End jump.
const ORDER = Object.keys(tabs);
for (const [name, tab] of Object.entries(tabs)) {
  tab.addEventListener("click", () => showView(name));
  tab.addEventListener("keydown", (event) => {
    const index = ORDER.indexOf(name);
    const moves = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: ORDER.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = ORDER[(moves[event.key] + ORDER.length) % ORDER.length];
    showView(next);
    tabs[next].focus();
  });
}

// Buttons anywhere that send the student to another section.
document.addEventListener?.("click", (event) => {
  const jump = event.target.closest?.("[data-goto]");
  if (!jump || !views[jump.dataset.goto]) return;
  showView(jump.dataset.goto);
  tabs[jump.dataset.goto].focus();
});

function setGoal(goal) {
  prefs.goal = goal;
  chrome.storage.local.set({ attendanceGoal: prefs.goal });
}

views.attendance.addEventListener("click", (event) => {
  if (event.target.closest("#fetch-attendance")) {
    fetchAttendance();
    return;
  }
  const goal = event.target.closest("[data-goal]");
  if (goal) {
    setGoal(goal.dataset.goal);
    paintAttendance();
    views.attendance.querySelector(`[data-goal="${prefs.goal}"]`)?.focus();
  }
});

// ---- forecast ----

// The planner's keys are "<day>|<class>"; the day is the first ten characters.
function dayOfKey(key) {
  return String(key).slice(0, 10);
}

function setEnd(key) {
  prefs.end = key;
  chrome.storage.local.set({ forecastEnd: key });
}

function shiftDay(key, days) {
  const number = CuimsAttendance.dayNumber(key);
  return number == null ? "" : CuimsAttendance.dayKeyOf(number + days);
}

views.forecast.addEventListener("click", (event) => {
  const target = event.target;
  const focusAfter = (selector) => views.forecast.querySelector(selector)?.focus();
  // The date shows as a label; open the browser's picker where it has one.
  const picker = target.closest("[data-end-input]");
  if (picker) {
    try {
      picker.showPicker?.();
    } catch {
      // Typing the date still works.
    }
    return;
  }
  if (target.closest("[data-action='refresh']")) {
    fetchAttendance();
    return;
  }
  const goal = target.closest("[data-goal]");
  if (goal) {
    setGoal(goal.dataset.goal);
    paintForecast();
    focusAfter(`[data-goal="${prefs.goal}"]`);
    return;
  }
  const day = target.closest("[data-plan-day]");
  if (day) {
    forecastUi.day = day.dataset.planDay;
    paintForecast();
    focusAfter(`[data-plan-day="${CSS.escape(forecastUi.day)}"]`);
    return;
  }
  const row = target.closest("[data-plan-key]");
  if (row) {
    const key = row.dataset.planKey;
    const keys = new Set(plannedSkips());
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    savePlan([...keys]);
    paintForecast();
    focusAfter(`[data-plan-key="${CSS.escape(key)}"]`);
    return;
  }
  if (target.closest("[data-plan-whole]")) {
    const keys = [...views.forecast.querySelectorAll("[data-plan-key]")].map((node) => node.dataset.planKey);
    savePlan([...plannedSkips(), ...keys]);
    paintForecast();
    focusAfter("[data-plan-clear='day']");
    return;
  }
  const clear = target.closest("[data-plan-clear]");
  if (clear) {
    savePlan(clear.dataset.planClear === "all" ? [] : plannedSkips().filter((key) => dayOfKey(key) !== forecastUi.day));
    paintForecast();
    focusAfter(`[data-plan-day="${CSS.escape(forecastUi.day)}"]`);
    return;
  }
  const subject = target.closest("[data-subject]");
  if (subject) {
    const code = subject.dataset.subject;
    forecastUi.expanded = forecastUi.expanded === code ? "" : code;
    paintForecast();
    focusAfter(`[data-subject="${CSS.escape(code)}"]`);
    return;
  }
  const step = target.closest("[data-end-step]");
  if (step) {
    const current = views.forecast.querySelector("[data-end-input]")?.value || prefs.end;
    const next = shiftDay(current, Number(step.dataset.endStep));
    if (next && next >= todayKey()) setEnd(next);
    paintForecast();
    focusAfter(`[data-end-step="${step.dataset.endStep}"]`);
    return;
  }
  if (target.closest("[data-end-reset]")) {
    setEnd("");
    paintForecast();
    focusAfter("[data-end-step='7']");
  }
});

views.forecast.addEventListener("change", (event) => {
  const input = event.target.closest?.("[data-end-input]");
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input.value) || input.value < todayKey()) return;
  setEnd(input.value);
  paintForecast();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.uid) {
    savedLogin.uid = String(changes.uid.newValue || "");
    marksReadSequence += 1;
    marksPending = false;
    marksState = { cache: null, status: null };
    timetableState = { cache: null, status: null };
    timetablePending = false;
    timetableSequence += 1;
  }
  if (changes.timetableCache) timetableState.cache = changes.timetableCache.newValue || null;
  if (changes.timetableStatus) timetableState.status = changes.timetableStatus.newValue || null;
  if ((changes.uid || changes.timetableCache || changes.timetableStatus) && !views.timetable.hidden) paintTimetable();
  if (changes.marksCache) marksState.cache = changes.marksCache.newValue || null;
  if (changes.marksStatus) marksState.status = changes.marksStatus.newValue || null;
  if ((changes.uid || changes.marksCache || changes.marksStatus) && !views.marks.hidden) paintMarks();
  // Opening CUIMS or LMS may sign in first; say so on the button.
  const phase = changes.attendanceStatus?.newValue?.working && changes.attendanceStatus.newValue.phase;
  const busy = document.querySelector(".open-link[aria-busy='true'] span");
  if (phase && busy) busy.textContent = phase;
  if (changes.attendanceLastAttemptAt) attendance.lastAttemptAt = changes.attendanceLastAttemptAt.newValue || 0;
  if (changes.attendanceBackoffUntil) attendance.backoffUntil = changes.attendanceBackoffUntil.newValue || 0;
  attendance.nextRefreshAt = Math.max(Number(attendance.lastAttemptAt || 0) + 60_000, Number(attendance.backoffUntil || 0));
  if (changes.attendanceSnapshot) attendance.snapshot = changes.attendanceSnapshot.newValue || null;
  if (changes.attendanceStatus) {
    attendance.status = changes.attendanceStatus.newValue || null;
    attendance.error = "";
    attendance.code = "";
  }
  if (changes.attendanceHistory) attendance.history = changes.attendanceHistory.newValue || null;
  if (changes.attendanceSnapshot || changes.attendanceStatus || changes.attendanceHistory || changes.attendanceLastAttemptAt || changes.attendanceBackoffUntil) paintData();
  // A switch flipped elsewhere (the LMS page's own Original view button).
  let flipped = false;
  for (const key of Object.keys(SWITCH_DEFAULTS)) {
    if (!changes[key]) continue;
    settings[key] = changes[key].newValue ?? SWITCH_DEFAULTS[key];
    flipped = true;
  }
  if (flipped) paintSwitches();
});

// Firefox lets people withdraw an MV3 add-on's site access (Chrome can too). Without it the
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

// ---- store rating ----

const rateAsk = rateNudge?.querySelector(".rate-ask");
const rateConfirm = rateNudge?.querySelector(".rate-confirm");
let rateState = null;
let rateReady = false;
let rateTimer = 0;
let rateLeft = 0;
let rateStarted = 0;

function readFailed() {
  const status = attendance.status || {};
  return Boolean(attendance.error || attendance.code || status.error || status.code);
}

// Only beside the attendance it is asking about, and never under an error.
function paintRate() {
  if (!rateNudge) return;
  rateNudge.hidden = !(rateShow && currentView === "attendance" && attendance.snapshot?.subjects?.length && !readFailed());
  if (rateAsk) rateAsk.hidden = rateShow !== "ask";
  if (rateConfirm) rateConfirm.hidden = rateShow !== "confirm";
  if (rateNudge.hidden) settleRate();
}

function saveRate(next, show) {
  rateState = next;
  rateShow = show;
  chrome.storage.local.set({ rateNudge: next });
  settleRate();
  paintRate();
}

// The day's first ask sits under the header for a few seconds, then moves to
// the bottom strip. The countdown waits while the pointer or focus is on it.
function liftRate() {
  if (!rateNudge || !viewport) return;
  viewport.before?.(rateNudge);
  rateNudge.classList.add("is-top");
  rateLeft = globalThis.CuimsRate.TOP_MS;
  runRateTimer();
}

function runRateTimer() {
  window.clearTimeout(rateTimer);
  rateStarted = Date.now();
  rateNudge.classList.remove("is-paused");
  rateTimer = window.setTimeout(settleRate, rateLeft);
}

function pauseRateTimer() {
  if (!rateNudge?.classList.contains("is-top") || rateNudge.classList.contains("is-paused")) return;
  window.clearTimeout(rateTimer);
  rateLeft = Math.max(0, rateLeft - (Date.now() - rateStarted));
  rateNudge.classList.add("is-paused");
}

function resumeRateTimer() {
  if (!rateNudge?.classList.contains("is-top") || rateNudge.matches?.(":hover, :focus-within")) return;
  runRateTimer();
}

function settleRate() {
  window.clearTimeout(rateTimer);
  if (!rateNudge?.classList.contains("is-top")) return;
  rateNudge.classList.remove("is-top", "is-paused");
  viewport.after?.(rateNudge);
}

function setupRate(stored) {
  const rate = globalThis.CuimsRate;
  if (!rate || !rateNudge) return;
  const shop = rate.store(globalThis.location?.protocol);
  for (const link of document.querySelectorAll(".rate-link")) {
    link.href = shop.url;
    link.addEventListener("click", () => saveRate(rate.opened(rateState), rateState?.done ? "" : "confirm"));
  }
  for (const name of document.querySelectorAll(".rate-store")) name.textContent = shop.name;
  rateNudge.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-rate]")?.dataset.rate;
    if (action === "rated") {
      saveRate(rate.rated(rateState), "");
      showStatus("Thank you!");
    } else if (action === "not-yet") saveRate(rate.notYet(rateState), "ask");
    else if (action === "snooze") saveRate(rate.snooze(rateState, Date.now()), "");
  });
  for (const type of ["pointerenter", "focusin"]) rateNudge.addEventListener(type, pauseRateTimer);
  rateNudge.addEventListener("pointerleave", resumeRateTimer);
  rateNudge.addEventListener("focusout", () => window.setTimeout(resumeRateTimer));

  rateState = stored.rateNudge;
  rateReady = true;
  updateRate();
}

function updateRate() {
  if (!rateReady || currentView !== "attendance") return;
  const healthy = Boolean(attendance.snapshot?.subjects?.length) && !readFailed();
  const { state, show, top } = CuimsRate.step(rateState, { now: Date.now(), today: todayKey(), healthy });
  if (JSON.stringify(state) !== JSON.stringify(rateState)) chrome.storage.local.set({ rateNudge: state });
  rateState = state;
  rateShow = show;
  if (top) liftRate();
}

// ---- themes ----

const THEME_GROUPS = [
  ["light", "Light"],
  ["dark", "Dark"],
];

// Each card previews its theme with that theme's own colours.
function themeCard(entry) {
  const t = CuimsThemes.tokens(entry.id);
  const vars = {
    "--p-canvas": t.canvas, "--p-surface": t.surface, "--p-ink": t.ink, "--p-line": t.line, "--p-accent": t.accent,
    "--p-good": t.good, "--p-track": t.track, "--p-brand-bg": t.brandBg, "--p-brand-ink": t.brandInk,
  };
  const style = Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");
  const dots = [t.goodInk, t.warnInk, t.badInk].map((color) => `<span style="background:${color}"></span>`).join("");
  const checked = entry.id === currentTheme;
  const name = CuimsAttendance.escapeHtml(entry.name);
  return `<li role="none"><button type="button" class="theme-card" role="radio" data-theme-id="${entry.id}" aria-checked="${checked}" tabindex="${checked ? 0 : -1}" title="${name}" style="${style}">
    <span class="theme-preview" aria-hidden="true">
      <span class="theme-preview-top"><span class="theme-preview-mark">//</span><span class="theme-preview-accent"></span></span>
      <span class="theme-preview-card"><span class="theme-preview-line"></span><span class="theme-preview-meter"><span></span></span><span class="theme-preview-dots">${dots}</span></span>
      <span class="theme-check">✓</span>
    </span>
    <span class="theme-name">${name}</span>
  </button></li>`;
}

function renderThemes() {
  themeGroups.setAttribute("role", "radiogroup");
  themeGroups.setAttribute("aria-label", "Theme");
  themeGroups.innerHTML = THEME_GROUPS.map(([scheme, label]) => {
    const entries = CuimsThemes.list.filter((entry) => entry.scheme === scheme);
    return `<section class="theme-group" role="none">
      <div class="section-head"><h2 class="section-label">${label}</h2><span class="section-meta">${entries.length}</span></div>
      <ul class="theme-grid" role="none">${entries.map(themeCard).join("")}</ul>
    </section>`;
  }).join("");
  // An unknown stored id still leaves one card reachable by Tab.
  const cards = themeCards();
  if (cards.length && !cards.some((card) => card.tabIndex === 0)) cards[0].tabIndex = 0;
}

function themeCards() {
  return [...themeGroups.querySelectorAll("[data-theme-id]")];
}

function useTheme(id) {
  currentTheme = CuimsThemes.valid(id);
  CuimsThemes.applyToPopup(document.documentElement, currentTheme);
  if (views.theme.hidden) return;
  for (const card of themeCards()) {
    const on = card.dataset.themeId === currentTheme;
    card.setAttribute("aria-checked", String(on));
    card.tabIndex = on ? 0 : -1;
  }
}

themeGroups.addEventListener("click", (event) => {
  const card = event.target.closest("[data-theme-id]");
  if (!card) return;
  useTheme(card.dataset.themeId);
  CuimsThemes.save(currentTheme);
});

// The card in the next row up or down that sits closest to this one, so the
// arrows follow the grid even where the Light and Dark groups meet.
function cardInRow(cards, from, direction) {
  const box = from.getBoundingClientRect();
  const middle = box.left + box.width / 2;
  const rows = cards
    .map((card) => ({ card, box: card.getBoundingClientRect() }))
    .filter(({ box: other }) => (direction > 0 ? other.top >= box.bottom - 1 : other.bottom <= box.top + 1));
  if (!rows.length) return null;
  const top = direction > 0 ? Math.min(...rows.map((row) => row.box.top)) : Math.max(...rows.map((row) => row.box.top));
  return rows
    .filter((row) => Math.abs(row.box.top - top) < 2)
    .sort((a, b) => Math.abs(a.box.left + a.box.width / 2 - middle) - Math.abs(b.box.left + b.box.width / 2 - middle))[0].card;
}

// Arrow keys move through the cards like a radio group; selection follows.
themeGroups.addEventListener("keydown", (event) => {
  const cards = themeCards();
  const index = cards.indexOf(document.activeElement);
  if (index < 0) return;
  let next = null;
  if (event.key === "ArrowRight") next = cards[Math.min(cards.length - 1, index + 1)];
  else if (event.key === "ArrowLeft") next = cards[Math.max(0, index - 1)];
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") next = cardInRow(cards, cards[index], event.key === "ArrowDown" ? 1 : -1);
  else if (event.key === "Home") next = cards[0];
  else if (event.key === "End") next = cards[cards.length - 1];
  else return;
  event.preventDefault();
  if (!next || next === cards[index]) return;
  next.focus();
  next.scrollIntoView?.({ block: "nearest" });
  next.click();
});

CuimsThemes.load().then(useTheme);
CuimsThemes.onChange(useTheme);

// Last, so every section above is ready even when storage answers at once.
chrome.storage.local.get(
  {
    ...SWITCH_DEFAULTS,
    uid: "",
    password: "",
    attendanceSnapshot: null,
    attendanceStatus: null,
    attendanceLastAttemptAt: 0,
    attendanceBackoffUntil: 0,
    popupView: "",
    attendanceGoal: "standard",
    attendancePlan: null,
    attendanceHistory: null,
    forecastEnd: "",
    rateNudge: null,
    timetableCache: null,
    timetableStatus: null,
    marksCache: null,
    marksStatus: null,
  },
  (stored) => {
    for (const key of Object.keys(SWITCH_DEFAULTS)) settings[key] = stored[key] !== false;
    savedLogin = { uid: String(stored.uid || ""), password: String(stored.password || "") };
    uid.value = savedLogin.uid;
    password.value = savedLogin.password;
    syncLoginState();
    paintSwitches();
    attendance.snapshot = stored.attendanceSnapshot;
    attendance.status = stored.attendanceStatus;
    attendance.history = stored.attendanceHistory;
    attendance.lastAttemptAt = stored.attendanceLastAttemptAt;
    attendance.backoffUntil = stored.attendanceBackoffUntil;
    attendance.nextRefreshAt = Math.max(Number(stored.attendanceLastAttemptAt || 0) + 60_000, Number(stored.attendanceBackoffUntil || 0));
    prefs = { goal: stored.attendanceGoal || "standard", plan: readPlan(stored.attendancePlan), end: String(stored.forecastEnd || "") };
    marksState = { cache: stored.marksCache, status: stored.marksStatus?.uid === savedLogin.uid ? stored.marksStatus : null };
    timetableState = { cache: stored.timetableCache, status: stored.timetableStatus?.uid === savedLogin.uid ? stored.timetableStatus : null };
    // First run starts at Login; after that, wherever the student left off.
    const start = views[stored.popupView] ? stored.popupView : hasLogin() ? "attendance" : "login";
    showView(start, { remember: false });
    setupRate(stored);
    paintRate();
  },
);
