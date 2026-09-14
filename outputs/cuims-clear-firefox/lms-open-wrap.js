// Runs in the page world. CUIMS SSO calls window.open(LMS URL); isolated
// content scripts cannot see that. Chrome also will not run javascript:
// __doPostBack from an isolated-world click, so activation happens here.
(() => {
  if (window.top !== window) return;
  const SESSION = "cuims-clear:lms-launch";
  const ACTIVATED = "cuims-clear:lms-activated";
  const TTL = 10 * 60 * 1000;

  function intended() {
    const at = Number(sessionStorage.getItem(SESSION));
    return Boolean(at && Date.now() - at <= TTL);
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

  function markActivated() {
    sessionStorage.setItem(ACTIVATED, "1");
  }

  function postBack(href) {
    const code = String(href || "").replace(/^javascript:/i, "");
    const match = code.match(/__doPostBack\((['"])(.*?)\1\s*,\s*(['"])(.*?)\3\)/);
    if (match && typeof window.__doPostBack === "function") {
      window.__doPostBack(match[2], match[4]);
      return true;
    }
    try {
      Function(code)();
      return true;
    } catch {
      return false;
    }
  }

  function activateMarked() {
    if (!intended()) return;
    const link = document.querySelector("[data-cc-lms-sso]");
    if (!link) return;
    const href = link.getAttribute("href") || link.href || "";
    const dest = lmsUrl(href);
    if (dest) {
      sessionStorage.removeItem(SESSION);
      markActivated();
      location.assign(dest);
      return;
    }
    markActivated();
    if (/^javascript:/i.test(href) && postBack(href)) return;
    link.click();
  }

  if (window.__cuimsLmsOpenWrap) return;
  window.__cuimsLmsOpenWrap = true;
  const original = window.open;
  window.open = function (url, name, features) {
    if (intended()) {
      const href = lmsUrl(url);
      if (href) {
        sessionStorage.removeItem(SESSION);
        location.assign(href);
        return null;
      }
    }
    return original ? original.call(window, url, name, features) : null;
  };
  window.addEventListener("cuims-clear:lms-activate", activateMarked);
})();
