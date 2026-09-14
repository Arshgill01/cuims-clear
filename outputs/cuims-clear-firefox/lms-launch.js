// Clicks CUIMS's own CU LMS control. Intent lives in sessionStorage so the
// page-world window.open hook can follow the SSO ticket after postback.
(() => {
  if (window.top !== window) return;
  const SESSION = "cuims-clear:lms-launch";
  const LAUNCH_AT = "lmsLaunchAt";
  const TTL = 10 * 60 * 1000;
  let inflight = false;

  function fresh(value) {
    const at = Number(value);
    return Boolean(at && Date.now() - at <= TTL);
  }

  function clearIntent() {
    sessionStorage.removeItem(SESSION);
    try { chrome.storage.local.remove(LAUNCH_AT); } catch {}
  }

  function lmsUrl(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      if (url.origin !== "https://lms.cuchd.in" || url.pathname === "/" || url.username || url.password) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function follow(url) {
    const href = lmsUrl(url);
    if (!href) return false;
    clearIntent();
    location.assign(href);
    return true;
  }

  function label(el) {
    return `${el.textContent || ""} ${el.value || ""} ${el.getAttribute?.("title") || ""} ${el.getAttribute?.("aria-label") || ""}`;
  }

  function ssoLink() {
    const named = document.querySelector('[id$="lbtnLMSSSO"], [id*="LMSSSO"], [id*="lbtnLMS"]');
    if (named) return named;
    try {
      return [...document.querySelectorAll("a, button, input[type='submit'], [onclick], [href*='doPostBack']")].find((el) =>
        /cu\s*lms/i.test(label(el))
      ) || [...document.querySelectorAll("a, button, [onclick]")].find((el) => {
        if (!/click\s*here/i.test(label(el))) return false;
        for (let node = el, i = 0; node && i < 6; i++, node = node.parentElement) {
          if (/cu\s*lms/i.test(node.textContent || "")) return true;
        }
        return false;
      }) || null;
    } catch {
      return null;
    }
  }

  function waitForLink(timeout = 15000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const link = ssoLink();
        if (link) return resolve(link);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  function activate(link) {
    const href = link.getAttribute?.("href") || link.href || "";
    if (follow(href)) return;
    const target = (link.matches?.("a, button, input") ? link : link.querySelector?.("a, button, input")) || link;
    try { target.setAttribute("data-cc-lms-sso", "1"); } catch {}
    try {
      sessionStorage.removeItem("cuims-clear:lms-activated");
      window.dispatchEvent(new CustomEvent("cuims-clear:lms-activate"));
    } catch {}
    if (sessionStorage.getItem("cuims-clear:lms-activated") === "1") return;
    target.click();
  }

  async function remember() {
    sessionStorage.setItem(SESSION, String(Date.now()));
    try { await chrome.storage.local.set({ [LAUNCH_AT]: Date.now() }); } catch {}
  }

  async function hasIntent() {
    if (fresh(sessionStorage.getItem(SESSION))) return true;
    try {
      const stored = await chrome.storage.local.get({ [LAUNCH_AT]: 0 });
      if (fresh(stored[LAUNCH_AT])) {
        await remember();
        return true;
      }
    } catch {}
    return false;
  }

  function needsUi() {
    try { chrome.runtime.sendMessage({ type: "cuims-clear:lms-needs-ui" }); } catch {}
  }

  async function launch() {
    if (inflight) return;
    inflight = true;
    try {
      if (!(await hasIntent())) return;
      if (document.querySelector("#txtUserId, #txtPassword, #captchaCode, #btnNext, #btnLogin")) {
        setTimeout(() => {
          if (document.querySelector("#txtUserId, #txtPassword, #captchaCode")) needsUi();
        }, 8000);
        return;
      }
      const link = await waitForLink();
      if (!link) return;
      await remember();
      activate(link);
    } finally {
      inflight = false;
    }
  }

  if (location.hash === "#cuims-clear-lms") {
    sessionStorage.setItem(SESSION, String(Date.now()));
    try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "cuims-clear:launch-lms") return;
      sendResponse({ ok: true });
      launch();
    });
  } catch {}

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", launch, { once: true });
  else launch();
})();
