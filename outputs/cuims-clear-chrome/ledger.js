// What CUIMS Clear has done for the student, counted on this device from 1.0
// on: the captchas it read (with the last few codes, which the receipt
// prints), the logins it pressed, the interruptions it hid and the
// attendance reads it made. Nothing here leaves the browser. The 1.0 page's
// receipt is the only reader.
(function (root) {
  const KEY = "cuimsLedger";
  // The receipt prints this many of the latest codes.
  const CODES_MAX = 24;
  const COUNTS = ["captchas", "logins", "hidden", "reads"];

  function normalize(value) {
    const v = value && typeof value === "object" ? value : {};
    const out = { since: Number(v.since) || 0, codes: [] };
    for (const name of COUNTS) out[name] = Math.max(0, Math.floor(Number(v[name]) || 0));
    if (Array.isArray(v.codes)) out.codes = v.codes.filter((code) => /^[A-Za-z0-9]{4}$/.test(String(code))).slice(-CODES_MAX);
    return out;
  }

  // `delta` is { captchas: 1, code: "K7MX" } and the like. `storage` is
  // chrome.storage.local, or the daemon's own storage in tests. Bumps from
  // one page or worker queue up, so two at once both count.
  let queue = Promise.resolve();
  function bump(storage, delta, now = Date.now()) {
    const next = queue.then(() => write(storage, delta, now));
    queue = next;
    return next;
  }

  async function write(storage, delta, now) {
    try {
      const stored = await storage.get({ [KEY]: null });
      const ledger = normalize(stored[KEY]);
      if (!ledger.since) ledger.since = now;
      for (const name of COUNTS) ledger[name] += Math.max(0, Number(delta?.[name]) || 0);
      const code = String(delta?.code || "");
      if (/^[A-Za-z0-9]{4}$/.test(code)) ledger.codes = [...ledger.codes, code].slice(-CODES_MAX);
      await storage.set({ [KEY]: ledger });
      return ledger;
    } catch {
      return null;
    }
  }

  // Rough seconds each thing saves: typing UID, password and captcha and
  // pressing Login; closing a dialog; opening CUIMS to find attendance.
  const SECONDS = { logins: 18, hidden: 4, reads: 40 };

  function savedSeconds(ledger) {
    const l = normalize(ledger);
    return l.logins * SECONDS.logins + l.hidden * SECONDS.hidden + l.reads * SECONDS.reads;
  }

  // Keys not pressed: four per captcha, and the UID on every login.
  function keystrokes(ledger, uidLength = 10) {
    const l = normalize(ledger);
    return l.captchas * 4 + l.logins * (uidLength + 1);
  }

  root.CuimsLedger = { KEY, CODES_MAX, normalize, bump, savedSeconds, keystrokes, SECONDS };
})(globalThis);
