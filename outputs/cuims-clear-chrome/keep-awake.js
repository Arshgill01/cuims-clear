// Firefox stops the background page, and Chrome its service worker, after
// 30 s without extension events or API calls, even while the popup is still
// waiting for an answer. A slow CUIMS read or sign-in was cut off midway: the
// popup heard "Could not reach the extension background", and the locks the
// run had taken stayed behind. While a task the popup or a tab started is
// running, a cheap API call every 10 s keeps the background alive. Each task
// is bounded by its own request timeouts; MAX_MS only guards against a task
// that never settles.
(function (root) {
  const BEAT_MS = 10_000;
  const MAX_MS = 4 * 60_000;
  const running = new Set();
  let timer = null;

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  function beat() {
    const now = Date.now();
    for (const task of running) {
      if (now - task.at > MAX_MS) running.delete(task);
    }
    if (!running.size) return stop();
    try {
      chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
    } catch {}
  }

  root.cuimsKeepAwake = function keepAwake(work) {
    const task = { at: Date.now() };
    running.add(task);
    if (!timer) timer = setInterval(beat, BEAT_MS);
    return Promise.resolve()
      .then(work)
      .finally(() => {
        running.delete(task);
        if (!running.size) stop();
      });
  };
})(globalThis);
