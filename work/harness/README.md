# CUIMS Clear — CAPTCHA OCR benchmark harness

Runs the **actual shipped** preprocessing (`content.js`) and solver (`background.js`)
against a labelled corpus of real CUIMS CAPTCHA images, inside headless Chrome
with the real vendored Tesseract WASM. This is how the accuracy numbers in the
PR were measured — no mocks, no synthetic glyphs.

## Corpus

Images were fetched from the live endpoint `GenerateCaptcha.aspx` (100×30 JPEG,
fixed bold-serif font, 4 characters) and labelled by hand.

- `../corpus/labels.json` — 70 images (development set, used while tuning).
- `../corpus/labels-holdout.json` — 60 **unseen** images (never used for tuning).
- Images live in `../corpus/raw` (direct fetch) and `../corpus/sess` (session-cookie
  fetch, which surfaces a different, heavier-background pool).

## Run

```sh
cd work/harness
npm install            # puppeteer-core, pngjs
node run-ocr.mjs                       # baseline: shipped pipeline only
node run-ship.mjs labels.json          # shipped pipeline + geometry corrector (dev)
node run-ship.mjs labels-holdout.json  # shipped pipeline + geometry corrector (holdout)
```

## Results (case-sensitive exact match)

| Set      | Baseline (pre-change) | With geometry corrector |
|----------|-----------------------|-------------------------|
| dev (70) | 71.4%                 | **90.0%**               |
| holdout (60) | 58.3%             | **70.0%**               |

Warmed OCR time ≈ 30 ms/image; everything runs on-device (bundled Tesseract).

### What the corrector fixes

The shipped Tesseract read is correct in shape but systematically confuses:

- **case of height-ambiguous letters** (V/v, C/c, S/s, U/u, W/w, X/x, Z/z, O/o) —
  resolved by each glyph's height relative to the line cap height;
- **letter O vs digit 0** — resolved by glyph aspect ratio (round vs oval).

It rebuilds a colour-aware ink mask, splits it into per-glyph columns (splitting
touching glyphs at projection valleys, guided by the character count Tesseract
reports), and only ever adjusts those specific cases. Any other character is left
exactly as read, so a correct read is never corrupted.

### Honest limits

90–95% single-shot on **every** background is not yet reached: dense
checkerboard/cross-hatch backgrounds still produce raw Tesseract shape errors
(e.g. f→E, j→J, L→l) that geometry cannot fix. Closing that gap needs a
purpose-trained local character model for this fixed font, which is the proposed
follow-up. The corrector is a strictly-safe, measured improvement over the
shipped baseline and keeps everything local and fast.
