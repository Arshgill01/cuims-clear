// Loads the shipped captcha solver into Node and the labelled corpus of real
// CUIMS captchas (work/corpus), decoded to RGBA.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import jpeg from "jpeg-js";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_DIR = path.join(ROOT, "outputs/cuims-clear-firefox");
export const CORPUS_DIR = path.join(ROOT, "work/corpus");
export const LABEL_SETS = ["labels.json", "labels-holdout.json", "labels-live.json"];

export function loadSolver() {
  const context = vm.createContext({ Buffer, Math, Float32Array, Uint8Array, Map, Error, Number, String, Array });
  context.globalThis = context;
  for (const file of ["captcha-glyphs.js", "captcha-solver.js"]) {
    vm.runInContext(fs.readFileSync(path.join(PACKAGE_DIR, file), "utf8"), context, { filename: file });
  }
  return context.CuimsCaptcha;
}

export function decode(file) {
  const { data, width, height } = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
  return { data, width, height };
}

export function loadCorpus(sets = LABEL_SETS) {
  const items = [];
  for (const set of sets) {
    const labels = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, set), "utf8"));
    for (const [file, label] of Object.entries(labels)) items.push({ set, file, label, path: path.join(CORPUS_DIR, file) });
  }
  return items;
}
