import assert from "node:assert/strict";
import test from "node:test";

import { orderSections } from "../dist/order.js";
import { validatePromptPlan } from "../dist/validate.js";

const item = (role, content) => ({ role, content });

function basePlan(sections) {
  return {
    schemaVersion: "1",
    id: "order-test",
    version: "1",
    sections
  };
}

test("instruction sections are reordered only when authors explicitly opt in", () => {
  const plan = validatePromptPlan(basePlan([
    {
      id: "deployment-context",
      lane: "instructions",
      stability: "deployment",
      order: "optimize",
      items: [item("developer", "deployment")]
    },
    {
      id: "global-policy",
      lane: "instructions",
      stability: "global",
      order: "optimize",
      items: [item("system", "global")]
    },
    {
      id: "first-user",
      lane: "conversation",
      stability: "session",
      items: [item("user", "first")]
    },
    {
      id: "assistant-reply",
      lane: "conversation",
      stability: "global",
      items: [item("assistant", "reply")]
    }
  ]));

  const result = orderSections(plan);

  assert.deepEqual(
    result.sections.map((section) => section.id),
    ["global-policy", "deployment-context", "first-user", "assistant-reply"]
  );
});

test("instruction sections preserve source order by default", () => {
  const plan = validatePromptPlan(basePlan([
    {
      id: "request-metadata",
      lane: "instructions",
      stability: "request",
      items: [item("developer", "request metadata")]
    },
    {
      id: "global-policy",
      lane: "instructions",
      stability: "global",
      items: [item("system", "global")]
    }
  ]));

  const result = orderSections(plan);

  assert.deepEqual(
    result.sections.map((section) => section.id),
    ["request-metadata", "global-policy"]
  );
  assert.equal(result.diagnostics[0]?.code, "CC101_VOLATILE_BEFORE_STABLE");
});

test("explicit dependencies override stability priority deterministically", () => {
  const plan = validatePromptPlan(basePlan([
    {
      id: "volatile-prerequisite",
      lane: "instructions",
      stability: "request",
      items: [item("developer", "volatile")]
    },
    {
      id: "stable-dependent",
      lane: "instructions",
      stability: "global",
      after: ["volatile-prerequisite"],
      items: [item("developer", "stable")]
    }
  ]));

  const result = orderSections(plan);

  assert.deepEqual(
    result.sections.map((section) => section.id),
    ["volatile-prerequisite", "stable-dependent"]
  );
  assert.equal(result.diagnostics[0]?.code, "CC101_VOLATILE_BEFORE_STABLE");
});

test("preserved sections are barriers that optimized sections cannot cross", () => {
  const plan = validatePromptPlan(basePlan([
    {
      id: "preserved-anchor",
      lane: "instructions",
      stability: "request",
      order: "preserve",
      items: [item("developer", "must remain before the following block")]
    },
    {
      id: "global-optimized",
      lane: "instructions",
      stability: "global",
      order: "optimize",
      items: [item("developer", "globally stable")]
    },
    {
      id: "deployment-optimized",
      lane: "instructions",
      stability: "deployment",
      order: "optimize",
      items: [item("developer", "deployment stable")]
    }
  ]));

  assert.deepEqual(
    orderSections(plan).sections.map((section) => section.id),
    ["preserved-anchor", "global-optimized", "deployment-optimized"]
  );
});
