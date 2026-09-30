// Marks the LMS document immediately so native chrome does not paint first.
(() => {
  if (window.top !== window) return;
  const HOME = new Set(["/", "/index.php", "/my", "/my/", "/my/index.php"]);
  const DIRECTORY = "https://lms.cuchd.in/my/courses.php";
  const root = document.documentElement;
  if (location.hash === "#original") return;

  const themes = globalThis.CuimsThemes;
  const LOADING_BG = "oklch(0.97 0.004 125)";

  // The chosen theme restyles the clear view through its variables. Dark
  // themes also switch Moodle's own Bootstrap components to dark.
  function applyTheme(id) {
    if (!themes) return;
    let style = document.getElementById("cc-theme");
    const css = themes.lmsCss(id);
    if (!css) {
      style?.remove();
      delete root.dataset.ccTheme;
      if (root.dataset.ccSetBs) {
        root.removeAttribute("data-bs-theme");
        delete root.dataset.ccSetBs;
      }
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = "cc-theme";
      root.append(style);
    }
    style.textContent = css;
    root.dataset.ccTheme = id;
    if (themes.tokens(id).scheme === "dark") {
      root.setAttribute("data-bs-theme", "dark");
      root.dataset.ccSetBs = "1";
    } else if (root.dataset.ccSetBs) {
      root.removeAttribute("data-bs-theme");
      delete root.dataset.ccSetBs;
    }
    if (root.classList.contains("cc-lms-pending")) root.style.setProperty("background", themes.tokens(id).canvas, "important");
  }

  function hide() {
    root.classList.add("cc-lms-pending");
    root.style.setProperty("visibility", "hidden", "important");
    root.style.setProperty("background", LOADING_BG, "important");
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
  applyTheme(themes?.mirrored());
  themes?.load().then(applyTheme);
  themes?.onChange(applyTheme);
  try {
    chrome.storage.local.get({ lmsClear: true }, (settings) => apply(settings.lmsClear !== false));
  } catch {
    apply(true);
  }
})();
