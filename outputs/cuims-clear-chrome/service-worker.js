importScripts(
  "lms-open.js",
  "attendance-parse.js",
  "attendance-model.js",
  "attendance-client.js",
  "attendance-daemon.js",
  "attendance-bg.js",
);

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
  const tabUrl = String(sender.tab.url || sender.url || "");
  if (tabUrl && !/^https:\/\/students\.cuchd\.in\//i.test(tabUrl)) return;

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

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// The background sign-in's captcha goes through the same offscreen solver as
// the login page's: cleanup passes, OCR, then the case correction.
async function solveCaptchaViaOffscreen(bytes) {
  await ensureOffscreen();
  const result = await chrome.runtime.sendMessage({
    type: "cuims-clear:solve-captcha-bytes",
    dataUrl: `data:image/jpeg;base64,${toBase64(bytes)}`,
  });
  if (!result || result.error) throw new Error(result?.error || "empty solver response");
  return result.text;
}

startAttendanceBackground(solveCaptchaViaOffscreen);
