import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CHROME = path.join(ROOT, 'outputs/cuims-clear-chrome');
const CORPUS = path.join(ROOT, 'work/corpus');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/harness.html') { res.writeHead(200,{'Content-Type':'text/html'}); res.end(`<!doctype html><html><body><script src="/vendor/tesseract/tesseract.min.js"></script></body></html>`); return; }
  let file = p.startsWith('/corpus/') ? path.join(CORPUS, p.slice(8)) : path.join(CHROME, p);
  fs.readFile(file, (err,data)=>{ if(err){res.writeHead(404);res.end('nf');return;} const ext=path.extname(file); const ct={'.js':'text/javascript','.wasm':'application/wasm','.gz':'application/gzip','.jpg':'image/jpeg','.png':'image/png'}[ext]||'application/octet-stream'; res.writeHead(200,{'Content-Type':ct}); res.end(data); });
});
await new Promise(r=>server.listen(0,r));
const BASE = `http://localhost:${server.address().port}`;
const labels = JSON.parse(fs.readFileSync(path.join(CORPUS, process.argv[2]||'labels.json'),'utf8'));
const files = Object.keys(labels);
function sliceFns(src, names){const out=[];for(const name of names){const re=new RegExp(`function ${name}\\s*\\(`);const m=re.exec(src);if(!m)throw new Error('nf '+name);let i=src.indexOf('{',m.index);let depth=0,j=i;for(;j<src.length;j++){if(src[j]==='{')depth++;else if(src[j]==='}'){depth--;if(depth===0){j++;break;}}}out.push(src.slice(m.index,j));}return out.join('\n\n');}
const contentSrc=fs.readFileSync(path.join(CHROME,'content.js'),'utf8');
const bgSrc=fs.readFileSync(path.join(CHROME,'background.js'),'utf8');
// pull the exact shipped functions, including the new corrector
const preFns=sliceFns(contentSrc,['rgbToGrayscale','computeOtsuThreshold','isDarkBackground','binarizeAndDespeckle','contrastStretchGrayscale','findInkBounds','cropRgba','renderScaledAndPaddedCanvas','extractCaptchaVariants','buildCaptchaMask','segmentGlyphColumns','correctCaptchaCase']);
const geomConst='const GEOM_CASELESS = new Set("cCoOsSuUvVwWxXzZ".split(""));';
const solverFns=sliceFns(bgSrc,['repairGlyphFusions','sanitizeCaptchaText','scoreCandidate','isStrongRead','selectBestCandidate']);
const solverConsts=(bgSrc.match(/const OEM_LSTM_ONLY[\s\S]*?const CONSENSUS_BONUS = \d+;/)||[''])[0];
const browser = await puppeteer.launch({ executablePath:'/usr/local/bin/google-chrome', headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('console', m=>{ if(m.type()==='error') console.error('PAGE-ERR',m.text()); });
await page.goto(BASE+'/harness.html',{waitUntil:'load'});
await page.evaluate(`
${geomConst}
${preFns}
${solverConsts}
${solverFns}
window.__pre=extractCaptchaVariants;window.__correct=correctCaptchaCase;window.__sanitize=sanitizeCaptchaText;window.__score=scoreCandidate;window.__isStrong=isStrongRead;window.__selectBest=selectBestCandidate;
`);
await page.evaluate(async (base)=>{
  window.__worker=await Tesseract.createWorker('eng',1,{workerPath:base+'/vendor/tesseract/worker.min.js',corePath:base+'/vendor/tesseract/',langPath:base+'/vendor/tessdata/',cacheMethod:'none',workerBlobURL:false,logger:()=>{}});
  await window.__worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',user_defined_dpi:'300'});
},BASE);
async function solve(url){
  return await page.evaluate(async(url)=>{
    const img=new Image();img.crossOrigin='anonymous';await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=url;});
    const candidates=window.__pre(img);
    const results=[];let chosen=null;
    for(let i=0;i<candidates.length;i++){const {data}=await window.__worker.recognize(candidates[i]);const text=window.__sanitize(data?.text||'');const confidence=Number(data?.confidence??0);const score=window.__score(text,confidence);const result={text,confidence,score,passIndex:i};results.push(result);if(i===0&&window.__isStrong(text,confidence)){chosen={...result,agreement:1};break;}if(results.length>=2&&text.length>=4&&text.length<=6){const agreed=results.filter(it=>it.text===text);if(agreed.length>=2){chosen=window.__selectBest(results);break;}}}
    if(!chosen)chosen=window.__selectBest(results);
    if(!chosen)return {raw:'',corr:''};
    const raw=chosen.text; const corr=window.__correct(raw,img);
    return {raw,corr};
  },url);
}
let raw=0,corr=0,n=0;const fails=[];const t0=Date.now();
for(const f of files){const r=await solve(BASE+'/corpus/'+f);const gt=labels[f];n++;if(r.raw===gt)raw++;if(r.corr===gt)corr++;else fails.push(`${f} gt=${gt} raw=${r.raw} corr=${r.corr}`);}
const dt=Date.now()-t0;
console.log(`SHIPPED path [${process.argv[2]||'labels.json'}]: raw ${raw}/${n}=${(100*raw/n).toFixed(1)}%  CORRECTED ${corr}/${n}=${(100*corr/n).toFixed(1)}%  ${(dt/n).toFixed(0)}ms/img`);
if(process.env.V)fails.forEach(x=>console.log('  ',x));
await browser.close();server.close();
