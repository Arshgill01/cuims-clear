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
  "attendanceLeaves",
  "attendanceCourses",
  "attendancePlan",
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

const tabs = {
  login: document.querySelector("#tab-login"),
  attendance: document.querySelector("#tab-attendance"),
  theme: document.querySelector("#tab-theme"),
};
const views = {
  login: document.querySelector("#view-login"),
  attendance: document.querySelector("#view-attendance"),
  theme: document.querySelector("#view-theme"),
};

const themeGrid = views.theme.querySelector(".theme-grid");
let currentTheme = CuimsThemes.mirrored();

const accessBanner = document.querySelector("#access-banner");
document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;

let statusTimer;
let attendance = { snapshot: null, status: null, error: "", code: "" };
// The student's goal is a preference; the skip plan lasts one campus day.
let prefs = { goal: "standard", plan: { day: "", skips: [] } };

function todayKey() {
  return CuimsAttendance.campusParts(new Date()).key;
}

function plannedSkips() {
  return prefs.plan?.day === todayKey() ? prefs.plan.skips || [] : [];
}
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
    attendance = { snapshot: null, status: null, error: "", code: "" };
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
        showStatus(type === "cuims-clear:launch-lms" ? "Could not open LMS. Try again." : "Could not open CUIMS. Try again.");
        return;
      }
      window.close();
    });
  });
}

bindOpenLink(document.querySelector(".cuims-open-link"), "cuims-clear:open-cuims", "Opening…");
bindOpenLink(document.querySelector(".lms-open-link"), "cuims-clear:launch-lms", "Opening LMS…");

function paintAttendance() {
  const status = attendance.status || {};
  const working = Boolean(status.working) && Date.now() - Number(status.at || 0) < 2 * 60 * 1000;
  const analytics = attendance.snapshot?.subjects?.length
    ? CuimsAttendance.buildAnalytics(attendance.snapshot, new Date(), { goal: prefs.goal, plan: plannedSkips() })
    : null;
  views.attendance.innerHTML = CuimsAttendance.renderAttendance(analytics, {
    working,
    phase: status.phase,
    error: working ? "" : attendance.error || status.error || "",
    code: working ? "" : attendance.code || status.code || "",
  });
  return working;
}

function fetchAttendance() {
  attendance.error = "";
  attendance.code = "";
  attendance.status = { working: true, phase: "Checking your CUIMS session…", at: Date.now() };
  paintAttendance();
  chrome.runtime.sendMessage({ type: "cuims-clear:attendance-refresh" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      attendance.status = null;
      attendance.error = "Could not reach the extension background. Try again.";
      attendance.code = "";
    } else {
      attendance.snapshot = response.snapshot || attendance.snapshot;
      attendance.error = response.error || "";
      attendance.code = response.code || "";
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
  if (name === "theme") renderThemes();
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
    const order = Object.keys(tabs);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = order[(order.indexOf(name) + step + order.length) % order.length];
    showView(next);
    tabs[next].focus();
  });
}

