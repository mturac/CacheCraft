import type { JsonObject } from "../types.js";
import { breakpointMap, genericTool, type RenderContext } from "./shared.js";

export function renderGeneric(context: RenderContext): JsonObject {
  const selected = breakpointMap(context.breakpoints);
  const payload: JsonObject = {
    cache_key: context.cacheKey,
    messages: context.ordered.sections.flatMap((section) => section.items.map((item, itemIndex) => {
      const output: JsonObject = {
        role: item.role,
        content: item.content,
        section_id: section.id
      };
      if (itemIndex === section.items.length - 1) {
        const breakpoint = selected.get(section.id);
        if (breakpoint !== undefined) {
          output["cache_breakpoint"] = {
            mode: breakpoint.mode,
            horizon: breakpoint.horizon,
            prefix_hash: breakpoint.prefixHash,
            estimated_prefix_tokens: breakpoint.estimatedPrefixTokens
          };
        }
      }
      return output;
    })),
    tools: context.tools.map(genericTool),
    cache: {
      breakpoints: context.breakpoints.map((breakpoint) => ({
        section_id: breakpoint.sectionId,
        mode: breakpoint.mode,
        horizon: breakpoint.horizon,
        prefix_hash: breakpoint.prefixHash,
        estimated_prefix_tokens: breakpoint.estimatedPrefixTokens
      }))
    }
  };
  if (context.model !== undefined) {
    payload["model"] = context.model;
  }
  if (context.ordered.plan.maxTokens !== undefined) {
    payload["max_tokens"] = context.ordered.plan.maxTokens;
  }
  return payload;
}
