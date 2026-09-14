// Runs in the page world. CUIMS SSO calls window.open(LMS URL); isolated
// content scripts cannot see that. With a short-lived launch intent, follow
// the ticket in this tab instead of a blocked popup.
(() => {
  if (window.top !== window) return;
  const SESSION = "cuims-clear:lms-launch";
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
})();
