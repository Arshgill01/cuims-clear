import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'outputs/cuims-clear-chrome');
const CORPUS = path.join(ROOT, 'work/corpus');

// Known CAPTCHA to serve + its label (clean sample where Tesseract had a case error).
const CAPTCHA_FILE = path.join(CORPUS, 'raw/c002.jpg'); // Vm2x (baseline read 'vm2x')
const EXPECT = 'Vm2x';
const captchaBytes = fs.readFileSync(CAPTCHA_FILE);

const loginHtml = `<!doctype html><html><head><meta charset="utf-8"><title>CUIMS Login</title></head>
<body>
  <form id="form1" method="post" action="/Login.aspx">
    <input type="text" id="txtUserId" name="txtUserId" value="TEST123" autocomplete="username" />
    <input type="password" id="txtPassword" name="txtPassword" value="secret-pass" />
    <div class="__captcha_value"><img id="imgCaptcha" src="/GenerateCaptcha.aspx?id=1" alt="captcha"></div>
    <input type="text" id="captchaCode" name="captchaCode" placeholder="Enter captcha" />
    <input type="submit" id="btnLogin" name="btnLogin" value="Login" />
  </form>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
});

// wait for the extension service worker to register
let swTarget = null;
for (let i = 0; i < 40 && !swTarget; i++) {
  swTarget = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes('service-worker.js'));
  if (!swTarget) await new Promise(r => setTimeout(r, 250));
}
console.log('service worker registered:', !!swTarget);

const page = await browser.newPage();
page.on('console', m => console.log('PAGE:', m.text()));
page.on('pageerror', e => console.log('PAGEERR:', e.message));
// attach to any worker/offscreen targets for their logs
browser.on('targetcreated', async (t) => {
  try {
    if (t.type() === 'service_worker' || t.type() === 'other' || t.type() === 'background_page') {
      console.log('TARGET:', t.type(), t.url());
    }
  } catch {}
});
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (url.startsWith('https://students.cuchd.in/')) {
    if (/GenerateCaptcha/i.test(url)) return req.respond({ status: 200, contentType: 'image/jpeg', body: captchaBytes });
    if (/StudentHome/i.test(url)) return req.respond({ status: 200, contentType: 'text/html', body: '<html><body>StudentHome</body></html>' });
    // login page (and the auto-submit POST) -> serve the mock login form
    return req.respond({ status: 200, contentType: 'text/html', body: loginHtml });
  }
  return req.continue();
});

await page.goto('https://students.cuchd.in/Login.aspx', { waitUntil: 'domcontentloaded' });

// NOTE: MV3 extension service workers frequently do not start under automated
// Chrome (headless or xvfb), so the offscreen Tesseract solver cannot respond
// here. This script therefore reliably verifies only that the content script
// INJECTS on the real https://students.cuchd.in origin and drives the DOM
// (UID autofill). The solver+preprocessing+corrector correctness is validated
// separately by run-ship.mjs (real Tesseract WASM, shipped functions), and the
// SW->offscreen message plumbing is unchanged from the published build.

// wait for the content script to solve + fill the captcha field
let filled = '';
let placeholder = '';
for (let i = 0; i < 60; i++) {
  const st = await page.evaluate(() => ({ v: document.querySelector('#captchaCode')?.value || '', p: document.querySelector('#captchaCode')?.placeholder || '', complete: document.querySelector('#imgCaptcha')?.complete, nw: document.querySelector('#imgCaptcha')?.naturalWidth }));
  filled = st.v; placeholder = st.p;
  if (filled && filled.length >= 3) break;
  if (i === 6) console.log('after 1.5s:', JSON.stringify(st));
  await new Promise(r => setTimeout(r, 250));
}
// probe solver directly from the page (content-script isolated world can't; use SW target)
const sw = browser.targets().find(t => t.type()==='service_worker');
console.log('sw target url:', sw?.url());
const uidVal = await page.evaluate(() => document.querySelector('#txtUserId')?.value || '');
console.log('UID autofilled:', uidVal);
console.log('CAPTCHA field filled with:', JSON.stringify(filled), '(expected', EXPECT + ')');
console.log(filled === EXPECT ? 'PASS: corrected read matches label' : (filled.toLowerCase() === EXPECT.toLowerCase() ? 'CASE-DIFF: '+filled : 'MISMATCH: '+filled));

await browser.close();
