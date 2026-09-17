// Marks the LMS document immediately so native chrome does not paint first.
(() => {
  if (window.top !== window) return;
  const HOME = new Set(["/", "/index.php", "/my", "/my/", "/my/index.php"]);
  const DIRECTORY = "https://lms.cuchd.in/my/courses.php";
  const root = document.documentElement;
  if (location.hash === "#original") return;

  function hide() {
    root.classList.add("cc-lms-pending");
    root.style.setProperty("visibility", "hidden", "important");
    root.style.setProperty("background", "oklch(0.97 0.004 125)", "important");
  }

  function apply(enabled) {
    if (!enabled) {
      root.classList.remove("cc-lms-pending");
      root.classList.add("cc-lms-original");
      root.style.removeProperty("visibility");
      root.style.removeProperty("background");
      return;
    }
    if (HOME.has(location.pathname)) location.replace(DIRECTORY);
  }

  hide();
  try {
    chrome.storage.local.get({ lmsClear: true }, (settings) => apply(settings.lmsClear !== false));
  } catch {
    apply(true);
  }
})();
