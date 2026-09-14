const CUIMS_HOME = "https://students.cuchd.in/StudentHome.aspx";
const LAUNCH_AT = "lmsLaunchAt";
const FOCUS_MS = 2 * 60 * 1000;
const watched = new Set();

function fresh(value, ms) {
  const at = Number(value);
  return Boolean(at && Date.now() - at <= ms);
}

function isHome(url) {
  return /StudentHome\.aspx/i.test(url || "");
}

async function focusTab(tab) {
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  }
}

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

async function askTabToLaunch(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: "cuims-clear:launch-lms" });
}

async function launchInTab(tab) {
  watched.add(tab.id);
  try {
    await askTabToLaunch(tab.id);
    return true;
  } catch {
    try {
      await chrome.tabs.reload(tab.id);
      return true;
    } catch {
      return false;
    }
  }
}

async function openBackgroundHome() {
  const created = await chrome.tabs.create({ url: CUIMS_HOME, active: false });
  if (created?.id) watched.add(created.id);
}

async function requestLmsLaunch() {
  await chrome.storage.local.set({ [LAUNCH_AT]: Date.now() });
  const lmsTabs = await chrome.tabs.query({ url: "https://lms.cuchd.in/*" });
  if (lmsTabs[0]?.id) {
    await focusTab(lmsTabs[0]);
    return;
  }

  const cuimsTabs = await chrome.tabs.query({ url: "https://students.cuchd.in/*" });
  const active = await activeTab();
  const hiddenHome = cuimsTabs.find((tab) => (isHome(tab.url) || !tab.url) && tab.id !== active?.id);
  if (hiddenHome?.id && await launchInTab(hiddenHome)) return;

  const hiddenCuims = cuimsTabs.find((tab) => tab.id !== active?.id);
  if (hiddenCuims?.id) {
    watched.add(hiddenCuims.id);
    await chrome.tabs.update(hiddenCuims.id, { url: CUIMS_HOME, active: false });
    return;
  }

  await openBackgroundHome();
}

async function revealLms(tabId, windowId) {
  watched.delete(tabId);
  await chrome.storage.local.remove(LAUNCH_AT);
  await chrome.tabs.update(tabId, { active: true });
  if (windowId) {
    try { await chrome.windows.update(windowId, { focused: true }); } catch {}
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "cuims-clear:launch-lms") {
    requestLmsLaunch()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "cuims-clear:lms-needs-ui" && sender.tab?.id) {
    chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = tab.url || info.url || "";
  if (!url.startsWith("https://lms.cuchd.in/")) return;
  if (watched.has(tabId)) {
    await revealLms(tabId, tab.windowId);
    return;
  }
  const { [LAUNCH_AT]: at } = await chrome.storage.local.get({ [LAUNCH_AT]: 0 });
  if (fresh(at, FOCUS_MS)) await revealLms(tabId, tab.windowId);
});
