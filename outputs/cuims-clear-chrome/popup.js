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
  "attendanceDateSheet",
  "attendanceOwner",
];
// Opening Attendance or Forecast reads CUIMS by itself, once per popup, when
// the last read is this old. A read is the cookie-less report calls, which
// CUIMS answers freely; any page it needs is spaced by the background.
const STALE_MS = 2 * 60 * 1000;
// Refresh comes back this long after the last read (the background's
// MANUAL_GAP_MS), or when CUIMS's own pushback ends.
const REFRESH_GAP_MS = 30 * 1000;
let autoRead = false;
// With no timetable saved, the background says when it can read one
// (snapshot.timetableDueAt, a minute after the attendance page); the popup
// reads again then, once, if it is still open or opened later.
const TIMETABLE_WAIT_MAX_MS = 10 * 60 * 1000;
let timetableRead = false;
let timetableTimer;
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
  login: document.querySelector("#tab-login"),
  theme: document.querySelector("#tab-theme"),
  settings: document.querySelector("#tab-settings"),
};
const views = {
  attendance: document.querySelector("#view-attendance"),
  forecast: document.querySelector("#view-forecast"),
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
let prefs = { goal: "standard", plan: [], end: "", calendar: "auto" };
// Which day the planner shows and which subject is open, for this popup only.
let lastForecast = null;
let forecastUi = { day: "", expanded: "", calendar: { open: false, month: "", focus: "" } };
// "", "ask" or "confirm", decided once per popup open (rate-nudge.js).
let rateShow = "";

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
  chrome.storage.local.set(next, () => {
    savedLogin = next;
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
    savedLogin = { uid: "", password: "" };
    uid.value = "";
    password.value = "";
    password.type = "password";
    togglePassword.textContent = "Show";
    togglePassword.setAttribute("aria-label", "Show password");
    syncLoginState();
    paintData();
    showStatus("Saved login and attendance cleared");
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

// The browser may have stopped the background, or be starting it again; a
// second try reaches the fresh one. `done` gets null when both failed.
function askBackground(message, done, tries = 2) {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError && tries > 1) {
      setTimeout(() => askBackground(message, done, tries - 1), 400);
      return;
    }
    done(chrome.runtime.lastError ? null : response);
  });
}

// Without the background the tab still opens: CUIMS's own page signs in (the
// content script fills it), and its LMS link is clicked by lms-launch.js.
const OPEN_DIRECT = {
  "cuims-clear:open-cuims": "https://students.cuchd.in/StudentHome.aspx",
  "cuims-clear:launch-lms": "https://students.cuchd.in/StudentHome.aspx#cuims-clear-lms",
};

