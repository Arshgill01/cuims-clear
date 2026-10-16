// Finds out when the store has a newer CUIMS Clear, marks the toolbar icon,
// and on Chrome installs it when the student asks. It never talks to CUIMS:
// Chrome asks the Web Store itself, Firefox asks addons.mozilla.org for one
// version number. See update-check.js for why each browser differs.
// Nothing here may throw while loading: in Chrome's service worker one
// failing script stops every other one.
(function () {
  try {
    startUpdates();
  } catch (error) {
    console.warn("CUIMS Clear: update checks are off.", error);
  }
})();

function startUpdates() {
  const U = globalThis.CuimsUpdate;
  if (!U || !chrome.runtime?.getManifest) return;
  const action = chrome.action || chrome.browserAction;
  const firefox = chrome.runtime.getURL("").startsWith("moz-extension:");
  const current = chrome.runtime.getManifest().version;
  const READY_WAIT_MS = 60_000;
  // An update a check already found: how long to wait before asking again.
  const KNOWN_WAIT_MS = 10_000;
  const IDLE_WAIT_MS = 60_000;
  let checking = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const load = () => chrome.storage.local.get({ updateInfo: null }).then(({ updateInfo }) => U.normalize(updateInfo));

  function paintBadge(info) {
    if (!action?.setBadgeText) return;
    const on = U.available(info, current);
    try {
      action.setBadgeText({ text: on ? "↑" : "" });
      if (on) action.setBadgeBackgroundColor?.({ color: "#2f6fed" });
      action.setTitle?.({ title: on ? `CUIMS Clear: version ${info.latest} is out` : "CUIMS Clear" });
    } catch {}
  }

  async function save(info) {
    await chrome.storage.local.set({ updateInfo: info });
    paintBadge(info);
    return info;
  }

  // Chrome resolves { status, version }: "update_available" (it is now
  // downloading), "no_update" or "throttled".
  async function askChrome() {
    const result = await chrome.runtime.requestUpdateCheck();
    return { status: String(result?.status || result || ""), version: String(result?.version || "") };
  }

  async function askAmo() {
    const response = await fetch(U.AMO_API, { credentials: "omit", cache: "no-cache" });
    if (!response.ok) throw new Error(`addons.mozilla.org answered ${response.status}`);
    const json = await response.json();
    const browser = await globalThis.browser?.runtime?.getBrowserInfo?.().catch(() => null);
    return U.amoLatest(json, browser?.version);
  }

  function check({ manual = false } = {}) {
    if (checking) return checking;
    checking = (async () => {
      const info = await load();
      const now = Date.now();
      if (!U.due(info, now, manual)) return info;
      const next = { ...info, checkedAt: now, error: "" };
      try {
        if (firefox) {
          next.latest = await askAmo();
        } else {
          const answer = await askChrome();
          if (answer.status === "update_available") next.latest = answer.version || info.latest;
          else if (answer.status === "no_update") next.latest = info.ready ? info.latest : "";
          // Throttled: Chrome checked recently itself. Keep what we knew.
        }
      } catch (error) {
        next.error = String(error?.message || error).slice(0, 160);
      }
      return save(next);
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  async function waitFor(test, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await test()) return true;
      await sleep(1000);
    }
    return test();
  }

  // Chrome only. When a check already found the update, Chrome is
  // downloading it: asking again within minutes only gets "throttled", so
  // Update waits for that download. A restart in the middle of a CUIMS read
  // or sign-in would cut it off, so it waits for them too (a minute at most).
  async function apply() {
    if (firefox) return { status: "firefox" };
    let info = await load();
    if (!info.ready) {
      const isReady = async () => (await load()).ready;
      const known = U.available(info, current);
      if (!known || !(await waitFor(isReady, KNOWN_WAIT_MS))) {
        let answer;
        try {
          answer = await askChrome();
        } catch (error) {
          return { status: "error", error: String(error?.message || error).slice(0, 160) };
        }
        if (answer.status === "no_update") {
          await save({ ...info, latest: "", checkedAt: Date.now(), error: "" });
          return { status: "no_update" };
        }
        if (answer.status === "update_available") await save({ ...info, latest: answer.version || info.latest, checkedAt: Date.now(), error: "" });
        // Throttled after a check that found it: still downloading.
        else if (!known) return { status: answer.status || "error" };
      }
      if (!(await waitFor(isReady, READY_WAIT_MS))) return { status: "downloading" };
      info = await load();
    }
    await waitFor(async () => {
      const { attendanceRunUntil, bgSignInUntil } = await chrome.storage.local.get({ attendanceRunUntil: 0, bgSignInUntil: 0 });
      return Date.now() >= Number(attendanceRunUntil) && Date.now() >= Number(bgSignInUntil);
    }, IDLE_WAIT_MS);
    setTimeout(() => chrome.runtime.reload(), 400);
    return { status: "restarting", version: info.latest };
  }

  async function status(options) {
    const info = options?.check ? await check({ manual: Boolean(options.manual) }) : await load();
    return { ...info, current, available: U.available(info, current), browser: firefox ? "firefox" : "chrome" };
  }

  const fromExtensionPage = (sender) => sender?.id === chrome.runtime.id && String(sender.url || "").startsWith(chrome.runtime.getURL(""));
  const fromCuimsTab = (sender) =>
    /^https:\/\/students\.cuchd\.in\//i.test(String(sender?.url || sender?.tab?.url || "")) && (!sender?.id || sender.id === chrome.runtime.id);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message?.type;
    if (type === "cuims-clear:tab-page" && fromCuimsTab(sender)) {
      cuimsKeepAwake(() => check()).catch(() => {});
      return;
    }
    if (type !== "cuims-clear:update-status" && type !== "cuims-clear:update-apply") return;
    if (!fromExtensionPage(sender) && !fromCuimsTab(sender)) return;
    const work = type === "cuims-clear:update-apply" ? apply : () => status(message);
    cuimsKeepAwake(work)
      .then(sendResponse)
      .catch((error) => sendResponse({ status: "error", error: String(error?.message || error) }));
    return true;
  });

  // Chrome has the update downloaded and installs it when this worker next
  // stops, or now on Update. Never in Firefox (see update-check.js).
  if (!firefox && chrome.runtime.onUpdateAvailable?.addListener) {
    chrome.runtime.onUpdateAvailable.addListener((details) => {
      load().then((info) => save({ ...info, latest: String(details?.version || info.latest), ready: true }));
    });
  }

  // The update landed: clear the notice, and let the popup say what changed.
  chrome.runtime.onInstalled?.addListener((details) => {
    if (details?.reason !== "update" || !details.previousVersion || details.previousVersion === current) return;
    load().then((info) =>
      chrome.storage.local
        .set({ updateDone: { from: details.previousVersion, to: current, at: Date.now(), seen: false } })
        .then(() => save({ ...info, latest: U.newer(info.latest, current) ? info.latest : "", ready: false })),
    );
  });

  // The badge does not outlive a browser restart.
  load().then(paintBadge).catch(() => {});
}
