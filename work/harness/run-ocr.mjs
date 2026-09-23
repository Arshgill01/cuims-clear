import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CHROME = path.join(ROOT, 'outputs/cuims-clear-chrome');
const CORPUS = path.join(ROOT, 'work/corpus');

// ---- extract named functions verbatim from shipped source, by brace matching ----
function sliceFns(src, names) {
  const out = [];
  for (const name of names) {
    const re = new RegExp(`function ${name}\\s*\\(`);
    const m = re.exec(src);
    if (!m) throw new Error('fn not found: ' + name);
    let i = src.indexOf('{', m.index);
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    out.push(src.slice(m.index, j));
  }
  return out.join('\n\n');
}

const contentSrc = fs.readFileSync(path.join(CHROME, 'content.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(CHROME, 'background.js'), 'utf8');

const preFns = sliceFns(contentSrc, [
  'rgbToGrayscale', 'computeOtsuThreshold', 'isDarkBackground', 'binarizeAndDespeckle',
  'contrastStretchGrayscale', 'findInkBounds', 'cropRgba', 'renderScaledAndPaddedCanvas',
  'extractCaptchaVariants',
]);
const solverFns = sliceFns(bgSrc, [
  'repairGlyphFusions', 'sanitizeCaptchaText', 'scoreCandidate', 'isStrongRead', 'selectBestCandidate',
]);
// pull solver constants
const constMatch = bgSrc.match(/const OEM_LSTM_ONLY[\s\S]*?const CONSENSUS_BONUS = \d+;/);
const solverConsts = constMatch ? constMatch[0] : 'const FAST_PATH_CONFIDENCE=80;const CONSENSUS_BONUS=20;';

// static server for extension assets (vendor tesseract + tessdata)
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/harness.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body><script src="/vendor/tesseract/tesseract.min.js"></script></body></html>`);
    return;
  }
  let file;
  if (p.startsWith('/corpus/')) file = path.join(CORPUS, p.slice('/corpus/'.length));
  else file = path.join(CHROME, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    const ext = path.extname(file);
    const ct = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json',
      '.gz': 'application/gzip', '.jpg': 'image/jpeg', '.png': 'image/png', '.html': 'text/html' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const BASE = `http://localhost:${PORT}`;

const labels = JSON.parse(fs.readFileSync(path.join(CORPUS, 'labels.json'), 'utf8'));
const files = Object.keys(labels);

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.error('PAGE-ERR', m.text()); });
await page.goto(BASE + '/harness.html', { waitUntil: 'load' });
await page.evaluate((base) => { window.__BASE = base; }, BASE);

await page.evaluate(`${preFns}\n${solverConsts}\n${solverFns}\nwindow.__pre=extractCaptchaVariants;window.__sanitize=sanitizeCaptchaText;window.__score=scoreCandidate;window.__isStrong=isStrongRead;window.__selectBest=selectBestCandidate;`);

// build tesseract worker with the SHIPPED params
await page.evaluate(async (base) => {
  window.__worker = await Tesseract.createWorker('eng', 1, {
    workerPath: base + '/vendor/tesseract/worker.min.js',
    corePath: base + '/vendor/tesseract/',
    langPath: base + '/vendor/tessdata/',
    cacheMethod: 'none', workerBlobURL: false, logger: () => {},
  });
  await window.__worker.setParameters({
    tessedit_pageseg_mode: '7',
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    user_defined_dpi: '300',
  });
}, BASE);

// replicate solveCandidates (shipped logic) using the persistent worker
async function solveOne(fileRel) {
  return await page.evaluate(async (url) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const candidates = window.__pre(img);
    const results = [];
    for (let i = 0; i < candidates.length; i++) {
      const dataUrl = candidates[i];
      if (!dataUrl) continue;
      const { data } = await window.__worker.recognize(dataUrl);
      const text = window.__sanitize(data?.text || '');
      const confidence = Number(data?.confidence ?? 0);
      const score = window.__score(text, confidence);
      const result = { text, confidence, score, passIndex: i };
      results.push(result);
      if (i === 0 && window.__isStrong(text, confidence)) return { ...result, agreement: 1 };
      if (results.length >= 2 && text.length >= 4 && text.length <= 6) {
        const agreed = results.filter((it) => it.text === text);
        if (agreed.length >= 2) return window.__selectBest(results);
      }
    }
    return window.__selectBest(results);
  }, BASE + '/corpus/' + fileRel);
}

let exact = 0, n = 0;
const fails = [];
const t0 = Date.now();
for (const f of files) {
  const gt = labels[f];
  let best;
  try { best = await solveOne(f); } catch (e) { best = { text: 'ERR:' + e.message }; }
  const got = (best?.text || '').trim();
  n++;
  if (got === gt) exact++;
  else fails.push({ f, gt, got, conf: best?.confidence });
}
const dt = Date.now() - t0;
console.log(`\n=== BASELINE (shipped pipeline) ===`);
console.log(`Exact case-sensitive: ${exact}/${n} = ${(100 * exact / n).toFixed(1)}%`);
console.log(`Avg ${(dt / n).toFixed(0)} ms/image (incl. puppeteer round-trip)`);
console.log(`\nFailures (${fails.length}):`);
for (const x of fails) console.log(`  ${x.f}  gt=${x.gt}  got=${JSON.stringify(x.got)} conf=${x.conf?.toFixed?.(0)}`);

await browser.close();
server.close();
