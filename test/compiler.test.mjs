import assert from "node:assert/strict";
import test from "node:test";

import { compilePromptPlan, diffManifests, explainCompilation } from "../dist/index.js";

const plan = {
  schemaVersion: "1",
  id: "compiler",
  version: "1",
  model: "gpt-5.6",
  sections: [
    {
      id: "stable",
      lane: "instructions",
      stability: "global",
      cache: { mode: "required", horizon: "long" },
      items: [{ role: "developer", content: "Stable ".repeat(600) }]
    },
    {
      id: "request",
      lane: "conversation",
      stability: "request",
      items: [{ role: "user", content: "Hello" }]
    }
  ]
};

test("compilePromptPlan is deterministic across repeated compilation", () => {
  const first = compilePromptPlan(plan, { provider: "openai-responses" });
  const second = compilePromptPlan(structuredClone(plan), { provider: "openai-responses" });

  assert.deepEqual(first, second);
});

test("diffManifests reports contract changes", () => {
  const before = compilePromptPlan(plan, { provider: "generic" }).manifest;
  const after = compilePromptPlan({
    ...plan,
    version: "2",
    sections: plan.sections.map((section) => section.id === "stable"
      ? { ...section, items: [{ role: "developer", content: "Changed stable policy ".repeat(600) }] }
      : section)
  }, { provider: "generic" }).manifest;

  const diff = diffManifests(before, after);

  assert.equal(diff.changed, true);
  assert.equal(diff.contractHashChanged, true);
  assert.equal(diff.stablePrefixHashChanged, true);
});

test("explainCompilation includes order, breakpoints, and contract hash", () => {
  const result = compilePromptPlan(plan, { provider: "generic" });
  const text = explainCompilation(result);

  assert.match(text, /Compiled order/);
  assert.match(text, /stable/);
  assert.match(text, /Contract hash/);
});

test("compilePromptPlan rejects unsupported provider values from JavaScript callers", () => {
  assert.throws(
    () => compilePromptPlan(plan, { provider: "not-a-provider" }),
    (error) => error?.code === "CC_UNSUPPORTED_PROVIDER"
  );
});

test("compile-time cache keys override plan and derived keys", () => {
  const input = structuredClone(plan);
  delete input.cacheKey;

  const derived = compilePromptPlan(input, { provider: "generic" });
  const overridden = compilePromptPlan(input, {
    provider: "generic",
    cacheKey: "session:customer-42"
  });

  assert.match(derived.manifest.cacheKey, /^cc:/);
  assert.equal(derived.manifest.cacheKeySource, "derived");
  assert.equal(overridden.manifest.cacheKey, "session:customer-42");
  assert.equal(overridden.manifest.cacheKeySource, "compile-option");
  assert.equal(overridden.payload.cache_key, "session:customer-42");
});

test("compilePromptPlan rejects empty cache-key overrides", () => {
  assert.throws(
    () => compilePromptPlan(plan, { provider: "generic", cacheKey: "  " }),
    (error) => error?.code === "CC_INVALID_COMPILE_OPTIONS"
  );
});


test("compilePromptPlan rejects cache-key overrides longer than 64 characters", () => {
  assert.throws(
    () => compilePromptPlan(plan, { provider: "generic", cacheKey: "x".repeat(65) }),
    (error) => error?.code === "CC_INVALID_COMPILE_OPTIONS"
  );
});
