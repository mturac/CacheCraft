import assert from "node:assert/strict";
import test from "node:test";

import { compilePromptPlan } from "../dist/index.js";

const plan = {
  schemaVersion: "1",
  id: "providers",
  version: "1",
  model: "provider-model",
  maxTokens: 1024,
  cacheKey: "provider:test",
  tools: [
    {
      name: "search",
      description: "Search docs",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      }
    }
  ],
  sections: [
    {
      id: "policy",
      lane: "instructions",
      stability: "global",
      cache: { mode: "required", horizon: "long" },
      items: [{ role: "developer", content: "Policy text ".repeat(400) }]
    },
    {
      id: "session-context",
      lane: "instructions",
      stability: "session",
      cache: { mode: "required", horizon: "short" },
      items: [{ role: "developer", content: "Session context ".repeat(100) }]
    },
    {
      id: "request",
      lane: "conversation",
      stability: "request",
      items: [{ role: "user", content: "Answer this request." }]
    }
  ]
};

test("OpenAI Responses payload marks the final text block of selected sections", () => {
  const result = compilePromptPlan(plan, { provider: "openai-responses" });
  const payload = result.payload;

  assert.equal(payload.prompt_cache_key, "provider:test");
  assert.deepEqual(payload.prompt_cache_options, { mode: "explicit", ttl: "30m" });
  assert.equal(payload.input[0].content[0].prompt_cache_breakpoint.mode, "explicit");
  assert.equal(payload.input[1].content[0].prompt_cache_breakpoint.mode, "explicit");
  assert.equal(payload.input[2].content[0].prompt_cache_breakpoint, undefined);
  assert.equal(payload.tools[0].name, "search");
  assert.equal(result.diagnostics.some((entry) => entry.code === "CC103_CACHE_HORIZON_COLLAPSED"), true);
});

test("OpenAI Chat payload uses text content blocks and function wrappers", () => {
  const result = compilePromptPlan(plan, { provider: "openai-chat" });
  const payload = result.payload;

  assert.equal(payload.messages[0].content[0].type, "text");
  assert.equal(payload.messages[0].content[0].prompt_cache_breakpoint.mode, "explicit");
  assert.equal(payload.tools[0].type, "function");
  assert.equal(payload.tools[0].function.name, "search");
});

