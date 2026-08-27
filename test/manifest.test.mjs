import assert from "node:assert/strict";
import test from "node:test";

import {
  compilePromptPlan,
  diffManifests,
  validateManifest
} from "../dist/index.js";
import { sha256Hex } from "../dist/hash.js";

function makePlan(schema) {
  return {
    schemaVersion: "1",
    id: "manifest",
    version: "1",
    model: "example-model",
    tools: [
      { name: "zeta", description: "z", inputSchema: schema },
      { name: "alpha", description: "a", inputSchema: { type: "object", properties: {} } }
    ],
    sections: [
      {
        id: "policy",
        lane: "instructions",
        stability: "global",
        cache: { mode: "required", horizon: "long" },
        items: [{ role: "system", content: "Stable policy ".repeat(400) }]
      },
      {
        id: "request",
        lane: "conversation",
        stability: "request",
        items: [{ role: "user", content: "What changed?" }]
      }
    ]
  };
}

test("manifest and cache key are deterministic across object key order", () => {
  const left = compilePromptPlan(makePlan({
    type: "object",
    properties: { b: { type: "number" }, a: { type: "string" } }
  }), { provider: "generic" });

  const right = compilePromptPlan(makePlan({
    properties: { a: { type: "string" }, b: { type: "number" } },
    type: "object"
  }), { provider: "generic" });

  assert.equal(left.manifest.contractHash, right.manifest.contractHash);
  assert.equal(left.manifest.cacheKey, right.manifest.cacheKey);
  assert.deepEqual(left.manifest.toolNames, ["alpha", "zeta"]);
  assert.equal(JSON.stringify(left.payload), JSON.stringify(right.payload));
});

test("derived cache key stays stable when request content changes", () => {
  const before = makePlan({ type: "object", properties: {} });
  delete before.model;
  const after = structuredClone(before);
  after.sections[1].items[0].content = "A different request";

  const left = compilePromptPlan(before, { provider: "generic" });
  const right = compilePromptPlan(after, { provider: "generic" });

  assert.equal(left.manifest.cacheKey, right.manifest.cacheKey);
  assert.notEqual(left.manifest.compiledPromptHash, right.manifest.compiledPromptHash);
});

test("stable prefix hash tracks rendered prefix content, not planning metadata", () => {
  const before = makePlan({ type: "object", properties: {} });
  const after = structuredClone(before);
  after.sections[0].order = "preserve";
  after.sections[0].before = ["request"];

  const left = compilePromptPlan(before, { provider: "generic" });
  const right = compilePromptPlan(after, { provider: "generic" });

  assert.equal(left.manifest.stablePrefixHash, right.manifest.stablePrefixHash);
  assert.equal(left.manifest.contractHash, right.manifest.contractHash);
});

test("contract records provider cache configuration", () => {
  const explicit = makePlan({ type: "object", properties: {} });
  const implicit = structuredClone(explicit);
  implicit.providerOptions = { openai: { mode: "implicit" } };

  const left = compilePromptPlan(explicit, { provider: "openai-responses" });
  const right = compilePromptPlan(implicit, { provider: "openai-responses" });

  assert.deepEqual(left.manifest.providerConfiguration, { mode: "explicit", ttl: "30m" });
  assert.deepEqual(right.manifest.providerConfiguration, { mode: "implicit", ttl: "30m" });
  assert.notEqual(left.manifest.contractHash, right.manifest.contractHash);
});

test("tool schema changes are visible even when no breakpoint is selected", () => {
  const before = makePlan({ type: "object", properties: { query: { type: "string" } } });
  before.sections[0].cache = { mode: "never", horizon: "short" };
  const after = makePlan({ type: "object", properties: { query: { type: "number" } } });
  after.sections[0].cache = { mode: "never", horizon: "short" };

  const left = compilePromptPlan(before, { provider: "generic" });
  const right = compilePromptPlan(after, { provider: "generic" });

  assert.notEqual(left.manifest.toolsHash, right.manifest.toolsHash);
  assert.notEqual(left.manifest.contractHash, right.manifest.contractHash);
});

