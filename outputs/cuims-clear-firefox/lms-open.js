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

async function askTabToLaunch(tabId) {
  await chrome.tabs.sendMessage(tabId, { type: "cuims-clear:launch-lms" });
}

async function launchInTab(tab) {
  watched.add(tab.id);
  await focusTab(tab);
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

async function requestLmsLaunch() {
  await chrome.storage.local.set({ [LAUNCH_AT]: Date.now() });
  const lmsTabs = await chrome.tabs.query({ url: "https://lms.cuchd.in/*" });
  if (lmsTabs[0]?.id) {
    await focusTab(lmsTabs[0]);
    return;
  }
  const cuimsTabs = await chrome.tabs.query({ url: "https://students.cuchd.in/*" });
  const home = cuimsTabs.find((tab) => isHome(tab.url)) || cuimsTabs[0];
  if (home?.id) {
    if (isHome(home.url) || !home.url) {
      if (await launchInTab(home)) return;
    }
    watched.add(home.id);
    await chrome.tabs.update(home.id, { url: CUIMS_HOME, active: true });
    return;
  }
  const created = await chrome.tabs.create({ url: CUIMS_HOME, active: true });
  if (created?.id) watched.add(created.id);
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