test("Anthropic payload separates system content and maps long then short TTLs", () => {
  const result = compilePromptPlan(plan, { provider: "anthropic" });
  const payload = result.payload;

  assert.equal(payload.system.length, 2);
  assert.deepEqual(payload.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(payload.system[1].cache_control, { type: "ephemeral" });
  assert.equal(payload.messages[0].role, "user");
  assert.equal(payload.tools[0].input_schema.type, "object");
});

test("generic payload retains logical breakpoint metadata", () => {
  const result = compilePromptPlan(plan, { provider: "generic" });

  assert.deepEqual(
    result.payload.cache.breakpoints.map((entry) => entry.horizon),
    ["long", "short"]
  );
});

test("maxTokens maps to each provider request field", () => {
  const responses = compilePromptPlan(plan, { provider: "openai-responses" }).payload;
  const chat = compilePromptPlan(plan, { provider: "openai-chat" }).payload;
  const generic = compilePromptPlan(plan, { provider: "generic" }).payload;

  assert.equal(responses.max_output_tokens, 1024);
  assert.equal(chat.max_completion_tokens, 1024);
  assert.equal(generic.max_tokens, 1024);
});

test("provider-specific rendering rejects missing required request fields", () => {
  const withoutModel = structuredClone(plan);
  delete withoutModel.model;
  assert.throws(
    () => compilePromptPlan(withoutModel, { provider: "openai-responses" }),
    (error) => error?.code === "CC_MODEL_REQUIRED"
  );

  const withoutMaxTokens = structuredClone(plan);
  delete withoutMaxTokens.maxTokens;
  assert.throws(
    () => compilePromptPlan(withoutMaxTokens, { provider: "anthropic" }),
    (error) => error?.code === "CC_ANTHROPIC_MAX_TOKENS_REQUIRED"
  );
});

test("OpenAI adapters reject known pre-5.6 models and flag unknown aliases", () => {
  const unsupported = structuredClone(plan);
  unsupported.model = "gpt-5.5";
  assert.throws(
    () => compilePromptPlan(unsupported, { provider: "openai-responses" }),
    (error) => error?.code === "CC_OPENAI_BREAKPOINT_MODEL_UNSUPPORTED"
  );

  const unknown = structuredClone(plan);
  unknown.model = "company-model-alias";
  const result = compilePromptPlan(unknown, { provider: "openai-chat" });
  assert.equal(
    result.diagnostics.some((entry) => entry.code === "CC108_OPENAI_MODEL_CAPABILITY_UNVERIFIED"),
    true
  );
});

test("OpenAI implicit mode warns when its provider-managed boundary includes request data", () => {
  const implicit = structuredClone(plan);
  implicit.providerOptions = { openai: { mode: "implicit" } };

  const result = compilePromptPlan(implicit, { provider: "openai-responses" });

  assert.equal(
    result.diagnostics.some((entry) => entry.code === "CC109_IMPLICIT_CACHE_INCLUDES_VOLATILE_SUFFIX"),
    true
  );
  assert.equal(result.manifest.providerManagedBreakpoint?.mode, "openai-implicit");
  assert.equal(result.manifest.providerManagedBreakpoint?.sectionId, "request");
});

test("OpenAI compilation warns when a plan-wide derived cache key is not explicitly partitioned", () => {
  const input = structuredClone(plan);
  delete input.cacheKey;

  const result = compilePromptPlan(input, { provider: "openai-responses" });

  assert.equal(result.manifest.cacheKeySource, "derived");
  assert.equal(
    result.diagnostics.some((entry) => entry.code === "CC110_DERIVED_CACHE_KEY_UNSHARDED"),
    true
  );
});

test("Anthropic automatic caching records its managed boundary", () => {
  const input = structuredClone(plan);
  input.providerOptions = {
    anthropic: { automatic: true, automaticHorizon: "short" }
  };

  const result = compilePromptPlan(input, { provider: "anthropic" });

  assert.equal(result.manifest.providerManagedBreakpoint?.mode, "anthropic-automatic");
  assert.equal(result.manifest.providerManagedBreakpoint?.sectionId, "request");
  assert.equal(result.manifest.providerManagedBreakpoint?.status, "active");
});

test("Anthropic automatic caching is recorded as a no-op at an identical final explicit boundary", () => {
  const input = structuredClone(plan);
  input.sections[2].cache = { mode: "required", horizon: "short" };
  input.providerOptions = {
    anthropic: { automatic: true, automaticHorizon: "short" }
  };

  const result = compilePromptPlan(input, { provider: "anthropic" });

  assert.equal(result.manifest.breakpoints.length, 3);
  assert.equal(result.manifest.providerManagedBreakpoint?.status, "no-op");
  assert.equal(result.manifest.providerManagedBreakpoint?.sectionId, "request");
});

test("Anthropic automatic no-op permits four required explicit breakpoints", () => {
  const input = structuredClone(plan);
  input.sections.splice(1, 0, {
    id: "deployment-context",
    lane: "instructions",
    stability: "deployment",
    cache: { mode: "required", horizon: "long" },
    items: [{ role: "developer", content: "Deployment context" }]
  });
  input.sections[3].cache = { mode: "required", horizon: "short" };
  input.providerOptions = {
    anthropic: { automatic: true, automaticHorizon: "short" }
  };

  const result = compilePromptPlan(input, { provider: "anthropic" });

  assert.equal(result.manifest.breakpoints.length, 4);
  assert.equal(result.manifest.providerManagedBreakpoint?.status, "no-op");
});

test("Anthropic automatic caching replaces a redundant preferred final breakpoint", () => {
  const input = structuredClone(plan);
  input.sections[2].cache = { mode: "preferred", horizon: "short" };
  input.providerOptions = {
    anthropic: { automatic: true, automaticHorizon: "short" }
  };

  const result = compilePromptPlan(input, { provider: "anthropic" });

  assert.equal(result.manifest.breakpoints.some((entry) => entry.sectionId === "request"), false);
  assert.equal(result.manifest.providerManagedBreakpoint?.status, "active");
  assert.equal(
    result.diagnostics.some((entry) => entry.code === "CC112_AUTOMATIC_BREAKPOINT_REPLACED"),
    true
  );
});

test("Anthropic automatic caching rejects a different TTL on the final explicit boundary", () => {
  const input = structuredClone(plan);
  input.sections[1].cache = { mode: "required", horizon: "long" };
  input.sections[2].cache = { mode: "required", horizon: "long" };
  input.providerOptions = {
    anthropic: { automatic: true, automaticHorizon: "short" }
  };

  assert.throws(
    () => compilePromptPlan(input, { provider: "anthropic" }),
    (error) => error?.code === "CC_ANTHROPIC_AUTOMATIC_TTL_CONFLICT"
  );
});

test("OpenAI implicit mode reports when no user message can receive its managed breakpoint", () => {
  const input = structuredClone(plan);
  input.sections[2].items = [{ role: "assistant", content: "Previous assistant output" }];
  input.providerOptions = { openai: { mode: "implicit" } };

  const result = compilePromptPlan(input, { provider: "openai-responses" });

  assert.equal(result.manifest.providerManagedBreakpoint, null);
  assert.equal(
    result.diagnostics.some((entry) => entry.code === "CC111_PROVIDER_MANAGED_BREAKPOINT_UNAVAILABLE"),
    true
  );
});

test("provider payloads omit optional empty collections", () => {
  const withoutTools = structuredClone(plan);
  withoutTools.tools = [];

  const responses = compilePromptPlan(withoutTools, { provider: "openai-responses" }).payload;
  const chat = compilePromptPlan(withoutTools, { provider: "openai-chat" }).payload;
  const anthropic = compilePromptPlan(withoutTools, { provider: "anthropic" }).payload;

  assert.equal(Object.hasOwn(responses, "tools"), false);
  assert.equal(Object.hasOwn(chat, "tools"), false);
  assert.equal(Object.hasOwn(anthropic, "tools"), false);

  const withoutInstructions = structuredClone(withoutTools);
  withoutInstructions.sections = withoutInstructions.sections.filter(
    (section) => section.lane === "conversation"
  );
  const anthropicWithoutSystem = compilePromptPlan(withoutInstructions, { provider: "anthropic" }).payload;
  assert.equal(Object.hasOwn(anthropicWithoutSystem, "system"), false);
});
