import type { JsonObject } from "../types.js";
import {
  breakpointMap,
  requireOpenAIBreakpointModel,
  warnForVolatileOpenAIImplicitBoundary,
  type RenderContext
} from "./shared.js";

// Provider contract: https://developers.openai.com/api/docs/guides/prompt-caching

function renderTool(tool: RenderContext["tools"][number]): JsonObject {
  const definition: JsonObject = {
    name: tool.name,
    parameters: tool.inputSchema
  };
  if (tool.description !== undefined) {
    definition["description"] = tool.description;
  }
  return {
    type: "function",
    function: definition
  };
}

export function renderOpenAIChat(context: RenderContext): JsonObject {
  const selected = breakpointMap(context.breakpoints);
  warnForVolatileOpenAIImplicitBoundary(context);
  const payload: JsonObject = {
    model: requireOpenAIBreakpointModel(context),
    prompt_cache_key: context.cacheKey,
    prompt_cache_options: {
      mode: context.ordered.plan.providerOptions.openai.mode,
      ttl: "30m"
    },
    messages: context.ordered.sections.flatMap((section) => section.items.map((item, itemIndex) => {
      const text: JsonObject = {
        type: "text",
        text: item.content
      };
      if (itemIndex === section.items.length - 1 && selected.has(section.id)) {
        text["prompt_cache_breakpoint"] = { mode: "explicit" };
      }
      return {
        role: item.role,
        content: [text]
      };
    }))
  };
  if (context.tools.length > 0) {
    payload["tools"] = context.tools.map(renderTool);
  }
  if (context.ordered.plan.maxTokens !== undefined) {
    payload["max_completion_tokens"] = context.ordered.plan.maxTokens;
  }
  return payload;
}
