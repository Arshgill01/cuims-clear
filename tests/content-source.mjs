import { existsSync, readFileSync } from "node:fs";

// The manifest loads captcha-prep.js ahead of content.js in the same content
// script world. Builds that have not split it out yet ship content.js alone.
export function contentSource(build) {
  const root = new URL(`../outputs/cuims-clear-${build}/`, import.meta.url);
  const prep = new URL("captcha-prep.js", root);
  const content = readFileSync(new URL("content.js", root), "utf8");
  return existsSync(prep) ? `${readFileSync(prep, "utf8")}\n${content}` : content;
}
