// The shipped captcha solver against every labelled real CUIMS captcha.
import test from "node:test";
import assert from "node:assert/strict";
import { loadSolver, loadCorpus, decode } from "./captcha-corpus.mjs";

const solver = loadSolver();
const corpus = loadCorpus();
const results = corpus.map((item) => {
  const { data, width, height } = decode(item.path);
  return { ...item, read: solver.read(data, width, height) };
});

test("the corpus is large and varied enough to mean something", () => {
  assert.ok(results.length >= 500, `${results.length} captchas`);
  assert.ok(new Set(results.map((r) => r.label)).size >= 400);
  const seen = new Set(results.flatMap((r) => [...r.label]));
  assert.equal(seen.size, 62, `characters covered: ${seen.size}/62`);
});

test("reads every labelled captcha exactly, case included", () => {
  const wrong = results.filter((r) => r.read.text !== r.label).map((r) => `${r.file}: want ${r.label} got ${r.read.text}`);
  const rate = 1 - wrong.length / results.length;
  console.log(`exact: ${results.length - wrong.length}/${results.length} = ${(rate * 100).toFixed(2)}%`);
  assert.ok(rate >= 0.99, wrong.join("\n"));
});

test("is confident on every real captcha and never confidently wrong", () => {
  const unsure = results.filter((r) => !r.read.confident);
  const confidentlyWrong = results.filter((r) => r.read.confident && r.read.text !== r.label);
  const scores = results.map((r) => r.read.score).sort((a, b) => a - b);
  console.log(`whole-image score: min ${scores[0].toFixed(3)} p1 ${scores[Math.floor(scores.length / 100)].toFixed(3)}`);
  assert.deepEqual(confidentlyWrong.map((r) => r.file), []);
  assert.ok(unsure.length <= results.length * 0.01, unsure.map((r) => r.file).join(", "));
});

test("always answers exactly four characters from the captcha alphabet", () => {
  for (const r of results) assert.match(r.read.text, /^[A-Za-z0-9]{4}$/, r.file);
});

test("refuses images that are not a CUIMS captcha", () => {
  const blank = new Uint8ClampedArray(100 * 30 * 4).fill(255);
  assert.equal(solver.read(blank, 100, 30).confident, false);
  const wrongSize = new Uint8ClampedArray(120 * 40 * 4).fill(0);
  assert.equal(solver.read(wrongSize, 120, 40).confident, false);
  const noise = new Uint8ClampedArray(100 * 30 * 4);
  let seed = 7;
  for (let i = 0; i < noise.length; i++) noise[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
  assert.equal(solver.read(noise, 100, 30).confident, false);
});

test("reads in well under a frame budget per captcha", () => {
  const { data, width, height } = decode(results[0].path);
  const start = performance.now();
  for (let i = 0; i < 20; i++) solver.read(data, width, height);
  const each = (performance.now() - start) / 20;
  console.log(`${each.toFixed(1)} ms per captcha`);
  assert.ok(each < 150, `${each} ms`);
});

// Headroom beyond what CUIMS serves today. Whatever happens to the image, the
// solver may be unsure, but it must never be confidently wrong: a confident
// read is submitted without a person looking, and every refusal counts
// towards CUIMS's lockout.
test("under shifts, noise, harsh JPEG and faded ink it is never confidently wrong", async () => {
  const { default: jpeg } = await import("jpeg-js");
  const sample = results.filter((r) => r.set === "labels-live.json").slice(0, 60);
  let seed = 1;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-9)) * Math.cos(2 * Math.PI * random());
  const shift = (d, dx, dy) => {
    const out = new Uint8ClampedArray(d.length).fill(255);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 100; x++) {
      const sx = x - dx, sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= 100 || sy >= 30) continue;
      for (let c = 0; c < 4; c++) out[(y * 100 + x) * 4 + c] = d[(sy * 100 + sx) * 4 + c];
    }
    return out;
  };
  const colour = (fn) => (d) => d.map((v, i) => (i % 4 === 3 ? v : fn(v)));
  const variants = {
    "2 px right": (d) => shift(d, 2, 0),
    "2 px down": (d) => shift(d, 0, 2),
    "1 px up-left": (d) => shift(d, -1, -1),
    "noise": colour((v) => v + gauss() * 30),
    "jpeg q30": (d) => jpeg.decode(jpeg.encode({ data: d, width: 100, height: 30 }, 30).data, { useTArray: true, formatAsRGBA: true }).data,
    "faded ink": colour((v) => 255 - (255 - v) * 0.6),
    "darker background": colour((v) => v - 40),
  };
  for (const [name, change] of Object.entries(variants)) {
    let exact = 0;
    const confidentlyWrong = [];
    for (const r of sample) {
      const { data } = decode(r.path);
      const read = solver.read(new Uint8ClampedArray(change(new Uint8ClampedArray(data))), 100, 30);
      if (read.text === r.label) exact += 1;
      else if (read.confident) confidentlyWrong.push(`${r.file}: ${r.label} read as ${read.text}`);
    }
    assert.deepEqual(confidentlyWrong, [], name);
    assert.ok(exact >= sample.length * 0.95, `${name}: ${exact}/${sample.length}`);
  }
});

test("settles 1 against l on the pixels where they differ, by a wide margin", () => {
  const ones = results.filter((r) => /[1l]/.test(r.label));
  assert.ok(ones.length >= 40, `${ones.length} captchas with 1 or l`);
  for (const r of ones) {
    for (const cell of r.read.cells) {
      if (cell.decisive !== Infinity) assert.ok(cell.decisive >= 0.1, `${r.file} ${cell.ch}/${cell.next} ${cell.decisive}`);
    }
  }
});
