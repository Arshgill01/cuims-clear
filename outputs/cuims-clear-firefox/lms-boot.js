// Marks the LMS document immediately so native chrome does not paint first.
(() => {
  if (window.top !== window) return;
  const HOME = new Set(["/", "/index.php", "/my", "/my/", "/my/index.php"]);
  const DIRECTORY = "https://lms.cuchd.in/my/courses.php";
  const root = document.documentElement;
  if (location.hash === "#original") return;
  root.classList.add("cc-lms-pending");
  const apply = (enabled) => {
    if (!enabled) {
      root.classList.remove("cc-lms-pending");
      root.classList.add("cc-lms-original");
      return;
    }
    if (HOME.has(location.pathname)) location.replace(DIRECTORY);
  };
  try {
    chrome.storage.local.get({ lmsClear: true }, (settings) => apply(settings.lmsClear !== false));
  } catch {
    apply(true);
  }
})();
