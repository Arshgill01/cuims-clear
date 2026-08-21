import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCaptchaText, scoreCandidate } from "./captcha-engine.mjs";

test("sanitizeCaptchaText removes non-alphanumeric characters and whitespace", () => {
  assert.equal(sanitizeCaptchaText(" aB39k \n"), "aB39k");
  assert.equal(sanitizeCaptchaText("9@X_#4z!"), "9X4z");
  assert.equal(sanitizeCaptchaText(""), "");
  assert.equal(sanitizeCaptchaText(null), "");
});

test("scoreCandidate rewards optimal length (4-6) and penalizes bad lengths", () => {
  const score4 = scoreCandidate("ofh7", 80); // length 4: 80 + 25 = 105
  const score5 = scoreCandidate("aB39k", 80); // length 5: 80 + 25 = 105
  const score6 = scoreCandidate("aB39kX", 80); // length 6: 80 + 25 = 105
  const score3 = scoreCandidate("aB3", 80); // length 3: 80 - 20 = 60
  const score8 = scoreCandidate("aB39kXYZ", 80); // length 8: 80 - 30 = 50

  assert.equal(score4, 105);
  assert.equal(score5, 105);
  assert.equal(score6, 105);
  assert.equal(score3, 60);
  assert.equal(score8, 50);
  assert.ok(score5 > score3);
});

test("scoreCandidate distinguishes between high confidence and bad length", () => {
  const candidateValid = scoreCandidate("ofh7", 75);
  const candidateMalformed = scoreCandidate("K7Np2abc", 85);

  assert.ok(
    candidateValid > candidateMalformed,
    `Valid length candidate (${candidateValid}) should outscore malformed candidate (${candidateMalformed})`,
  );
});
