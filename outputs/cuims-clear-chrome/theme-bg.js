// Recolours the toolbar icon for the chosen theme. The default theme keeps
// the packaged icon files.
(() => {
  const themes = globalThis.CuimsThemes;
  const action = chrome.action || chrome.browserAction;
  if (!themes || !action?.setIcon) return;

  function paint(id) {
    try {
      if (id === themes.DEFAULT || typeof OffscreenCanvas !== "function") {
        const path = chrome.runtime.getManifest().action?.default_icon;
        if (path) action.setIcon({ path });
        return;
      }
      action.setIcon({ imageData: { 16: themes.drawIcon(16, id), 32: themes.drawIcon(32, id) } });
    } catch {}
  }

  themes.load().then(paint);
  themes.onChange(paint);
})();
