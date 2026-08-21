// CUIMS Clear background solver.
// Runs Tesseract OCR entirely inside the extension: the bundled worker, WASM
// core, and traineddata are loaded from extension resources, so no network
// request ever leaves the browser.

const OEM_LSTM_ONLY = 1;
const SOLVE_TIMEOUT_MS = 25_000;

// Solver requests are serialized on one worker; tesseract.js does not support
// concurrent recognize() calls on a shared worker.
let solveQueue = Promise.resolve();
let workerPromise = null;

function createSolverWorker() {
  return Tesseract.createWorker("eng", OEM_LSTM_ONLY, {
    workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/tesseract/"),
    langPath: chrome.runtime.getURL("vendor/tessdata/"),
    // The language file ships in the package; skip IndexedDB caching.
    cacheMethod: "none",
    // Load worker.min.js directly so the extension CSP needs no blob: access.
    workerBlobURL: false,
    logger: () => {},
    errorHandler: (error) => console.warn("[CUIMS Clear] solver:", error),
  }).then(async (worker) => {
    await worker.setParameters({
      // Treat the image as a single text line of short tokens.
      tessedit_pageseg_mode: "7",
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      user_defined_dpi: "300",
    });
    return worker;
  });
}

function getSolverWorker() {
  if (!workerPromise) {
    workerPromise = createSolverWorker().catch((error) => {
      // Let the next login attempt try a fresh worker.
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("solver timeout")), ms),
    ),
  ]);
}

function sanitizeCaptchaText(text) {
  if (!text) return "";
  return text.replace(/[^0-9a-zA-Z]/g, "").trim();
}

function scoreCandidate(text, confidence) {
  let score = Number(confidence || 0);
  const len = (text || "").length;

  if (len >= 4 && len <= 6) {
    score += 25;
  } else if (len > 6) {
    score -= (len - 6) * 15;
  } else if (len < 4) {
    score -= (4 - len) * 20;
  }

  return score;
}

async function solveCandidates(candidates) {
  const worker = await getSolverWorker();
  const list = Array.isArray(candidates) ? candidates : [candidates];
  let bestCandidate = null;

  for (let i = 0; i < list.length; i++) {
    const dataUrl = list[i];
    if (!dataUrl) continue;

    try {
      const { data } = await withTimeout(
        worker.recognize(dataUrl),
        SOLVE_TIMEOUT_MS,
      );

      const text = sanitizeCaptchaText(data?.text || "");
      const confidence = Number(data?.confidence ?? 0);
      const score = scoreCandidate(text, confidence);

      const result = {
        text,
        confidence,
        score,
        passIndex: i,
      };

      // Fast path: if strong read with valid 4-6 chars, accept immediately
      if (confidence >= 65 && text.length >= 4 && text.length <= 6) {
        return result;
      }

      if (!bestCandidate || result.score > bestCandidate.score) {
        bestCandidate = result;
      }
    } catch (err) {
      console.warn(`[CUIMS Clear] candidate pass ${i} failed:`, err);
    }
  }

  if (!bestCandidate) {
    throw new Error("unconvincing read across all passes");
  }

  return bestCandidate;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "cuims-clear:prewarm") {
    getSolverWorker()
      .then(() => sendResponse({ prewarmed: true }))
      .catch((error) =>
        sendResponse({ error: String(error?.message || error) }),
      );
    return true;
  }

  if (message?.type !== "cuims-clear:solve-captcha") return;

  const candidates = message.candidates || (message.dataUrl ? [message.dataUrl] : []);

  solveQueue = solveQueue
    .then(() => solveCandidates(candidates))
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ error: String(error?.message || error) }),
    );

  return true; // keep the message channel open for the async reply
});
