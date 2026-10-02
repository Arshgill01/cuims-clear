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
  login: document.querySelector("#tab-login"),
  theme: document.querySelector("#tab-theme"),
  settings: document.querySelector("#tab-settings"),
};
const views = {
  attendance: document.querySelector("#view-attendance"),
  login: document.querySelector("#view-login"),
  theme: document.querySelector("#view-theme"),
  settings: document.querySelector("#view-settings"),
};

const themeGroups = document.querySelector("#theme-groups");
let currentTheme = CuimsThemes.mirrored();

const accessBanner = document.querySelector("#access-banner");
document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;

let statusTimer;
let confirmTimer;
let repaintTimer;
let currentView = "";
let settings = { ...SWITCH_DEFAULTS };
let savedLogin = { uid: "", password: "" };
let attendance = { snapshot: null, status: null, error: "", code: "" };
// The student's goal is a preference; the skip plan lasts one campus day.
let prefs = { goal: "standard", plan: { day: "", skips: [] } };

function todayKey() {
  return CuimsAttendance.campusParts(new Date()).key;
}

function plannedSkips() {
  return prefs.plan?.day === todayKey() ? prefs.plan.skips || [] : [];
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
    if (!views.attendance.hidden) paintAttendance();
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
    attendance = { snapshot: null, status: null, error: "", code: "" };
    savedLogin = { uid: "", password: "" };
    uid.value = "";
    password.value = "";
    password.type = "password";
    togglePassword.textContent = "Show";
    togglePassword.setAttribute("aria-label", "Show password");
    syncLoginState();
    if (!views.attendance.hidden) paintAttendance();
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

// ---- attendance ----

// The attendance view is redrawn from scratch (every 30 s, and on every
// background update), so keyboard focus is carried over by what it points at.
function focusKey(node) {
  if (!node || node === views.attendance || !views.attendance.contains?.(node)) return "";
  if (node.id) return `#${CSS.escape(node.id)}`;
  for (const name of ["planKey", "goal", "goto"]) {
    const value = node.dataset?.[name];
    if (value) return `[data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value)}"]`;
  }
  return "";
}

// A control redrawn disabled (Refresh while refreshing) cannot hold focus;
// its key is kept and focus goes back to it once it is enabled again.
let carriedFocus = "";

function paintAttendance() {
  const active = document.activeElement;
  const key = focusKey(active) || (active === views.attendance || active === document.body ? carriedFocus : "");
  const status = attendance.status || {};
  const working = Boolean(status.working) && Date.now() - Number(status.at || 0) < 2 * 60 * 1000;
  const analytics = attendance.snapshot?.subjects?.length
    ? CuimsAttendance.buildAnalytics(attendance.snapshot, new Date(), { goal: prefs.goal, plan: plannedSkips() })
    : null;
  views.attendance.innerHTML = CuimsAttendance.renderAttendance(analytics, {
    working,
    phase: status.phase,
    needsLogin: !hasLogin(),
    error: working ? "" : attendance.error || status.error || "",
    code: working ? "" : attendance.code || status.code || "",
  });
  carriedFocus = "";
  const target = key ? views.attendance.querySelector(key) : null;
  if (target?.disabled) {
    carriedFocus = key;
    views.attendance.focus({ preventScroll: true });
  } else target?.focus();
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
  if (name === "theme") renderThemes();
  if (name !== "attendance") return;
  const working = paintAttendance();
  repaintTimer = window.setInterval(paintAttendance, 30_000);
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
    popupView: "",
    attendanceGoal: "standard",
    attendancePlan: null,
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
    prefs = { goal: stored.attendanceGoal || "standard", plan: stored.attendancePlan || { day: "", skips: [] } };
    // First run starts at Login; after that, wherever the student left off.
    const start = views[stored.popupView] ? stored.popupView : hasLogin() ? "attendance" : "login";
    showView(start, { remember: false });
  },
);
