// Chrome MV3 cannot host Tesseract in this service worker: dedicated workers
// and WASM need a real document. The offscreen page reuses background.js.

let offscreenReady = null;

function ensureOffscreen() {
  if (offscreenReady) return offscreenReady;

  offscreenReady = (async () => {
    if (await chrome.offscreen.hasDocument()) return;

    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["WORKERS"],
        justification: "Run on-device CAPTCHA OCR with a persistent Tesseract worker.",
      });
    } catch (error) {
      if (await chrome.offscreen.hasDocument()) return;
      throw error;
    }
  })().catch((error) => {
    offscreenReady = null;
    throw error;
  });

  return offscreenReady;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content scripts have a tab. The offscreen page and popup do not.
  if (!sender.tab) return;

  if (
    message?.type !== "cuims-clear:solve-captcha" &&
    message?.type !== "cuims-clear:prewarm"
  ) {
    return;
  }

  ensureOffscreen()
    .then(() => chrome.runtime.sendMessage(message))
    .then((result) => sendResponse(result ?? { error: "empty solver response" }))
    .catch((error) => sendResponse({ error: String(error?.message || error) }));

  return true;
});