test("manifest validation rejects malformed hash and provider fields", () => {
  const valid = compilePromptPlan(makePlan({ type: "object", properties: {} }), { provider: "generic" }).manifest;

  assert.throws(
    () => validateManifest({ ...valid, toolsHash: "bad" }),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
  assert.throws(
    () => validateManifest({ ...valid, provider: "unknown" }),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});

test("manifest validation rejects contract tampering", () => {
  const manifest = compilePromptPlan(makePlan({ type: "object", properties: {} }), {
    provider: "generic"
  }).manifest;
  const tampered = structuredClone(manifest);
  tampered.cacheKey = "attacker-controlled";

  assert.throws(
    () => validateManifest(tampered),
    (error) => error?.code === "CC_MANIFEST_HASH_MISMATCH"
  );
});

test("manifest validation rejects unknown fields even with a recomputed hash", () => {
  const manifest = compilePromptPlan(makePlan({ type: "object", properties: {} }), {
    provider: "generic"
  }).manifest;
  const malformed = { ...manifest, unexpected: true };
  malformed.contractHash = sha256Hex(Object.fromEntries(
    Object.entries(malformed).filter(([key]) => key !== "contractHash")
  ));

  assert.throws(
    () => validateManifest(malformed),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});

test("manifest diff reports cache-key and provider-managed boundary changes", () => {
  const implicit = makePlan({ type: "object", properties: {} });
  implicit.model = "gpt-5.6";
  implicit.providerOptions = { openai: { mode: "implicit" } };

  const before = compilePromptPlan(implicit, {
    provider: "openai-responses",
    cacheKey: "session:a"
  }).manifest;
  const after = compilePromptPlan(implicit, {
    provider: "openai-responses",
    cacheKey: "session:b"
  }).manifest;
  after.providerManagedBreakpoint.prefixHash = "f".repeat(64);
  after.contractHash = sha256Hex(Object.fromEntries(
    Object.entries(after).filter(([key]) => key !== "contractHash")
  ));

  const diff = diffManifests(before, after);

  assert.equal(diff.cacheKeyChanged, true);
  assert.equal(diff.providerManagedBreakpointChanged, true);
});

function rehash(manifest) {
  manifest.contractHash = sha256Hex(Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "contractHash")
  ));
  return manifest;
}

test("manifest validation enforces provider-specific explicit TTLs", () => {
  const generic = compilePromptPlan(makePlan({ type: "object", properties: {} }), {
    provider: "generic"
  }).manifest;
  generic.breakpoints[0].providerTtl = "30m";
  rehash(generic);

  assert.throws(
    () => validateManifest(generic),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );

  const anthropicPlan = makePlan({ type: "object", properties: {} });
  anthropicPlan.maxTokens = 64;
  const anthropic = compilePromptPlan(anthropicPlan, { provider: "anthropic" }).manifest;
  anthropic.breakpoints[0].providerTtl = "5m";
  rehash(anthropic);

  assert.throws(
    () => validateManifest(anthropic),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});

test("manifest validation enforces provider-managed boundary semantics", () => {
  const openaiPlan = makePlan({ type: "object", properties: {} });
  openaiPlan.model = "gpt-5.6";
  openaiPlan.providerOptions = { openai: { mode: "implicit" } };
  const openai = compilePromptPlan(openaiPlan, { provider: "openai-responses" }).manifest;
  openai.providerManagedBreakpoint.status = "no-op";
  rehash(openai);

  assert.throws(
    () => validateManifest(openai),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );

  const anthropicPlan = makePlan({ type: "object", properties: {} });
  anthropicPlan.maxTokens = 64;
  anthropicPlan.providerOptions = {
    anthropic: { automatic: true, automaticHorizon: "short" }
  };
  const anthropic = compilePromptPlan(anthropicPlan, { provider: "anthropic" }).manifest;
  anthropic.providerManagedBreakpoint.horizon = "long";
  anthropic.providerManagedBreakpoint.providerTtl = "1h";
  rehash(anthropic);

  assert.throws(
    () => validateManifest(anthropic),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});

test("manifest validation requires an Anthropic automatic boundary", () => {
  const plan = makePlan({ type: "object", properties: {} });
  plan.maxTokens = 64;
  plan.providerOptions = { anthropic: { automatic: true, automaticHorizon: "short" } };
  const manifest = compilePromptPlan(plan, { provider: "anthropic" }).manifest;
  manifest.providerManagedBreakpoint = null;
  rehash(manifest);

  assert.throws(
    () => validateManifest(manifest),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});

test("manifest validation enforces the effective explicit breakpoint budget", () => {
  const plan = makePlan({ type: "object", properties: {} });
  plan.sections = [0, 1, 2, 3].map((index) => ({
    id: `section-${index}`,
    lane: index === 3 ? "conversation" : "instructions",
    stability: ["global", "deployment", "session", "request"][index],
    cache: { mode: "required", horizon: "long" },
    items: [{
      role: index === 3 ? "user" : "developer",
      content: `section ${index} `.repeat(400)
    }]
  }));
  const manifest = compilePromptPlan(plan, { provider: "generic" }).manifest;
  manifest.provider = "openai-responses";
  manifest.providerConfiguration = { mode: "implicit", ttl: "30m" };
  manifest.model = "gpt-5.6";
  for (const breakpoint of manifest.breakpoints) {
    breakpoint.providerTtl = "30m";
  }
  rehash(manifest);

  assert.throws(
    () => validateManifest(manifest),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});

test("manifest diff explains compiler plan source-order and estimate changes", () => {
  const before = compilePromptPlan(makePlan({ type: "object", properties: {} }), {
    provider: "generic"
  }).manifest;
  const after = structuredClone(before);
  after.compiler.version = "0.2.0";
  after.planId = "other-plan";
  after.planVersion = "2";
  after.sourceOrder = [...after.sourceOrder].reverse();
  after.estimatedInputTokens += 1;
  rehash(after);

  const diff = diffManifests(before, after);
  assert.equal(diff.compilerChanged, true);
  assert.equal(diff.planIdChanged, true);
  assert.equal(diff.planVersionChanged, true);
  assert.equal(diff.sourceOrderChanged, true);
  assert.equal(diff.estimatedInputTokensChanged, true);
});


test("manifest validation rejects cache keys longer than 64 characters even with a valid hash", () => {
  const manifest = compilePromptPlan(makePlan({ type: "object", properties: {} }), {
    provider: "generic"
  }).manifest;
  manifest.cacheKey = "x".repeat(65);
  rehash(manifest);

  assert.throws(
    () => validateManifest(manifest),
    (error) => error?.code === "CC_INVALID_MANIFEST"
  );
});
