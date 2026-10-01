// The shipped solver in real Chrome and Firefox, over every labelled captcha:
// each browser's own JPEG decoder, canvas and createImageBitmap, through
// CuimsCaptcha.readBytes (the background sign-in's path) and readImage on an
// <img> (the login page's path).
//   node solver-browsers.mjs [chrome|firefox ...]
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { launchFirefox } from "./ff-launch.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const PACKAGE = path.join(ROOT, "outputs/cuims-clear-firefox");
const CORPUS = path.join(ROOT, "work/corpus");
const labels = Object.assign({}, ...["labels.json", "labels-holdout.json", "labels-live.json"].map((f) => JSON.parse(readFileSync(path.join(CORPUS, f), "utf8"))));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(`<!doctype html><script src="/pkg/captcha-glyphs.js"></script><script src="/pkg/captcha-solver.js"></script>`);
  }
  const file = url.startsWith("/pkg/") ? path.join(PACKAGE, url.slice(5)) : path.join(CORPUS, url.slice(1));
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "image/jpeg" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let failed = false;
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ["chrome", "firefox"]) {
  const browser = name === "firefox"
    ? await launchFirefox()
    : await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, pipe: true });
  const page = await browser.newPage();
  await page.goto(base + "/", { waitUntil: "load" });
  const result = await page.evaluate(async (labels) => {
    const out = { bytes: 0, image: 0, confident: 0, wrong: [], ms: 0, n: 0 };
    const start = performance.now();
    for (const [file, label] of Object.entries(labels)) {
      const bytes = await (await fetch("/" + file)).arrayBuffer();
      const fromBytes = await CuimsCaptcha.readBytes(bytes);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = "/" + file; });
      const fromImage = CuimsCaptcha.readImage(img);
      out.n += 1;
      if (fromBytes.text === label) out.bytes += 1;
      if (fromImage.text === label) out.image += 1;
      if (fromBytes.confident && fromImage.confident) out.confident += 1;
      if (fromBytes.text !== label || fromImage.text !== label) out.wrong.push(`${file}: want ${label} bytes ${fromBytes.text} image ${fromImage.text}`);
    }
    out.ms = Math.round((performance.now() - start) / out.n);
    return out;
  }, labels);
  const pct = (x) => ((100 * x) / result.n).toFixed(2);
  console.log(`${name}: readBytes ${result.bytes}/${result.n} (${pct(result.bytes)}%)  readImage ${result.image}/${result.n} (${pct(result.image)}%)  confident ${result.confident}/${result.n}  ~${result.ms} ms per captcha (both reads + fetch)`);
  for (const line of result.wrong) console.log("   ", line);
  if (result.wrong.length) failed = true;
  await browser.close().catch(() => {});
  browser.__kill?.();
}
server.close();
process.exit(failed ? 1 : 0);
