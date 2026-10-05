// When the popup asks for a store rating. It asks only after the extension
// has clearly worked for a while, never after a failed read, and gives up for
// good once the student answers or ignores it twice. Everything here stays in
// storage.local; nothing is counted anywhere else.
(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Days the popup showed a read made that same day.
  const MIN_DAYS = 5;
  const MIN_AGE_MS = 7 * DAY_MS;
  // A round is this many days of showing the ask; an ignored round sleeps
  // before the next, and the last one ends it.
  const SHOWS_PER_ROUND = 3;
  const ROUNDS = 2;
  const SNOOZE_MS = 30 * DAY_MS;
  const KEEP_DAYS = 10;

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
    const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
    return {
      firstSeen: Number(s.firstSeen) || 0,
      days: list(s.days),
      shownDays: list(s.shownDays),
      round: Number(s.round) || 0,
      snoozeUntil: Number(s.snoozeUntil) || 0,
      done: s.done === true,
    };
  }

  // One popup open. `used`: the popup has a read from today. `healthy`: that
  // read worked and nothing has failed since. Returns the state to save and
  // whether to show the ask.
  function step(state, { now, today, used, healthy }) {
    const s = normalize(state);
    if (!s.firstSeen) s.firstSeen = now;
    if (used && !s.days.includes(today)) s.days = [...s.days, today].slice(-KEEP_DAYS);
    if (s.done) return { state: s, show: false };
    if (s.shownDays.length >= SHOWS_PER_ROUND && !s.shownDays.includes(today)) {
      if (s.round + 1 >= ROUNDS) s.done = true;
      else {
        s.round += 1;
        s.shownDays = [];
        s.snoozeUntil = now + SNOOZE_MS;
      }
    }
    const show = !s.done
      && Boolean(healthy)
      && s.days.length >= MIN_DAYS
      && now - s.firstSeen >= MIN_AGE_MS
      && now >= s.snoozeUntil;
    if (show && !s.shownDays.includes(today)) s.shownDays = [...s.shownDays, today];
    return { state: s, show };
  }

  // Rated, or said no: either way, never ask again.
  function finish(state) {
    return { ...normalize(state), done: true };
  }

  globalThis.CuimsRate = { step, finish, store, STORES, MIN_DAYS, MIN_AGE_MS, SHOWS_PER_ROUND, ROUNDS, SNOOZE_MS };
})();
