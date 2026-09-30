// Opens CUIMS and LMS from the popup.
// LMS is reached through CUIMS's own SSO postback. The background makes that
// postback itself when the CUIMS session is alive, so the tab goes straight to
// LMS without painting CUIMS. Otherwise the tab loads CUIMS behind a cover and
// lms-launch.js clicks the SSO control there (signing in first if needed).

const CUIMS_ORIGIN = "https://students.cuchd.in";
const CUIMS_HOME = `${CUIMS_ORIGIN}/StudentHome.aspx`;
const LMS_LAUNCH_URL = `${CUIMS_HOME}#cuims-clear-lms`;
// Older builds kept a browser-wide "launch LMS" flag here; it is gone.
try {
  chrome.storage.local.remove("lmsLaunchAt");
} catch {}
const SSO_TIMEOUT_MS = 8_000;
const SESSION_TIMEOUT_MS = 30_000;

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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function lmsTarget(value) {
  try {
    const url = new URL(String(value || ""), CUIMS_HOME);
    if (url.origin !== "https://lms.cuchd.in" || url.pathname === "/" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function hiddenInputs(html) {
  const fields = new URLSearchParams();
  for (const [tag] of String(html).matchAll(/<input\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']?hidden/i.test(tag)) continue;
    const name = tag.match(/\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/i);
    if (!name) continue;
    const value = tag.match(/\bvalue\s*=\s*"([^"]*)"|\bvalue\s*=\s*'([^']*)'/i);
    fields.set(decodeHtml(name[1] ?? name[2]), decodeHtml(value ? value[1] ?? value[2] : ""));
  }
  return fields;
}

// The SSO control is a LinkButton: __doPostBack('ctl00$...$lbtnLMSSSO','').
function ssoPostback(html) {
  const text = decodeHtml(html);
  const byId = text.match(/<a\b[^>]*\bid\s*=\s*["'][^"']*lbtnLMSSSO["'][^>]*>/i)?.[0] || "";
  const call = /__doPostBack\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i;
  const own = byId.match(call);
  if (own) return { target: own[1], argument: own[2] };
  const named = text.match(/__doPostBack\(\s*['"]([^'"]*LMSSSO[^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*\)/i);
  return named ? { target: named[1], argument: named[2] } : null;
}

// The postback answers with a page that calls window.open(<LMS ticket URL>).
function ssoTicketUrl(html) {
  const call = String(html).match(/window\.open\(\s*(['"])(.*?)\1/i);
  if (!call) return null;
  const raw = decodeHtml(call[2]).replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  return lmsTarget(raw);
}

async function cuimsFetch(url, options = {}) {
  return fetch(url, {
    credentials: "include",
    cache: "no-store",
    // A signed-out answer is a redirect to the login page. Loading that page
    // would replace the captcha of any CUIMS tab mid-login, so never follow.
    redirect: "manual",
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(SSO_TIMEOUT_MS) : undefined,
    ...options,
  });
}

function answered(response) {
  return response && response.type !== "opaqueredirect" && response.status === 200;
}

const LMS_COURSES = "https://lms.cuchd.in/my/courses.php";

function isLmsSignedInUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://lms.cuchd.in" && !/^\/login\//i.test(url.pathname);
  } catch {
    return false;
  }
}

// Makes CUIMS's own CU LMS postback from the background. CUIMS answers with a
// redirect chain that ends on LMS with a fresh LMS session, and the background
// shares the browser's cookie jar, so the tab can open LMS directly. Older
// CUIMS builds answered with a page calling window.open(<ticket>) instead.
// Returns the URL for the tab, or null when the tab has to do it.
async function fetchLmsTicket() {
  try {
    const home = await cuimsFetch(CUIMS_HOME);
    if (!answered(home)) return null;
    const html = await home.text();
    const postback = ssoPostback(html);
    if (!postback) return null;
    const fields = hiddenInputs(html);
    fields.set("__EVENTTARGET", postback.target);
    fields.set("__EVENTARGUMENT", postback.argument);
    const action = decodeHtml(html.match(/<form\b[^>]*\baction\s*=\s*["']([^"']*)["']/i)?.[1] || "");
    // Follow this one: the chain leads to LMS, not to a CUIMS login page,
    // because the session was just seen alive.
    const posted = await cuimsFetch(new URL(action || CUIMS_HOME, CUIMS_HOME).href, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: fields.toString(),
      redirect: "follow",
    });
    if (isLmsSignedInUrl(posted.url)) return LMS_COURSES;
    if (posted.status !== 200) return null;
    return ssoTicketUrl(await posted.text());
  } catch {
    return null;
  }
}

// Signs this browser in to CUIMS from the background when the session is
// dead (see attendance-daemon.js), so the tab never shows the login page.
async function ensureSession() {
  if (typeof globalThis.cuimsEnsureSession !== "function") return { alive: false };
  let timer;
  try {
    return await Promise.race([
      globalThis.cuimsEnsureSession(),
      new Promise((resolve) => (timer = setTimeout(() => resolve({ alive: false, reason: "timeout" }), SESSION_TIMEOUT_MS))),
    ]);
  } catch {
    return { alive: false };
  } finally {
    clearTimeout(timer);
  }
}

async function openLms(hint) {
  const lmsTabs = await chrome.tabs.query({ url: "https://lms.cuchd.in/*" });
  if (lmsTabs[0]?.id) {
    await focusTab(lmsTabs[0]);
    return { via: "existing" };
  }
  const tab = await resolveTab(hint);
  let ticket = await fetchLmsTicket();
  if (!ticket && (await ensureSession()).signedIn) ticket = await fetchLmsTicket();
  if (ticket) {
    await openIn(tab, ticket);
    return { via: "sso" };
  }
  // Signed out, or CUIMS answered differently: let the page do it. The hash
  // marks only this tab.
  await openIn(tab, LMS_LAUNCH_URL);
  return { via: "page" };
}

async function openCuims(hint) {
  const tab = await resolveTab(hint);
  if (isCuimsTab(tab)) {
    await focusTab(tab);
    return { via: "existing" };
  }
  const session = await ensureSession();
  await openIn(tab, CUIMS_HOME);
  return { via: "tab", signedIn: Boolean(session.signedIn) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own pages (the popup). A content script's sender
  // URL is the web page it runs in.
  const fromPopup = sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  if ((message?.type === "cuims-clear:launch-lms" || message?.type === "cuims-clear:open-cuims") && fromPopup) {
    const open = message.type === "cuims-clear:launch-lms" ? openLms : openCuims;
    open({ tabId: Number(message.tabId) || 0 })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  // A launch that needs the login form shows its tab.
  if (message?.type === "cuims-clear:lms-needs-ui" && sender.tab?.id) {
    chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
  }
});
