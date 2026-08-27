import assert from "node:assert/strict";
import test from "node:test";

import { validatePromptPlan } from "../dist/validate.js";

function expectCode(input, code) {
  assert.throws(
    () => validatePromptPlan(input),
    (error) => error?.code === code
  );
}

test("validation rejects duplicate section IDs", () => {
  expectCode({
    schemaVersion: "1",
    id: "duplicate",
    version: "1",
    sections: [
      { id: "same", lane: "instructions", stability: "global", items: [{ role: "system", content: "a" }] },
      { id: "same", lane: "instructions", stability: "global", items: [{ role: "system", content: "b" }] }
    ]
  }, "CC_DUPLICATE_SECTION_ID");
});

test("validation rejects a user role in the instruction lane", () => {
  expectCode({
    schemaVersion: "1",
    id: "lane",
    version: "1",
    sections: [
      { id: "bad", lane: "instructions", stability: "global", items: [{ role: "user", content: "a" }] }
    ]
  }, "CC_ROLE_LANE_MISMATCH");
});

test("validation rejects unknown dependencies", () => {
  expectCode({
    schemaVersion: "1",
    id: "unknown",
    version: "1",
    sections: [
      {
        id: "a",
        lane: "instructions",
        stability: "global",
        after: ["missing"],
        items: [{ role: "system", content: "a" }]
      }
    ]
  }, "CC_UNKNOWN_DEPENDENCY");
});

test("validation rejects dependency cycles", () => {
  expectCode({
    schemaVersion: "1",
    id: "cycle",
    version: "1",
    sections: [
      {
        id: "a",
        lane: "instructions",
        stability: "global",
        after: ["b"],
        items: [{ role: "system", content: "a" }]
      },
      {
        id: "b",
        lane: "instructions",
        stability: "deployment",
        after: ["a"],
        items: [{ role: "system", content: "b" }]
      }
    ]
  }, "CC_DEPENDENCY_CYCLE");
});

test("validation rejects non-portable tool names", () => {
  expectCode({
    schemaVersion: "1",
    id: "tool-name",
    version: "1",
    tools: [{ name: "not portable", inputSchema: { type: "object" } }],
    sections: [
      { id: "a", lane: "instructions", stability: "global", items: [{ role: "system", content: "a" }] }
    ]
  }, "CC_INVALID_TOOL_NAME");
});

test("validation rejects a non-string $schema value", () => {
  expectCode({
    $schema: 42,
    schemaVersion: "1",
    id: "schema",
    version: "1",
    sections: [
      { id: "policy", lane: "instructions", stability: "global", items: [{ role: "system", content: "a" }] }
    ]
  }, "CC_INVALID_PLAN");
});


test("validation rejects cache keys longer than the portable 64-character limit", () => {
  expectCode({
    schemaVersion: "1",
    id: "cache-key",
    version: "1",
    cacheKey: "x".repeat(65),
    sections: [
      { id: "policy", lane: "instructions", stability: "global", items: [{ role: "system", content: "a" }] }
    ]
  }, "CC_INVALID_CACHE_KEY");
});
