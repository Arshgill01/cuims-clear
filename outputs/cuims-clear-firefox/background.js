// CUIMS Clear background solver.
// Runs Tesseract OCR entirely inside the extension: the bundled worker, WASM
// core, and traineddata are loaded from extension resources, so no network
// request ever leaves the browser.

const OEM_LSTM_ONLY = 1;
const SOLVE_TIMEOUT_MS = 25_000;
const FAST_PATH_CONFIDENCE = 80;
const CONSENSUS_BONUS = 20;

// Serialized queue for solver requests. Must always recover from rejections.
let solveQueue = Promise.resolve();
let workerPromise = null;

function isTrustedSolverSender(sender) {
  if (!sender) return false;
  const extensionId = chrome.runtime?.id;
  if (sender.id && extensionId && sender.id !== extensionId) return false;
  const url = String(sender.url || "");
  if (extensionId && url.startsWith(`chrome-extension://${extensionId}`)) return true;
  if (extensionId && url.startsWith(`moz-extension://${extensionId}`)) return true;
  if (/^https:\/\/students\.cuchd\.in\//i.test(url)) return true;
  // Extension pages (popup / offscreen) may omit url.
  if (sender.id === extensionId && !sender.tab) return true;
  return Boolean(sender.tab && /^https:\/\/students\.cuchd\.in\//i.test(url));
}

function createSolverWorker() {
  return Tesseract.createWorker("eng", OEM_LSTM_ONLY, {
    workerPath: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/tesseract/"),
    langPath: chrome.runtime.getURL("vendor/tessdata/"),
    cacheMethod: "none",
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
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("solver timeout")), ms);
    }),
  ]);
}

function repairGlyphFusions(rawText) {
  if (!rawText) return "";
  let text = rawText.replace(/[^0-9a-zA-Z]/g, "").trim();

  // Repair common character splitting fusions
  if (text.length > 4 && text.includes("vv")) {
    text = text.replace(/vv/g, "w");
  }
  if (text.length > 5 && text.includes("rn")) {
    text = text.replace(/rn/g, "m");
  }
  if (text.length > 5 && text.includes("cl")) {
    text = text.replace(/cl/g, "d");
  }

  return text;
}

function sanitizeCaptchaText(text) {
  return repairGlyphFusions(text);
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

function isStrongRead(text, confidence) {
  const len = (text || "").length;
  return Number(confidence || 0) >= FAST_PATH_CONFIDENCE && len >= 4 && len <= 6;
}

function selectBestCandidate(results) {
  const valid = results.filter((result) => result && result.text);
  if (valid.length === 0) return null;

  const groups = new Map();
  for (const result of valid) {
    const group = groups.get(result.text) || { results: [] };
    group.results.push(result);
    groups.set(result.text, group);
  }

  let best = null;
  for (const group of groups.values()) {
    const representative = group.results.reduce((winner, current) =>
      current.score > winner.score ? current : winner,
    );
    const score =
      representative.score + (group.results.length >= 2 ? CONSENSUS_BONUS : 0);
    const candidate = {
      ...representative,
      score,
      agreement: group.results.length,
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

async function solveCandidates(candidates) {
  const worker = await getSolverWorker();
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const results = [];

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
      results.push(result);

      // Only skip later passes on a genuinely strong first read (latency win).
      if (i === 0 && isStrongRead(text, confidence)) {
        return { ...result, agreement: 1 };
      }

      // If two passes already agree on a legal token, skip the remainder.
      if (results.length >= 2 && text.length >= 4 && text.length <= 6) {
        const agreed = results.filter((item) => item.text === text);
        if (agreed.length >= 2) {
          return selectBestCandidate(results);
        }
      }
    } catch (err) {
      console.warn(`[CUIMS Clear] candidate pass ${i} failed:`, err);
    }
  }

  const bestCandidate = selectBestCandidate(results);
  if (!bestCandidate || !bestCandidate.text) {
    throw new Error("unconvincing read across all passes");
  }

  return bestCandidate;
}

function enqueueSolve(candidates) {
  const run = solveQueue.catch(() => {}).then(() => solveCandidates(candidates));
  solveQueue = run.catch(() => {});
  return run;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isTrustedSolverSender(sender)) return;

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

  enqueueSolve(candidates)
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.warn("[CUIMS Clear] solve error:", error);
      sendResponse({ error: String(error?.message || error) });
    });

  return true;
});

// Background sign-in reads the captcha the same way the login page does:
// the shared cleanup passes, the same OCR queue, then the case correction.
async function solveCaptchaBytes(bytes) {
  const src = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const result = await enqueueSolve(extractCaptchaVariants(image));
    return correctCaptchaCase(String(result?.text || "").trim(), image);
  } finally {
    URL.revokeObjectURL(src);
  }
}

const ATTENDANCE_ALARM = "cuims-clear-attendance";

const attendance = CuimsAttendance.createDaemon({
  storage: {
    get: (defaults) => chrome.storage.local.get(defaults),
    set: (values) => chrome.storage.local.set(values),
  },
  fetchImpl: (url, options) => fetch(url, options),
  solveCaptcha: solveCaptchaBytes,
});

function isExtensionPage(sender) {
  const extensionId = chrome.runtime?.id;
  if (!sender || (sender.id && sender.id !== extensionId)) return false;
  return !sender.tab && (!sender.url || String(sender.url).startsWith(`moz-extension://`));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cuims-clear:attendance-refresh") return;
  if (!isExtensionPage(sender)) return;
  chrome.permissions
    .contains({ origins: ["https://students.cuchd.in/*"] })
    .then((granted) => {
      if (!granted) return { error: "Firefox has switched off access to CUIMS. Use Allow access at the top.", code: "no-access" };
      return attendance.refresh("manual");
    })
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error?.message || error), code: "network" }));
  return true;
});

chrome.alarms.create(ATTENDANCE_ALARM, { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== ATTENDANCE_ALARM) return;
  chrome.permissions
    .contains({ origins: ["https://students.cuchd.in/*"] })
    .then((granted) => (granted ? attendance.tick() : null))
    .catch(() => {});
});

// A changed UID or password lifts the "rejected login" pause.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.uid || changes.password)) return;
  chrome.storage.local.get({ loginGuard: null }, ({ loginGuard }) => {
    if (loginGuard?.rejectedUid) chrome.storage.local.set({ loginGuard: { ...loginGuard, rejectedUid: "" } });
  });
});