async function openDirect(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.create({ url: OPEN_DIRECT[type], active: true, ...(tab?.index >= 0 ? { index: tab.index + 1 } : {}) });
    return true;
  } catch {
    return false;
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
    askBackground({ type, tabId: await activeTabId() }, async (response) => {
      if (!response && (await openDirect(type))) {
        window.close();
        return;
      }
      if (!response || response.error) {
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

// ---- diagnostics ----

// The local request log (attendance-daemon.js, content.js) and the clocks
// that decide when the background may load a CUIMS page, as text the student
// can paste into a report. Paths and times only: no UID, password, report ids
// or attendance.
const copyDiagnostics = document.querySelector("#copy-diagnostics");
let diagTimer;
copyDiagnostics?.addEventListener("click", () => {
  const clocks = ["pagesPausedUntil", "pagesPausedAt", "tabLimitedAt", "tabMenuOkAt", "tabPageAt", "attendancePageAt", "sessionCheckedAt", "attendanceBackoffUntil", "attendanceLastAttemptAt", "bgSignInOkAt"];
  chrome.storage.local.get({ cuimsJournal: [], pagesPauseStreak: 0, sessionAlive: false, attendanceFailStreak: 0, attendanceStatus: null, ...Object.fromEntries(clocks.map((key) => [key, 0])) }, async (stored) => {
    const time = (value) => (Number(value) > 0 ? new Date(Number(value)).toISOString() : "");
    const report = {
      version: chrome.runtime.getManifest().version,
      browser: navigator.userAgent,
      copiedAt: new Date().toISOString(),
      state: {
        ...Object.fromEntries(clocks.map((key) => [key, time(stored[key])])),
        pagesPauseStreak: stored.pagesPauseStreak,
        sessionAlive: stored.sessionAlive,
        failStreak: stored.attendanceFailStreak,
        status: stored.attendanceStatus?.code || "",
      },
      log: (Array.isArray(stored.cuimsJournal) ? stored.cuimsJournal : []).map((entry) => ({ ...entry, at: time(entry.at) })),
    };
    const text = JSON.stringify(report, null, 1);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch {}
      area.remove();
    }
    copyDiagnostics.textContent = copied ? "Copied" : "Could not copy";
    window.clearTimeout(diagTimer);
    diagTimer = window.setTimeout(() => (copyDiagnostics.textContent = "Copy"), 2500);
  });
});

// ---- attendance ----

// The attendance view is redrawn from scratch (every 30 s, and on every
// background update), so keyboard focus is carried over by what it points at.
function focusKey(node, view = views.attendance) {
  if (!node || node === view || !view.contains?.(node)) return "";
  if (node.id) return `#${CSS.escape(node.id)}`;
  for (const name of ["planKey", "planDay", "planClear", "planWhole", "goal", "goto", "subject", "endStep", "endReset", "calToggle", "calDay", "calMonth", "calClose", "action", "chart"]) {
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
  scheduleTimetableRead();
}

function scheduleTimetableRead() {
  window.clearTimeout(timetableTimer);
  const snapshot = attendance.snapshot;
  const dueAt = Number(snapshot?.timetableDueAt || 0);
  if (timetableRead || !dueAt || snapshot.slots?.length || readWorking()) return;
  if (currentView !== "attendance" && currentView !== "forecast") return;
  const wait = Math.max(dueAt + 1000, Number(attendance.nextRefreshAt || 0)) - Date.now();
  if (wait > TIMETABLE_WAIT_MAX_MS) return;
  timetableTimer = window.setTimeout(() => {
    if (timetableRead || readWorking()) return;
    timetableRead = true;
    fetchAttendance();
  }, Math.max(0, wait));
}

function refreshAt(lastAttemptAt, backoffUntil) {
  return Math.max(Number(lastAttemptAt || 0) + REFRESH_GAP_MS, Number(backoffUntil || 0));
}

function readWorking() {
  const status = attendance.status || {};
  return Boolean(status.working) && Date.now() - Number(status.at || 0) < 2 * 60 * 1000;
}

// Redraws a view and puts keyboard focus back on what it pointed at.
// A redraw is invisible: the same markup is left alone, and otherwise the
// scroll position, open <details> and focus survive it. Focus never scrolls,
// so a control coming back (Refresh after its wait) cannot pull the view up.
const painted = new WeakMap();

// The section being read: the first of the view's own blocks still on screen,
// named by its tag and first class, and how far it sits from the top. After
// a redraw the same block goes back to the same place, even when a message
// above it came or went.
function scrollAnchor(view) {
  if (!viewport || view.hidden || !viewport.getBoundingClientRect) return null;
  const top = viewport.getBoundingClientRect().top;
  for (const node of view.children || []) {
    const box = node.getBoundingClientRect();
    if (box.bottom > top + 1) return { name: anchorName(node), offset: box.top - top, scroll: viewport.scrollTop };
  }
  return { name: "", offset: 0, scroll: viewport.scrollTop };
}

// Cards share classes; their labels tell them apart.
function anchorName(node) {
  return `${node.tagName}|${node.getAttribute?.("aria-label") || (typeof node.className === "string" ? node.className : "")}`;
}

function restoreAnchor(view, anchor) {
  if (!anchor || view.hidden) return;
  viewport.scrollTop = anchor.scroll;
  const node = anchor.name && [...view.children].find((child) => anchorName(child) === anchor.name);
  if (!node) return;
  viewport.scrollTop += node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
}

function repaint(view, html) {
  if (painted.get(view) === html) return;
  const active = document.activeElement;
  const key = focusKey(active, view) || (active === view || active === document.body ? carriedFocus : "");
  const open = [...(view.querySelectorAll?.("details[data-keep][open]") || [])].map((node) => node.dataset.keep);
  const anchor = scrollAnchor(view);
  view.innerHTML = html;
  painted.set(view, html);
  for (const name of open) view.querySelector(`details[data-keep="${name}"]`)?.setAttribute("open", "");
  restoreAnchor(view, anchor);
  carriedFocus = "";
  const target = key ? view.querySelector(key) : null;
  if (target?.disabled) {
    carriedFocus = key;
    view.focus({ preventScroll: true });
  } else target?.focus({ preventScroll: true });
}

// Settings → Academic calendar: "auto" picks UIC's for a BCA/MCA UID.
function calendarId() {
  return CuimsAttendance.calendarFor?.(prefs.calendar, savedLogin.uid) || "cu";
}

const calendarSelect = document.querySelector("#academic-calendar");
calendarSelect?.addEventListener("change", () => {
  prefs.calendar = calendarSelect.value;
  chrome.storage.local.set({ academicCalendar: prefs.calendar });
  paintAttendance();
  paintForecast();
});

function paintAttendance() {
  const status = attendance.status || {};
  const working = readWorking();
  const analytics = attendance.snapshot?.subjects?.length
    ? CuimsAttendance.buildAnalytics(attendance.snapshot, new Date(), { goal: prefs.goal, calendar: calendarId() })
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
    ? CuimsAttendance.buildForecast(attendance.snapshot, attendance.history, new Date(), { goal: prefs.goal, calendar: calendarId(), plan: plannedSkips(), end: prefs.end, day: forecastUi.day })
    : null;
  lastForecast = forecast;
  if (forecast?.plan) forecastUi.day = forecast.plan.day;
  repaint(views.forecast, CuimsAttendance.renderForecast(forecast, {
    working,
    phase: status.phase,
    expanded: forecastUi.expanded,
    calendar: forecastUi.calendar,
    nextRefreshAt: attendance.nextRefreshAt,
    timetableDueAt: Number(attendance.snapshot?.timetableDueAt || 0),
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
  askBackground({ type: "cuims-clear:attendance-refresh" }, (response) => {
    if (!response) {
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
  window.clearTimeout(timetableTimer);
  paintRate();
  if (name === "theme") renderThemes();
  if (name !== "attendance" && name !== "forecast") return;
  // A normal read is the report calls alone, outside CUIMS's page limit; the
  // background spaces out any page it needs (attendance-daemon.js).
  const working = paintData();
  const fetchedAt = Date.parse(attendance.snapshot?.fetchedAt || "") || 0;
  if (!autoRead && !working && Date.now() - fetchedAt > STALE_MS) {
    autoRead = true;
    fetchAttendance();
  }
  repaintTimer = window.setInterval(() => (currentView === "forecast" ? paintForecast({ force: false }) : paintAttendance()), 30_000);
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
    views.attendance.querySelector(`[data-goal="${prefs.goal}"]`)?.focus({ preventScroll: true });
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
  const focusAfter = (selector) => views.forecast.querySelector(selector)?.focus({ preventScroll: true });
  if (calendarClick(target)) return;
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
    const current = prefs.end || paintedEnd();
    const days = Number(step.dataset.endStep);
    let next = shiftDay(current, days);
    // CU's last day can be behind us (classes over): a week later starts
    // no earlier than today.
    if (next && days > 0 && next < todayKey()) next = todayKey();
    if (next && next >= todayKey()) setEnd(next);
    // Back past today, when CU's own day is already behind us: CU's day.
    else if (next && days < 0 && prefs.end && (lastForecast?.end?.estimate || "") < todayKey()) setEnd("");
    paintForecast();
    focusAfter(`[data-end-step="${step.dataset.endStep}"]`);
    return;
  }
  if (target.closest("[data-end-reset]")) {
    setEnd("");
    openCalendar(false);
    paintForecast();
    focusAfter("[data-end-step='7']");
  }
});

// ---- the last-day calendar ----

function openCalendar(open, focus = "") {
  forecastUi.calendar = { open, month: focus.slice(0, 7), focus };
}

function shiftMonth(month, by) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarClick(target) {
  const focus = (selector) => views.forecast.querySelector(selector)?.focus({ preventScroll: true });
  if (target.closest("[data-cal-toggle]")) {
    openCalendar(!forecastUi.calendar.open, paintedEnd());
    paintForecast();
    if (forecastUi.calendar.open) {
      views.forecast.querySelector(".fc-cal")?.scrollIntoView({ block: "nearest" });
      focus(".fc-cal-day[tabindex='0']");
    } else focus("[data-cal-toggle]");
    return true;
  }
  const move = target.closest("[data-cal-month]");
  if (move) {
    const month = shiftMonth(forecastUi.calendar.month || paintedEnd().slice(0, 7), Number(move.dataset.calMonth));
    forecastUi.calendar = { open: true, month, focus: "" };
    paintForecast();
    // At the earliest month the back button is disabled; focus goes to the days.
    const again = views.forecast.querySelector(`[data-cal-month="${move.dataset.calMonth}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
    else focus(".fc-cal-day[tabindex='0']");
    return true;
  }
  const day = target.closest("[data-cal-day]");
  if (day && !day.disabled) {
    setEnd(day.dataset.calDay);
    openCalendar(false);
    paintForecast();
    focus("[data-cal-toggle]");
    return true;
  }
  if (target.closest("[data-cal-close]")) {
    openCalendar(false);
    paintForecast();
    focus("[data-cal-toggle]");
    return true;
  }
  return false;
}

// The last day as drawn, for the calendar's starting month.
function paintedEnd() {
  return lastForecast?.end?.key || todayKey();
}

// Arrow keys walk the days, Page Up and Down the months, Esc closes.
views.forecast.addEventListener("keydown", (event) => {
  if (!event.target.closest?.(".fc-cal")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    openCalendar(false);
    paintForecast();
    views.forecast.querySelector("[data-cal-toggle]")?.focus({ preventScroll: true });
    return;
  }
  const day = event.target.closest("[data-cal-day]");
  const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (!day || !(event.key in steps || event.key === "PageUp" || event.key === "PageDown")) return;
  event.preventDefault();
  let next;
  if (event.key in steps) next = shiftDay(day.dataset.calDay, steps[event.key]);
  else {
    const month = shiftMonth(day.dataset.calDay.slice(0, 7), event.key === "PageUp" ? -1 : 1);
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    next = `${month}-${String(Math.min(Number(day.dataset.calDay.slice(8)), days)).padStart(2, "0")}`;
  }
  if (!next || next < todayKey()) return;
  forecastUi.calendar = { open: true, month: next.slice(0, 7), focus: next };
  paintForecast();
  views.forecast.querySelector(`[data-cal-day="${next}"]`)?.focus({ preventScroll: true });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.attendanceLastAttemptAt) attendance.lastAttemptAt = changes.attendanceLastAttemptAt.newValue || 0;
  if (changes.attendanceBackoffUntil) attendance.backoffUntil = changes.attendanceBackoffUntil.newValue || 0;
  if (changes.attendanceLastAttemptAt || changes.attendanceBackoffUntil) attendance.nextRefreshAt = refreshAt(attendance.lastAttemptAt, attendance.backoffUntil);
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
  // One notice at a time: an update or its news comes first.
  rateNudge.hidden = !(rateShow && currentView === "attendance" && attendance.snapshot?.subjects?.length && !readFailed() && !updateShowing());
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

// ---- updates ----

// A newer version at the top; after an update, what changed. Chrome installs
// it from here; Firefox installs add-ons only from a page the student clicks
// on, so Update now opens CUIMS, where update-bar.js has the link.
const updateBanner = document.querySelector("#update-banner");
const updateNews = document.querySelector("#update-news");
const updateNow = document.querySelector("#update-now");
const updateCheckButton = document.querySelector("#update-check");
const currentVersion = chrome.runtime.getManifest().version;
const onFirefox = globalThis.location?.protocol === "moz-extension:";
let updateInfo = null;
let updateDone = null;

function updateShowing() {
  return Boolean(updateBanner && !updateBanner.hidden) || Boolean(updateNews && !updateNews.hidden);
}

function paintUpdate() {
  const U = globalThis.CuimsUpdate;
  if (!U) return;
  const info = U.normalize(updateInfo);
  const out = U.available(info, currentVersion);
  if (updateBanner) {
    updateBanner.hidden = !out;
    document.querySelector("#update-title").textContent = `Version ${info.latest} is out.`;
    document.querySelector("#update-note").textContent = onFirefox ? "Opens CUIMS, where Firefox asks twice: Allow, then Add." : info.ready ? "Downloaded. It takes a second." : "";
  }
  const news = out ? null : U.news(updateDone, currentVersion, Date.now());
  if (updateNews) {
    updateNews.hidden = !news;
    if (news) {
      document.querySelector("#update-news-title").textContent = `Updated to ${news.to}`;
      document.querySelector("#update-news-list").innerHTML = news.notes.map((line) => `<li>${CuimsAttendance.escapeHtml(line)}</li>`).join("");
    }
  }
  document.querySelector("#update-version").textContent = `Version ${currentVersion}`;
  const state = document.querySelector("#update-state");
  if (state) {
    const when = U.ago(info.checkedAt, Date.now());
    state.textContent = out
      ? `${info.latest} is out.`
      : info.error
        ? "Couldn't reach the store. Try again later."
        : when
          ? `Up to date. Checked ${when}.`
          : "Not checked yet.";
  }
  paintRate();
}

function askUpdate(message, done) {
  askBackground(message, (answer) => {
    if (answer && !answer.error && "latest" in answer) updateInfo = answer;
    paintUpdate();
    done?.(answer);
  });
}

updateNow?.addEventListener("click", async () => {
  if (updateNow.disabled) return;
  if (onFirefox) {
    const U = globalThis.CuimsUpdate;
    try {
      // The bar shows on CUIMS even if × hid it today.
      await chrome.storage.local.set({ updateSnoozeUntil: 0 });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.create({ url: U.UPDATE_PAGE, active: true, ...(tab?.index >= 0 ? { index: tab.index + 1 } : {}) });
      window.close();
    } catch {
      showStatus("Could not open CUIMS. Try again.");
    }
    return;
  }
  updateNow.disabled = true;
  updateNow.textContent = "Updating…";
  askBackground({ type: "cuims-clear:update-apply" }, (answer) => {
    // On "restarting" the extension reloads and this popup closes.
    if (answer?.status === "restarting") {
      updateNow.textContent = "Restarting…";
      return;
    }
    updateNow.disabled = false;
    updateNow.textContent = "Update now";
    const status = answer?.status;
    showStatus(
      status === "no_update" ? "Chrome hasn't got it yet. It updates by itself soon."
      : status === "downloading" ? "Still downloading. Try again in a minute."
      : status === "throttled" ? "Chrome asked to wait. Try again in a few minutes."
      : "Couldn't update. Try again in a minute.",
    );
    chrome.storage.local.get({ updateInfo: null }, (stored) => {
      updateInfo = stored.updateInfo;
      paintUpdate();
    });
  });
});

updateCheckButton?.addEventListener("click", () => {
  if (updateCheckButton.disabled) return;
  updateCheckButton.disabled = true;
  updateCheckButton.textContent = "Checking…";
  askUpdate({ type: "cuims-clear:update-status", check: true, manual: true }, (answer) => {
    updateCheckButton.disabled = false;
    updateCheckButton.textContent = "Check now";
    if (!answer || answer.error) showStatus("Couldn't reach the store.");
    else if (answer.available) showStatus(`Version ${answer.latest} is out.`);
    else showStatus("You're on the latest version.");
  });
});

document.querySelector("#update-news-done")?.addEventListener("click", () => {
  updateDone = { ...(updateDone || {}), seen: true };
  chrome.storage.local.set({ updateDone });
  paintUpdate();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.updateInfo || changes.updateDone)) return;
  if (changes.updateInfo) updateInfo = changes.updateInfo.newValue || null;
  if (changes.updateDone) updateDone = changes.updateDone.newValue || null;
  paintUpdate();
});

function setupUpdate(stored) {
  updateInfo = stored.updateInfo;
  updateDone = stored.updateDone;
  paintUpdate();
  // At most every six hours on its own (update-check.js).
  askUpdate({ type: "cuims-clear:update-status", check: true });
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
    academicCalendar: "auto",
    rateNudge: null,
    updateInfo: null,
    updateDone: null,
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
    attendance.nextRefreshAt = refreshAt(stored.attendanceLastAttemptAt, stored.attendanceBackoffUntil);
    prefs = { goal: stored.attendanceGoal || "standard", plan: readPlan(stored.attendancePlan), end: String(stored.forecastEnd || ""), calendar: String(stored.academicCalendar || "auto") };
    if (calendarSelect) calendarSelect.value = prefs.calendar;
    // First run starts at Login; after that, wherever the student left off.
    const start = views[stored.popupView] ? stored.popupView : hasLogin() ? "attendance" : "login";
    showView(start, { remember: false });
    setupRate(stored);
    setupUpdate(stored);
    paintRate();
  },
);
