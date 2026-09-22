import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pageTextIndicatesLockout,
  pageTextIndicatesLoginError,
} from "./login-safety.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures", "login");

function load(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

test("lockout fixture HTML matches lockout detector", () => {
  const html = load("lockout.html");
  assert.equal(pageTextIndicatesLockout(html), true);
  assert.equal(pageTextIndicatesLoginError(html), false);
});

test("invalid captcha fixture HTML matches login-error detector", () => {
  const html = load("invalid-captcha.html");
  assert.equal(pageTextIndicatesLoginError(html), true);
  assert.equal(pageTextIndicatesLockout(html), false);
});

test("invalid password fixture HTML matches login-error detector", () => {
  const html = load("invalid-password.html");
  assert.equal(pageTextIndicatesLoginError(html), true);
  assert.equal(pageTextIndicatesLockout(html), false);
});
