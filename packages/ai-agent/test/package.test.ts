import { test } from "node:test";
import assert from "node:assert/strict";
import pkg from "../package.json";

// Q1 / Q2 / Q3: the published name, license and repository are the ruled ones.
test("package identity follows the owner rulings", () => {
  assert.equal(pkg.name, "@convoso/ai-agent");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.repository.url, "https://github.com/safesoftus/aiagent-sdk");
  assert.equal("private" in pkg, false, "the core publishes (behind the release gate)");
  assert.deepEqual(Object.keys((pkg as { dependencies?: object }).dependencies ?? {}), [], "zero runtime dependencies");
});
