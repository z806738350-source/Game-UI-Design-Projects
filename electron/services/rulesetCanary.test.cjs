const test = require("node:test");
const assert = require("node:assert/strict");

test("ruleset canary: this failure is intentional for gate verification", () => {
  assert.fail("intentional failure to verify required status checks block merging");
});
