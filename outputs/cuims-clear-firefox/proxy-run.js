// Proxy Run: a small game for the 1.0 page, and for when CUIMS is making
// the student wait. Run to class, collect P marks, jump the captchas (drawn
// from the solver's own Courier New glyphs) and duck the feedback dialogs.
// Attendance below 75% is game over. Everything is drawn on one canvas in
// the theme's hero colours; the best score stays in storage.local.
(function (root) {
  // Logical pixels: each is 2×2 CSS pixels, so the art stays crisp. The
  // width follows the card (it differs with scrollbar styles); the height
  // does not.
  let W = 160;
  const H = 84;
  const GROUND = 72;
  const START = { attended: 27, delivered: 30 };
  // Absences a captcha or a feedback form costs.
  const HIT_COST = 2;
  const DETAIN = 0.75;
  const BEST_KEY = "proxyRunBest";

  // A 3×5 pixel font: five rows of three, "1" for ink.
  const FONT_ROWS = {
    A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
    E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
    I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
    M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
    Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
    U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
    Y: "101101010010010", Z: "111001010100111",
    0: "111101101101111", 1: "010110010010111", 2: "110001010100111", 3: "110001010001110",
    4: "101101111001001", 5: "111100110001110", 6: "011100111101111", 7: "111001010010010",
    8: "111101111101111", 9: "111101111001110",
    "%": "101001010100101", ".": "000000000000010", ":": "000010000010000", "/": "001001010100100",
    "-": "000000111000000", "^": "010111010010010", _: "010010010111010", "!": "010010010000010",
    "*": "000101010101000", "·": "000000010000000", "'": "010010000000000", " ": "000000000000000",
  };

  // Sprites: "#" ink, "b" backpack (accent), "." empty.
  const SPRITES = {
    runA: [
      "....###..",
      "....###..",
      "....###..",
      ".....#...",
      "..bb####.",
      "..bb###.#",
      "..bb###..",
      "..bb###..",
      "....##...",
      "...#..#..",
      "..#....#.",
      ".#.....#.",
    ],
    runB: [
      "....###..",
      "....###..",
      "....###..",
      ".....#...",
      "..bb####.",
      "..bb####.",
      "..bb###..",
      "..bb###..",
      "....##...",
      "....##...",
      "....#.#..",
      "...#..#..",
    ],
    jump: [
      "....###..",
      "....###..",
      "....###.#",
      ".....#.#.",
      "..bb####.",
      "..bb###..",
      "..bb###..",
      "..bb###..",
      "...###...",
      "..#..##..",
      "..#......",
      ".........",
    ],
    duck: [
      "........###.",
      "........###.",
      "..bbb######.",
      "..bbb#######",
      "..bbb#####..",
      "...#####....",
      "...#....#...",
      "..#......#..",
    ],
  };

  // The captcha alphabet minus look-alikes that read badly at this size.
  const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabdefghkmnpqrtwxyz2345679";

  function colours(el) {
    const css = getComputedStyle(el || document.documentElement);
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      bg: v("--brand-bg", "#181a17"),
      ink: v("--hero-ink", "#ededec"),
      muted: v("--hero-muted", "#b0b1b0"),
      faint: v("--hero-faint", "#676866"),
      line: v("--hero-line", "#363835"),
      accent: v("--brand-ink", "#b7f34a"),
      good: v("--hero-good", "#b7f34a"),
      warn: v("--hero-warn", "#d49e2a"),
      bad: v("--hero-bad", "#cd634f"),
    };
  }

  // Captcha glyphs at 1×: the solver's 4× masks, a pixel inked when at
  // least half of its sixteen sub-pixels are.
  const glyphCache = new Map();
  function glyph(ch) {
    if (glyphCache.has(ch)) return glyphCache.get(ch);
    const source = root.CuimsCaptchaGlyphs?.glyphs?.[ch];
    let out = null;
    if (source) {
      const [, , w4, h4, data] = source;
      const binary = atob(data);
      const bit = (i) => (binary.charCodeAt(i >> 3) >> (i & 7)) & 1;
      const w = Math.ceil(w4 / 4);
      const h = Math.ceil(h4 / 4);
      const px = [];
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          let on = 0;
          for (let dy = 0; dy < 4; dy += 1) {
            for (let dx = 0; dx < 4; dx += 1) {
              const sx = x * 4 + dx;
              const sy = y * 4 + dy;
              if (sx < w4 && sy < h4 && bit(sy * w4 + sx)) on += 1;
            }
          }
          if (on >= 7) px.push([x, y]);
        }
      }
      out = { w, h, px };
    }
    glyphCache.set(ch, out);
    return out;
  }

  function create(canvas, { storage, onOver, announce } = {}) {
    const ctx = canvas.getContext("2d");
    let scale = 2;
    let c = colours(canvas);
    let raf = 0;
    let last = 0;
    let acc = 0;
    let best = 0;
    let state = "title"; // title | run | paused | over
    let g;
    let held = { up: false, down: false };
    let shakeFrames = 0;
    let newBest = false;

    storage?.get({ [BEST_KEY]: 0 }, (stored) => {
      best = Number(stored?.[BEST_KEY]) || 0;
      if (state !== "run") draw();
    });

    function fit() {
      const ratio = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
      canvas.style.width = "";
      const cssWidth = canvas.clientWidth || W * 2;
      W = Math.max(140, Math.floor(cssWidth / 2));
      scale = 2 * ratio;
      canvas.style.width = `${W * 2}px`;
      canvas.style.height = `${H * 2}px`;
      canvas.width = W * scale;
      canvas.height = H * scale;
      ctx.imageSmoothingEnabled = false;
    }

    function fresh() {
      return {
        t: 0,
        speed: 1.55,
        travelled: 0,
        attended: START.attended,
        delivered: START.delivered,
        player: { x: 22, y: GROUND, vy: 0, ground: true, duck: false, hurt: 0 },
        things: [],
        nextThing: 150,
        nextP: 40,
        skyline: makeSkyline(),
        flashes: [],
      };
    }

    function makeSkyline() {
      const blocks = [];
      let x = 0;
      let seed = 11;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      while (x < W * 2) {
        const w = 14 + Math.floor(rand() * 22);
        const h = 6 + Math.floor(rand() * 12);
        blocks.push({ x, w, h, tower: rand() < 0.15 });
        x += w + 2 + Math.floor(rand() * 6);
      }
      return { blocks, width: x, offset: 0 };
    }

    // ---- drawing helpers ----

    function rect(x, y, w, h, colour) {
      ctx.fillStyle = colour;
      ctx.fillRect(Math.round(x) * scale, Math.round(y) * scale, w * scale, h * scale);
    }

    function text(str, x, y, colour, size = 1, align = "left") {
      const chars = String(str).toUpperCase().split("");
      const width = chars.length * 4 * size - size;
      let cx = align === "center" ? Math.round(x - width / 2) : align === "right" ? Math.round(x - width) : x;
      ctx.fillStyle = colour;
      for (const ch of chars) {
        const rows = FONT_ROWS[ch] || FONT_ROWS[" "];
        for (let i = 0; i < 15; i += 1) {
          if (rows[i] === "1") ctx.fillRect((cx + (i % 3) * size) * scale, (y + Math.floor(i / 3) * size) * scale, size * scale, size * scale);
        }
        cx += 4 * size;
      }
      return width;
    }

    function sprite(rows, x, y, flicker) {
      if (flicker) return;
      for (let r = 0; r < rows.length; r += 1) {
        for (let k = 0; k < rows[r].length; k += 1) {
          const ch = rows[r][k];
          if (ch === "#") rect(x + k, y + r, 1, 1, c.ink);
          else if (ch === "b") rect(x + k, y + r, 1, 1, c.accent);
        }
      }
    }

    function percent() {
      return g.delivered ? g.attended / g.delivered : 1;
    }

    // ---- the world ----

    function spawnThing() {
      const roll = Math.random();
      const late = g.t > 60 * 25;
      if (roll < 0.62 || !late && roll < 0.75) {
        // A captcha on the ground: one glyph early, up to three later.
        const count = g.speed > 2.6 && Math.random() < 0.35 ? 3 : g.speed > 2 && Math.random() < 0.45 ? 2 : 1;
        const glyphs = [];
        let w = 0;
        for (let i = 0; i < count; i += 1) {
          const gl = glyph(CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]);
          if (!gl) continue;
          glyphs.push({ ...gl, dx: w, dy: Math.floor(Math.random() * 3) - 1 });
          w += gl.w - 1;
        }
        const h = Math.max(...glyphs.map((gl) => gl.h + gl.dy), 10);
        g.things.push({ kind: "captcha", x: W + 4, y: GROUND - h, w: Math.max(w, 6), h, glyphs });
      } else {
        // A feedback dialog at head height: duck under it.
        // Its bottom edge sits a pixel above a ducking head, below a standing one.
        g.things.push({ kind: "dialog", x: W + 4, y: GROUND - 20, w: 20, h: 11, bob: Math.random() * 6 });
      }
      const gap = 70 + Math.random() * 70;
      g.nextThing = gap + g.speed * 14;
    }

    function spawnP() {
      const proxy = Math.random() < 0.07;
      // Never on top of a captcha or under a dialog: up high instead.
      const crowded = g.things.some((thing) => (thing.kind === "captcha" || thing.kind === "dialog") && Math.abs(thing.x - (W + 4)) < thing.w + 12);
      const high = crowded || Math.random() < 0.4;
      g.things.push({ kind: proxy ? "proxy" : "p", x: W + 4, y: high ? GROUND - 34 : GROUND - 12, w: 7, h: 7 });
      g.nextP = 34 + Math.random() * 40;
    }

    function hit(a, b, inset = 1) {
      return a.x + inset < b.x + b.w && a.x + a.w - inset > b.x && a.y + inset < b.y + b.h && a.y + a.h - inset > b.y;
    }

    function flash(textValue, colour) {
      const half = (String(textValue).length * 4) / 2;
      g.flashes.push({ text: textValue, colour, x: Math.max(half + 2, g.player.x + 4), y: g.player.y - 22, life: 40 });
    }

    function step() {
      const p = g.player;
      g.t += 1;
      g.speed = Math.min(4, g.speed + 0.0009);
      g.travelled += g.speed;
      g.skyline.offset = (g.skyline.offset + g.speed * 0.25) % g.skyline.width;

      // Jump: Space or ↑, held for a higher one. ↓ ducks, or drops faster.
      p.duck = held.down && p.ground;
      if (held.up && p.ground) {
        p.vy = -6.1;
        p.ground = false;
      }
      if (!p.ground) {
        p.vy += held.down ? 0.9 : 0.42;
        if (!held.up && p.vy < -2.4) p.vy = -2.4;
        p.y += p.vy;
        if (p.y >= GROUND) {
          p.y = GROUND;
          p.vy = 0;
          p.ground = true;
        }
      }
      if (p.hurt > 0) p.hurt -= 1;

      g.nextThing -= g.speed;
      g.nextP -= g.speed;
      if (g.nextThing <= 0) spawnThing();
      if (g.nextP <= 0) spawnP();

      const box = p.duck ? { x: p.x + 2, y: p.y - 8, w: 9, h: 8 } : { x: p.x + 2, y: p.y - 12, w: 6, h: 12 };
      for (const thing of g.things) {
        thing.x -= g.speed;
        if (thing.gone) continue;
        if (!hit(box, thing, thing.kind === "p" || thing.kind === "proxy" ? 0 : 1)) {
          // Walked past a P without it: a class missed.
          if ((thing.kind === "p" || thing.kind === "proxy") && thing.x + thing.w < p.x && !thing.missed) {
            thing.missed = true;
            g.delivered += 1;
            flash("A", c.bad);
          }
          continue;
        }
        if (thing.kind === "p" || thing.kind === "proxy") {
          const n = thing.kind === "proxy" ? 3 : 1;
          g.attended += n;
          g.delivered += n;
          thing.gone = true;
          flash(n > 1 ? "PROXY +3" : "P", thing.kind === "proxy" ? c.warn : c.good);
        } else if (p.hurt === 0) {
          g.delivered += HIT_COST;
          p.hurt = 60;
          shakeFrames = reduced() ? 0 : 8;
          flash(thing.kind === "dialog" ? `FEEDBACK -${HIT_COST}` : `WRONG CODE -${HIT_COST}`, c.bad);
        }
      }
      g.things = g.things.filter((thing) => thing.x + thing.w > -8 && !thing.gone);
      for (const f of g.flashes) {
        f.life -= 1;
        f.y -= 0.35;
      }
      g.flashes = g.flashes.filter((f) => f.life > 0);

      if (percent() < DETAIN) over();
    }

    function drawWorld() {
      rect(0, 0, W, H, c.bg);
      // Campus skyline, far behind.
      const sky = g ? g.skyline : makeSkyline();
      for (const copy of [0, 1]) {
        for (const b of sky.blocks) {
          const x = b.x - sky.offset + copy * sky.width;
          if (x > W || x + b.w < 0) continue;
          rect(x, GROUND - b.h - 4, b.w, b.h + 4, c.line);
          for (let wy = GROUND - b.h; wy < GROUND - 6; wy += 4) {
            for (let wx = x + 2; wx < x + b.w - 2; wx += 4) rect(wx, wy, 1, 1, c.faint);
          }
          if (b.tower) {
            rect(x + Math.floor(b.w / 2) - 2, GROUND - b.h - 12, 4, 8, c.line);
            rect(x + Math.floor(b.w / 2) - 1, GROUND - b.h - 10, 2, 2, c.faint);
          }
        }
      }
      // Ground.
      rect(0, GROUND, W, 1, c.faint);
      const t = g ? g.travelled : 0;
      for (let x = -((t * 1) % 12); x < W; x += 12) rect(x, GROUND + 3, 3, 1, c.line);
      for (let x = -((t * 1) % 29) + 7; x < W; x += 29) rect(x, GROUND + 6, 1, 1, c.line);
    }

    function drawThing(thing) {
      if (thing.kind === "captcha") {
        // A strike through the code, as on the real one.
        for (const gl of thing.glyphs) {
          for (const [x, y] of gl.px) rect(thing.x + gl.dx + x, thing.y + gl.dy + y, 1, 1, c.ink);
        }
        rect(thing.x - 1, thing.y + Math.floor(thing.h / 2), thing.w + 2, 1, c.bad);
      } else if (thing.kind === "dialog") {
        const y = thing.y + Math.round(Math.sin((g.t + thing.bob * 10) / 9));
        rect(thing.x, y, thing.w, thing.h, c.ink);
        rect(thing.x + 1, y + 3, thing.w - 2, thing.h - 4, c.bg);
        rect(thing.x + thing.w - 3, y + 1, 1, 1, c.bad);
        for (let i = 0; i < 4; i += 1) rect(thing.x + 3 + i * 4, y + 6, 2, 2, c.warn);
      } else {
        const colour = thing.kind === "proxy" ? c.warn : c.good;
        const y = thing.y + Math.round(Math.sin((g.t + thing.x) / 7));
        rect(thing.x, y, 7, 7, colour);
        ctx.fillStyle = c.bg;
        const rows = FONT_ROWS.P;
        for (let i = 0; i < 15; i += 1) if (rows[i] === "1") rect(thing.x + 2 + (i % 3), y + 1 + Math.floor(i / 3), 1, 1, c.bg);
      }
    }

    function drawHud() {
      const pct = percent();
      const colour = pct < 0.8 ? c.bad : pct < 0.85 ? c.warn : c.good;
      text(`${(Math.floor(pct * 1000) / 10).toFixed(1)}%`, 4, 4, colour);
      // The meter, with the 75% line on it.
      rect(4, 11, 40, 2, c.line);
      rect(4, 11, Math.max(1, Math.round(40 * Math.min(1, (pct - 0.6) / 0.4))), 2, colour);
      rect(4 + Math.round(40 * (DETAIN - 0.6) / 0.4), 10, 1, 4, c.ink);
      text(`CLASSES ${String(g.attended).padStart(3, "0")}`, W - 4, 4, c.ink, 1, "right");
      text(`BEST ${String(best).padStart(3, "0")}`, W - 4, 11, c.faint, 1, "right");
    }

    function draw() {
      if (!ctx) return;
      ctx.save();
      if (shakeFrames > 0) ctx.translate((Math.random() * 4 - 2) * scale, (Math.random() * 2 - 1) * scale);
      drawWorld();
      if (state === "title") {
        sprite(SPRITES.runA, 22, GROUND - 12);
        text("PROXY RUN", W / 2, 10, c.accent, 3, "center");
        text("RUN TO CLASS. STAY ABOVE 75%.", W / 2, 31, c.muted, 1, "center");
        text("SPACE OR TAP TO START", W / 2, 41, c.ink, 1, "center");
        if (best) text(`BEST ${best}`, W / 2, 49, c.faint, 1, "center");
        ctx.restore();
        return;
      }
      for (const thing of g.things) drawThing(thing);
      const p = g.player;
      const frame = !p.ground ? SPRITES.jump : p.duck ? SPRITES.duck : Math.floor(g.t / 6) % 2 ? SPRITES.runA : SPRITES.runB;
      sprite(frame, p.x, p.y - frame.length, p.hurt > 0 && Math.floor(p.hurt / 4) % 2 === 0);
      for (const f of g.flashes) text(f.text, f.x, Math.round(f.y), f.colour, 1, "center");
      drawHud();
      if (state === "paused") {
        ctx.globalAlpha = 0.8;
        rect(0, 0, W, H, c.bg);
        ctx.globalAlpha = 1;
        text("PAUSED", W / 2, 30, c.ink, 2, "center");
        text("SPACE TO GO ON", W / 2, 46, c.muted, 1, "center");
      }
      if (state === "over") {
        rect(18, 18, W - 36, 44, c.bg);
        rect(18, 18, W - 36, 1, c.bad);
        rect(18, 61, W - 36, 1, c.bad);
        text("DETAINED.", W / 2, 23, c.bad, 2, "center");
        text("ATTENDANCE FELL BELOW 75%", W / 2, 37, c.muted, 1, "center");
        text(newBest ? `${g.attended} CLASSES  ·  NEW BEST` : `${g.attended} CLASSES  ·  BEST ${best}`, W / 2, 45, newBest ? c.accent : c.ink, 1, "center");
        text("SPACE OR TAP TO GO AGAIN", W / 2, 54, c.faint, 1, "center");
      }
      ctx.restore();
      if (shakeFrames > 0) shakeFrames -= 1;
    }

    function reduced() {
      return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    }

    // ---- the loop ----

    function frame(now) {
      raf = 0;
      if (state !== "run") return;
      if (!last) last = now;
      acc = Math.min(acc + (now - last), 100);
      last = now;
      while (acc >= 1000 / 60 && state === "run") {
        step();
        acc -= 1000 / 60;
      }
      draw();
      if (state === "run") raf = requestAnimationFrame(frame);
    }

    function run() {
      if (raf) cancelAnimationFrame(raf);
      last = 0;
      acc = 0;
      state = "run";
      raf = requestAnimationFrame(frame);
    }

    function start() {
      c = colours(canvas);
      g = fresh();
      newBest = false;
      held = { up: false, down: false };
      run();
    }

    function over() {
      state = "over";
      if (g.attended > best) {
        newBest = best > 0 || g.attended > START.attended;
        best = g.attended;
        storage?.set({ [BEST_KEY]: best });
      }
      draw();
      announce?.(`Detained. ${g.attended} classes${newBest ? ", a new best" : `, best ${best}`}. Press Space to go again.`);
      onOver?.({ attended: g.attended, best });
    }

    function pause() {
      if (state !== "run") return;
      state = "paused";
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw();
    }

    // Space / ↑ / tap jump (and start, resume, retry); ↓ ducks; Esc or P pauses.
    function press(action) {
      if (action === "pause") {
        if (state === "run") pause();
        else if (state === "paused") run();
        return;
      }
      if (action === "up" && (state === "title" || state === "over")) return start();
      if (action === "up" && state === "paused") return run();
      if (action === "up") held.up = true;
      if (action === "down") held.down = true;
    }

    function release(action) {
      if (action === "up") held.up = false;
      if (action === "down") held.down = false;
    }

    const KEYS = { " ": "up", ArrowUp: "up", w: "up", ArrowDown: "down", s: "down", Escape: "pause", p: "pause" };
    canvas.addEventListener("keydown", (event) => {
      const action = KEYS[event.key];
      if (!action) return;
      event.preventDefault();
      if (!event.repeat) press(action);
    });
    canvas.addEventListener("keyup", (event) => {
      const action = KEYS[event.key];
      if (action) release(action);
    });
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      // The bottom third ducks, the rest jumps.
      const bounds = canvas.getBoundingClientRect();
      const action = state === "run" && event.clientY - bounds.top > bounds.height * 0.72 ? "down" : "up";
      press(action);
      const up = () => {
        release(action);
        globalThis.removeEventListener("pointerup", up);
      };
      globalThis.addEventListener("pointerup", up);
    });
    canvas.addEventListener("blur", () => pause());
    document.addEventListener("visibilitychange", () => document.hidden && pause());

    fit();
    draw();

    return {
      start() {
        canvas.focus({ preventScroll: true });
        if (state !== "run") start();
      },
      pause,
      repaint() {
        c = colours(canvas);
        fit();
        draw();
      },
      get state() {
        return state;
      },
    };
  }

  root.CuimsProxyRun = { create, FONT_ROWS, BEST_KEY, W, H };
})(globalThis);
