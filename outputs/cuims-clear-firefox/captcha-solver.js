// Reads the CUIMS login captcha on the device, with no OCR engine.
//
// CUIMS draws every captcha the same way: four characters in Courier New
// Bold at 20 px, on a fixed 12.25 px pitch starting at x = 3, in near-black
// ink over a light coloured pattern, as a 100x30 JPEG. So instead of
// guessing at a line of text, this matches each of the four character cells
// against the font's 62 glyphs (captcha-glyphs.js) at the exact position
// they are drawn, allowing a pixel of drift, and then checks the best few
// four-character readings against the whole image so glyphs that touch
// their neighbours are judged together.
//
// The core works on plain RGBA pixels, so the same code runs in the login
// page, in Firefox's background page and in Chrome's service worker.

(function (root) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const WIDTH = 100;
  const HEIGHT = 30;
  const LENGTH = 4;
  // Pen positions in quarter pixels: x = 3 + 12.25 * cell, y = 0.
  const ORIGIN_X4 = 12;
  const PITCH_X4 = 49;
  const ORIGIN_Y4 = 0;
  // How far a glyph may sit from its pen position, in quarter pixels.
  const DRIFT_X4 = [-4, -2, 0, 2, 4];
  const DRIFT_Y4 = [-4, -2, 0, 2, 4];
  // How far the whole line may sit from where CUIMS draws it today, in
  // quarter pixels. Found first, so a server-side nudge of the text cannot
  // turn into confident wrong answers.
  const SHIFT_X4 = [-16, -12, -8, -4, 0, 4, 8, 12, 16];
  const SHIFT_Y4 = [-12, -8, -4, 0, 4, 8, 12];
  const BEAM = 4;
  // On 530 real captchas the whole-image match never fell below 0.88 and no
  // cell's best glyph below 0.80; anything far under that is not a CUIMS
  // captcha as we know it, so it is filled but never submitted.
  const MIN_SCORE = 0.8;
  const MIN_CELL = 0.7;
  // Two glyphs closer than this on the whole-cell match are settled on the
  // pixels where they differ (1 against l is the tightest real pair, 0.021
  // apart). A settled pair must then be at least MIN_DECISIVE apart there.
  const CLOSE_CALL = 0.06;
  const MIN_DECISIVE = 0.06;

  let glyphMasks = null;
  const tileCache = new Map();

  function glyphSource() {
    const source = root.CuimsCaptchaGlyphs;
    if (!source?.glyphs) throw new Error("captcha glyphs missing");
    return source;
  }

  function decodeBase64(text) {
    if (typeof atob === "function") {
      const binary = atob(text);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(text, "base64"));
  }

  function masks() {
    if (glyphMasks) return glyphMasks;
    const { glyphs } = glyphSource();
    glyphMasks = {};
    for (const ch of ALPHABET) {
      const [ox, oy, w, h, data] = glyphs[ch];
      const bits = decodeBase64(data);
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < mask.length; i++) mask[i] = (bits[i >> 3] >> (i & 7)) & 1;
      glyphMasks[ch] = { ox, oy, w, h, mask };
    }
    return glyphMasks;
  }

  // The glyph's coverage of each screen pixel when its 4x mask starts `rx`,
  // `ry` quarter pixels into a pixel. Cached per sub-pixel phase.
  function tile(ch, rx, ry) {
    const key = `${ch}${rx}${ry}`;
    let found = tileCache.get(key);
    if (found) return found;
    const g = masks()[ch];
    const w = Math.ceil((rx + g.w) / 4);
    const h = Math.ceil((ry + g.h) / 4);
    const values = new Float32Array(w * h);
    for (let y = 0; y < g.h; y++) {
      const row = ((ry + y) >> 2) * w;
      for (let x = 0; x < g.w; x++) {
        if (g.mask[y * g.w + x]) values[row + ((rx + x) >> 2)] += 1 / 16;
      }
    }
    found = { w, h, values };
    tileCache.set(key, found);
    return found;
  }

  // The glyph drawn with its pen at (penX4, penY4) quarter pixels.
  function place(ch, penX4, penY4) {
    const g = masks()[ch];
    const ax = penX4 + g.ox;
    const ay = penY4 + g.oy;
    const rx = ((ax % 4) + 4) % 4;
    const ry = ((ay % 4) + 4) % 4;
    const t = tile(ch, rx, ry);
    return { x: (ax - rx) / 4, y: (ay - ry) / 4, w: t.w, h: t.h, values: t.values };
  }

  // How dark and colourless each pixel is: the captcha's text is near-black,
  // its background pattern light and coloured.
  function inkMap(rgba, width, height) {
    const ink = new Float32Array(width * height);
    for (let i = 0; i < ink.length; i++) {
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      const saturation = Math.max(r, g, b) - Math.min(r, g, b);
      if (saturation >= 100) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      ink[i] = Math.min(1, Math.max(0, (150 - lum) / 120));
    }
    return ink;
  }

  // Normalised correlation between the ink in columns [x0, x1) and a placed
  // glyph, counting only the part of the glyph inside those columns.
  function cellMatch(ink, inkEnergy, x0, x1, glyph) {
    let dot = 0;
    let energy = 0;
    const left = Math.max(x0, glyph.x);
    const right = Math.min(x1, glyph.x + glyph.w);
    const top = Math.max(0, glyph.y);
    const bottom = Math.min(HEIGHT, glyph.y + glyph.h);
    for (let y = top; y < bottom; y++) {
      const tileRow = (y - glyph.y) * glyph.w - glyph.x;
      const inkRow = y * WIDTH;
      for (let x = left; x < right; x++) {
        const v = glyph.values[tileRow + x];
        if (!v) continue;
        dot += v * ink[inkRow + x];
        energy += v * v;
      }
    }
    return energy && inkEnergy ? dot / Math.sqrt(energy * inkEnergy) : 0;
  }

  // The columns one character cell covers, a pixel wider on each side.
  function cellWindow(cell, shiftX4) {
    const x0 = Math.max(0, Math.floor((ORIGIN_X4 + shiftX4 + PITCH_X4 * cell) / 4) - 1);
    const x1 = Math.min(WIDTH, Math.ceil((ORIGIN_X4 + shiftX4 + PITCH_X4 * (cell + 1)) / 4) + 1);
    return [x0, x1];
  }

  function windowEnergy(ink, x0, x1) {
    let energy = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = x0; x < x1; x++) energy += ink[y * WIDTH + x] ** 2;
    }
    return energy;
  }

  // Where the line of text sits: the shift at which the four cells, each
  // with its best glyph, match the ink best.
  function findShift(ink) {
    let best = { x: 0, y: 0, score: -1 };
    for (const sx of SHIFT_X4) {
      for (const sy of SHIFT_Y4) {
        let total = 0;
        for (let cell = 0; cell < LENGTH; cell++) {
          const [x0, x1] = cellWindow(cell, sx);
          const energy = windowEnergy(ink, x0, x1);
          let top = 0;
          for (const ch of ALPHABET) {
            const score = cellMatch(ink, energy, x0, x1, place(ch, ORIGIN_X4 + sx + PITCH_X4 * cell, ORIGIN_Y4 + sy));
            if (score > top) top = score;
          }
          total += top;
        }
        if (total > best.score) best = { x: sx, y: sy, score: total };
      }
    }
    return best;
  }

  // Every glyph's best match in one cell, best first.
  function rankCell(ink, cell, shift) {
    const [x0, x1] = cellWindow(cell, shift.x);
    const inkEnergy = windowEnergy(ink, x0, x1);
    const ranked = [];
    for (const ch of ALPHABET) {
      let best = { ch, score: -1, dx: 0, dy: 0 };
      for (const dx of DRIFT_X4) {
        for (const dy of DRIFT_Y4) {
          const glyph = place(ch, ORIGIN_X4 + shift.x + PITCH_X4 * cell + dx, ORIGIN_Y4 + shift.y + dy);
          const score = cellMatch(ink, inkEnergy, x0, x1, glyph);
          if (score > best.score) best = { ch, score, dx: shift.x + dx, dy: shift.y + dy };
        }
      }
      ranked.push(best);
    }
    return ranked.sort((a, b) => b.score - a.score);
  }

  // Settles a close call between two glyphs, each at its own best position,
  // on only the pixels where they differ: how much closer `a` is to the ink
  // there than `b`, per pixel (positive means `a`).
  function settle(ink, inkScale, a, b) {
    const ga = place(a.ch, ORIGIN_X4 + PITCH_X4 * a.cell + a.dx, ORIGIN_Y4 + a.dy);
    const gb = place(b.ch, ORIGIN_X4 + PITCH_X4 * b.cell + b.dx, ORIGIN_Y4 + b.dy);
    const left = Math.max(0, Math.min(ga.x, gb.x));
    const right = Math.min(WIDTH, Math.max(ga.x + ga.w, gb.x + gb.w));
    const top = Math.max(0, Math.min(ga.y, gb.y));
    const bottom = Math.min(HEIGHT, Math.max(ga.y + ga.h, gb.y + gb.h));
    const at = (g, x, y) => (x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h ? g.values[(y - g.y) * g.w + (x - g.x)] : 0);
    let pixels = 0;
    let lead = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const va = at(ga, x, y);
        const vb = at(gb, x, y);
        if (Math.abs(va - vb) < 0.3) continue;
        const v = Math.min(1, ink[y * WIDTH + x] / inkScale);
        lead += Math.abs(v - vb) - Math.abs(v - va);
        pixels += 1;
      }
    }
    return pixels ? lead / pixels : 0;
  }

  // Normalised correlation between the whole image and the four glyphs drawn
  // together, so touching neighbours are judged as the server drew them.
  function wholeMatch(ink, inkEnergy, picks) {
    const drawn = new Float32Array(WIDTH * HEIGHT);
    picks.forEach((pick, cell) => {
      const glyph = place(pick.ch, ORIGIN_X4 + PITCH_X4 * cell + pick.dx, ORIGIN_Y4 + pick.dy);
      for (let y = Math.max(0, glyph.y); y < Math.min(HEIGHT, glyph.y + glyph.h); y++) {
        for (let x = Math.max(0, glyph.x); x < Math.min(WIDTH, glyph.x + glyph.w); x++) {
          const v = glyph.values[(y - glyph.y) * glyph.w + (x - glyph.x)];
          if (v > drawn[y * WIDTH + x]) drawn[y * WIDTH + x] = v;
        }
      }
    });
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < drawn.length; i++) {
      if (!drawn[i]) continue;
      dot += drawn[i] * ink[i];
      energy += drawn[i] * drawn[i];
    }
    return energy && inkEnergy ? dot / Math.sqrt(energy * inkEnergy) : 0;
  }

  // Reads a captcha from RGBA pixels. Always answers four characters;
  // `confident` says whether it is safe to submit without a person looking.
  function read(rgba, width, height) {
    if (width !== WIDTH || height !== HEIGHT || !rgba || rgba.length < WIDTH * HEIGHT * 4) {
      return { text: "", score: 0, confident: false, reason: "size" };
    }
    const ink = inkMap(rgba, width, height);
    let inkEnergy = 0;
    for (let i = 0; i < ink.length; i++) inkEnergy += ink[i] * ink[i];
    if (!inkEnergy) return { text: "", score: 0, confident: false, reason: "blank" };

    const shift = findShift(ink);
    const cells = [];
    for (let cell = 0; cell < LENGTH; cell++) cells.push(rankCell(ink, cell, shift));

    let best = null;
    const beams = cells.map((ranked) => ranked.slice(0, BEAM));
    const walk = (cell, picks) => {
      if (cell === LENGTH) {
        const score = wholeMatch(ink, inkEnergy, picks);
        if (!best || score > best.score) best = { score, picks: picks.slice() };
        return;
      }
      for (const pick of beams[cell]) {
        picks.push(pick);
        walk(cell + 1, picks);
        picks.pop();
      }
    };
    walk(0, []);

    // How dark this image's text is, so a faint captcha is judged like a
    // crisp one: the ink level most text pixels reach.
    const strokes = [];
    for (let i = 0; i < ink.length; i++) if (ink[i] > 0.1) strokes.push(ink[i]);
    strokes.sort((a, b) => a - b);
    const inkScale = Math.max(0.2, strokes[Math.floor(strokes.length * 0.9)] || 1);

    // Close calls are settled where the two glyphs differ.
    const detail = cells.map((ranked, cell) => {
      let pick = best.picks[cell];
      const rival = ranked.find((item) => item.ch !== pick.ch);
      let margin = pick.score - rival.score;
      let decisive = Infinity;
      if (Math.abs(margin) < CLOSE_CALL) {
        const lead = settle(ink, inkScale, { ...pick, cell }, { ...rival, cell });
        if (lead < 0) {
          [pick, margin] = [rival, -margin];
          best.picks[cell] = rival;
        }
        decisive = Math.abs(lead);
      }
      return { ch: pick.ch, score: pick.score, margin, decisive, next: pick === rival ? best.picks[cell].ch : rival.ch };
    });
    const text = best.picks.map((pick) => pick.ch).join("");
    const weakest = Math.min(...detail.map((item) => item.score));
    const settled = detail.every((item) => item.decisive >= MIN_DECISIVE);
    const confident = best.score >= MIN_SCORE && weakest >= MIN_CELL && settled;
    return {
      text,
      score: best.score,
      cells: detail,
      shift: { x: shift.x / 4, y: shift.y / 4 },
      confident,
      reason: confident ? "" : "unsure",
    };
  }

  // A page canvas where there is a page (the login tab); OffscreenCanvas in
  // Chrome's service worker, which has no document.
  function canvasFor(width, height) {
    if (typeof document !== "undefined" && document?.createElement) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    return new OffscreenCanvas(width, height);
  }

  // Pixels of anything a canvas can draw: an <img>, an ImageBitmap.
  function pixelsOf(source) {
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height) throw new Error("captcha image is empty");
    const ctx = canvasFor(width, height).getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  }

  function readImage(image) {
    const { data, width, height } = pixelsOf(image);
    return read(data, width, height);
  }

  // The captcha's JPEG bytes, as the background sign-in fetches them.
  async function readBytes(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    try {
      return readImage(bitmap);
    } finally {
      bitmap.close?.();
    }
  }

  root.CuimsCaptcha = { read, readImage, readBytes, inkMap, ALPHABET, LENGTH, MIN_SCORE };
})(globalThis);
