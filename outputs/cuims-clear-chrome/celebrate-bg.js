// Founding 100: anyone who had CUIMS Clear before 1.0. The stores never say
// who installed what, so the browser's own install event decides, once: an
// update from a version before 1.0 is a founder, a fresh install is not.
// Nothing here may throw while loading (see update-bg.js).
(function () {
  try {
    chrome.runtime.onInstalled?.addListener((details) => {
      decide(details).catch(() => {});
    });
  } catch (error) {
    console.warn("CUIMS Clear: founding check is off.", error);
  }

  async function decide(details) {
    const { founding } = await chrome.storage.local.get({ founding: null });
    if (founding && typeof founding === "object") return;
    const from = String(details?.previousVersion || "");
    const before = (version) => (globalThis.CuimsUpdate?.newer ? globalThis.CuimsUpdate.newer("1.0.0", version) : Number.parseInt(version, 10) < 1);
    const founder = details?.reason === "update" && Boolean(from) && before(from);
    await chrome.storage.local.set({ founding: { founder, from: founder ? from : "", at: Date.now() } });
  }
})();
