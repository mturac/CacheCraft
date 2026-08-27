import {
  compilePromptPlan,
  type PromptPlanInput,
  type ProviderTarget
} from "../dist/index.js";

const provider: ProviderTarget = "openai-responses";

const plan = {
  schemaVersion: "1",
  id: "typed-consumer",
  version: "1",
  sections: [
    {
      id: "policy",
      lane: "instructions",
      stability: "global",
      items: [{ role: "developer", content: "Stable policy" }]
    },
    {
      id: "request",
      lane: "conversation",
      stability: "request",
      items: [{ role: "user", content: "Hello" }]
    }
  ]
} satisfies PromptPlanInput;

const result = compilePromptPlan(plan, { provider });
result.manifest.contractHash satisfies string;
