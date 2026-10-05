// When the popup asks for a store rating. It asks from the first working
// read, once a day at the top of the popup and otherwise in a strip at the
// bottom, and never under a failed read. Neither store tells an extension who
// has reviewed it, so the student's own word ends it: "Already rated", or a
// yes after pressing Rate. Everything here stays in storage.local.
(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // × hides the ask for a few days; the last × hides it for good.
  const SNOOZE_MS = 3 * DAY_MS;
  const MAX_SNOOZES = 3;
  // How long the top banner stays before it moves to the bottom strip.
  const TOP_MS = 8000;

  const STORES = {
    chrome: {
      name: "Chrome Web Store",
      url: "https://chromewebstore.google.com/detail/amlobigbjldbogimakmfndkdaekcdbkf/reviews",
    },
    firefox: {
      name: "Firefox Add-ons",
      url: "https://addons.mozilla.org/firefox/addon/cuims-clear/",
    },
  };

  function store(protocol) {
    return protocol === "moz-extension:" ? STORES.firefox : STORES.chrome;
  }

  function normalize(state) {
    const s = state && typeof state === "object" ? state : {};
    return {
      done: s.done === true,
      // Pressed Rate but has not said whether they did.
      opened: s.opened === true,
      snoozes: Number(s.snoozes) || 0,
      snoozeUntil: Number(s.snoozeUntil) || 0,
      topDay: typeof s.topDay === "string" ? s.topDay : "",
    };
  }

  // One popup open. `healthy`: attendance is on screen and nothing has failed.
  // `show` is "" (nothing), "ask", or "confirm" (after Rate was pressed);
  // `top` puts today's first ask at the top for TOP_MS.
  function step(state, { now, today, healthy }) {
    const s = normalize(state);
    if (s.done || now < s.snoozeUntil || !healthy) return { state: s, show: "", top: false };
    if (s.opened) return { state: s, show: "confirm", top: false };
    const top = s.topDay !== today;
    if (top) s.topDay = today;
    return { state: s, show: "ask", top };
  }

  // Pressed Rate: next, ask whether they did.
  function opened(state) {
    return { ...normalize(state), opened: true };
  }

  // "Already rated", or yes after Rate: never ask again.
  function rated(state) {
    return { ...normalize(state), done: true, opened: false };
  }

  // Did not rate after all: back to the plain ask.
  function notYet(state) {
    return { ...normalize(state), opened: false };
  }

  function snooze(state, now) {
    const s = normalize(state);
    s.snoozes += 1;
    s.opened = false;
    if (s.snoozes >= MAX_SNOOZES) s.done = true;
    else s.snoozeUntil = now + SNOOZE_MS;
    return s;
  }

  globalThis.CuimsRate = { step, opened, rated, notYet, snooze, store, STORES, SNOOZE_MS, MAX_SNOOZES, TOP_MS };
})();
