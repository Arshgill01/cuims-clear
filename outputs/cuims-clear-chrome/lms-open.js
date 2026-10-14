// Opens CUIMS and LMS from the popup. Neither ever refuses, and neither makes
// a request of the extension's own: both are tabs in this browser's own CUIMS
// session (the background shares its cookies), the same as typing the
// address. Signed out, CUIMS's login page shows and the content script signs
// in. For LMS the tab loads CUIMS behind a cover and lms-launch.js clicks CU
// LMS there, as the student would.
//
// Earlier builds first made the LMS postback from the background. Live CUIMS
// now adds the CU LMS link to StudentHome after the page loads, so the
// background's copy of Home never had it: every Open LMS cost a wasted Home
// load right before the tab's own Home and postback, three pages in about
// three seconds, the pattern that costs an account its menu.

const CUIMS_ORIGIN = "https://students.cuchd.in";
const CUIMS_HOME = `${CUIMS_ORIGIN}/StudentHome.aspx`;
const LMS_LAUNCH_URL = `${CUIMS_HOME}#cuims-clear-lms`;
// Older builds kept a browser-wide "launch LMS" flag here; it is gone.
try {
  chrome.storage.local.remove("lmsLaunchAt");
} catch {}

function tabUrl(tab) {
  return String(tab?.pendingUrl || tab?.url || "");
}

function isCuimsTab(tab) {
  return /^https:\/\/students\.cuchd\.in\//i.test(tabUrl(tab));
}

async function focusTab(tab) {
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) {
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
  }
}

// The popup passes its own active tab: from the background, "current window"
// is only a guess.
async function resolveTab(hint) {
  if (hint?.tabId) {
    try {
      return await chrome.tabs.get(hint.tabId);
    } catch {}
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

// Always a new tab, right beside the one the popup was opened from.
async function openIn(tab, url) {
  await chrome.tabs.create({ url, active: true, ...(tab?.index >= 0 ? { index: tab.index + 1 } : {}) });
}

// The student is about to browse CUIMS in a tab: background optional pages
// keep clear of it, as they do of any page a CUIMS tab loads.
function markTabIntent() {
  try {
    chrome.storage.local.set({ tabPageAt: Date.now() });
  } catch {}
}

async function openLms(hint) {
  const lmsTabs = await chrome.tabs.query({ url: "https://lms.cuchd.in/*" });
  if (lmsTabs[0]?.id) {
    await focusTab(lmsTabs[0]);
    return { via: "existing" };
  }
  const tab = await resolveTab(hint);
  // The hash marks only this tab.
  markTabIntent();
  await openIn(tab, LMS_LAUNCH_URL);
  return { via: "page" };
}

async function openCuims(hint) {
  const tab = await resolveTab(hint);
  if (isCuimsTab(tab)) {
    await focusTab(tab);
    return { via: "existing" };
  }
  markTabIntent();
  await openIn(tab, CUIMS_HOME);
  return { via: "tab" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages (the popup). A content script's sender
  // URL is the web page it runs in.
  const fromPopup = sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  if ((message?.type === "cuims-clear:launch-lms" || message?.type === "cuims-clear:open-cuims") && fromPopup) {
    const open = message.type === "cuims-clear:launch-lms" ? openLms : openCuims;
    const keepAwake = globalThis.cuimsKeepAwake || ((work) => work());
    keepAwake(() => open({ tabId: Number(message.tabId) || 0 }))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  // A launch that needs the login form shows its tab.
  if (message?.type === "cuims-clear:lms-needs-ui" && sender.tab?.id) {
    chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
  }
});
