import { readFileSync } from "node:fs";

// The manifest loads the captcha glyphs and solver ahead of content.js in the
// same content script world, so tests run them together, in that order.
export const CONTENT_SCRIPTS = ["captcha-glyphs.js", "captcha-solver.js", "content.js"];

export function contentSource(build) {
  const root = new URL(`../outputs/cuims-clear-${build}/`, import.meta.url);
  return CONTENT_SCRIPTS.map((name) => readFileSync(new URL(name, root), "utf8")).join("\n");
}
