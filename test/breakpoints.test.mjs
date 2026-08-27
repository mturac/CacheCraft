import assert from "node:assert/strict";
import test from "node:test";

import { compilePromptPlan } from "../dist/index.js";

function section(id, stability, mode, horizon = "long") {
  return {
    id,
    lane: "instructions",
    stability,
    cache: { mode, horizon },
    items: [{ role: "developer", content: `${id} `.repeat(100) }]
  };
}

test("required breakpoints are retained and preferred duplicates collapse", () => {
  const result = compilePromptPlan({
    schemaVersion: "1",
    id: "breakpoints",
    version: "1",
    sections: [
      section("global-a", "global", "preferred"),
      section("global-b", "global", "preferred"),
      section("deployment", "deployment", "required"),
      section("request", "request", "never")
    ]
  }, { provider: "generic" });

  assert.deepEqual(
    result.manifest.breakpoints.map((entry) => entry.sectionId),
    ["global-b", "deployment"]
  );
});

test("compilation rejects more required breakpoints than the provider supports", () => {
  assert.throws(() => compilePromptPlan({
    schemaVersion: "1",
    id: "overflow",
    version: "1",
    sections: [
      section("a", "global", "required"),
      section("b", "deployment", "required"),
      section("c", "session", "required", "short"),
      section("d", "turn", "required", "short"),
      section("e", "request", "required", "short")
    ]
  }, { provider: "openai-responses" }), (error) => error?.code === "CC_REQUIRED_BREAKPOINT_OVERFLOW");
});

test("Anthropic rejects long TTL breakpoints after short TTL breakpoints", () => {
  assert.throws(() => compilePromptPlan({
    schemaVersion: "1",
    id: "ttl-order",
    version: "1",
    sections: [
      section("short-first", "global", "required", "short"),
      {
        ...section("long-second", "deployment", "required", "long"),
        after: ["short-first"]
      }
    ]
  }, { provider: "anthropic" }), (error) => error?.code === "CC_ANTHROPIC_TTL_ORDER");
});

test("Anthropic drops a preferred long TTL breakpoint after a required short TTL breakpoint", () => {
  const result = compilePromptPlan({
    schemaVersion: "1",
    id: "ttl-preferred-drop",
    version: "1",
    model: "provider-model",
    maxTokens: 256,
    sections: [
      section("short-required", "global", "required", "short"),
      {
        ...section("long-preferred", "deployment", "preferred", "long"),
        after: ["short-required"]
      }
    ]
  }, { provider: "anthropic" });

  assert.deepEqual(
    result.manifest.breakpoints.map((entry) => entry.sectionId),
    ["short-required"]
  );
  assert.ok(result.diagnostics.some((entry) => entry.code === "CC102_PREFERRED_BREAKPOINT_DROPPED"));
});

test("OpenAI implicit mode reserves one of four write slots", () => {
  const sections = [
    section("a", "global", "required"),
    section("b", "deployment", "required"),
    section("c", "session", "required", "short"),
    section("d", "turn", "required", "short")
  ];

  assert.throws(() => compilePromptPlan({
    schemaVersion: "1",
    id: "implicit-overflow",
    version: "1",
    providerOptions: { openai: { mode: "implicit" } },
    sections
  }, { provider: "openai-responses" }), (error) => error?.code === "CC_REQUIRED_BREAKPOINT_OVERFLOW");
});