views.attendance.addEventListener("click", (event) => {
  if (event.target.closest("#fetch-attendance")) {
    fetchAttendance();
    return;
  }
  const goal = event.target.closest("[data-goal]");
  if (goal) {
    prefs.goal = goal.dataset.goal;
    chrome.storage.local.set({ attendanceGoal: prefs.goal });
    paintAttendance();
    views.attendance.querySelector(`[data-goal="${prefs.goal}"]`)?.focus();
    return;
  }
  const row = event.target.closest("[data-plan-key]");
  if (row) {
    const key = row.dataset.planKey;
    const skips = new Set(plannedSkips());
    if (skips.has(key)) skips.delete(key);
    else skips.add(key);
    prefs.plan = { day: todayKey(), skips: [...skips] };
    chrome.storage.local.set({ attendancePlan: prefs.plan });
    paintAttendance();
    views.attendance.querySelector(`[data-plan-key="${CSS.escape(key)}"]`)?.focus();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // Opening CUIMS or LMS may sign in first; say so on the button.
  const phase = changes.attendanceStatus?.newValue?.working && changes.attendanceStatus.newValue.phase;
  const busy = document.querySelector(".open-link[aria-busy='true'] span");
  if (phase && busy) busy.textContent = phase;
  if (changes.attendanceSnapshot) attendance.snapshot = changes.attendanceSnapshot.newValue || null;
  if (changes.attendanceStatus) {
    attendance.status = changes.attendanceStatus.newValue || null;
    attendance.error = "";
    attendance.code = "";
  }
  if ((changes.attendanceSnapshot || changes.attendanceStatus) && !views.attendance.hidden) paintAttendance();
});

chrome.storage.local.get({ attendanceSnapshot: null, attendanceStatus: null, popupView: "login", attendanceGoal: "standard", attendancePlan: null }, (stored) => {
  attendance.snapshot = stored.attendanceSnapshot;
  attendance.status = stored.attendanceStatus;
  prefs = { goal: stored.attendanceGoal || "standard", plan: stored.attendancePlan || { day: "", skips: [] } };
  if (stored.popupView === "attendance" || stored.popupView === "theme") showView(stored.popupView);
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

// ---- themes ----

// Each card previews its theme with that theme's own colours.
function themeCard(entry) {
  const t = CuimsThemes.tokens(entry.id);
  const vars = {
    "--p-canvas": t.canvas, "--p-surface": t.surface, "--p-ink": t.ink, "--p-line": t.line, "--p-accent": t.accent,
    "--p-good": t.good, "--p-track": t.track, "--p-brand-bg": t.brandBg, "--p-brand-ink": t.brandInk,
  };
  const style = Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";");
  const dots = [t.goodInk, t.warnInk, t.badInk].map((color) => `<span style="background:${color}"></span>`).join("");
  return `<li><button type="button" class="theme-card" role="radio" data-theme-id="${entry.id}" aria-checked="${entry.id === currentTheme}" style="${style}">
    <span class="theme-preview" aria-hidden="true">
      <span class="theme-preview-top"><span class="theme-preview-mark">//</span><span class="theme-preview-accent"></span></span>
      <span class="theme-preview-card"><span class="theme-preview-line"></span><span class="theme-preview-meter"><span></span></span><span class="theme-preview-dots">${dots}</span></span>
    </span>
    <span class="theme-label"><span class="theme-name">${CuimsAttendance.escapeHtml(entry.name)}</span><span class="theme-mode">${entry.scheme === "dark" ? "Dark" : "Light"}</span></span>
  </button></li>`;
}

function renderThemes() {
  themeGrid.innerHTML = CuimsThemes.list.map(themeCard).join("");
}

function useTheme(id) {
  currentTheme = CuimsThemes.valid(id);
  CuimsThemes.applyToPopup(document.documentElement, currentTheme);
  if (!views.theme.hidden) {
    for (const card of themeGrid.querySelectorAll("[data-theme-id]")) card.setAttribute("aria-checked", String(card.dataset.themeId === currentTheme));
  }
}

themeGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-theme-id]");
  if (!card) return;
  useTheme(card.dataset.themeId);
  CuimsThemes.save(currentTheme);
});

// Arrow keys move through the cards like a radio group.
themeGrid.addEventListener("keydown", (event) => {
  const keys = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 };
  if (!(event.key in keys)) return;
  const cards = [...themeGrid.querySelectorAll("[data-theme-id]")];
  const index = cards.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = cards[Math.max(0, Math.min(cards.length - 1, index + keys[event.key]))];
  next.focus();
  next.click();
});

CuimsThemes.load().then(useTheme);
CuimsThemes.onChange(useTheme);

// Restyling CUIMS itself can be switched off on its own.
const themeCuims = document.querySelector("#theme-cuims");
chrome.storage.local.get({ themeCuims: true }, (stored) => {
  themeCuims.checked = stored.themeCuims !== false;
});
themeCuims.addEventListener("change", () => chrome.storage.local.set({ themeCuims: themeCuims.checked }));
