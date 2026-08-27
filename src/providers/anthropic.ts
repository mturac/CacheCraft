import { CacheCraftError } from "../errors.js";
import type { CacheHorizon, JsonObject, PromptSection } from "../types.js";
import { breakpointMap, requireModel, type RenderContext } from "./shared.js";

// Provider contract: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

function cacheControl(horizon: CacheHorizon): JsonObject {
  return horizon === "long"
    ? { type: "ephemeral", ttl: "1h" }
    : { type: "ephemeral" };
}

function renderTool(tool: RenderContext["tools"][number]): JsonObject {
  const output: JsonObject = {
    name: tool.name,
    input_schema: tool.inputSchema
  };
  if (tool.description !== undefined) {
    output["description"] = tool.description;
  }
  return output;
}

function renderSectionBlocks(
  section: PromptSection,
  selected: Map<string, RenderContext["breakpoints"][number]>
): JsonObject[] {
  return section.items.map((item, itemIndex) => {
    const block: JsonObject = {
      type: "text",
      text: item.content
    };
    if (itemIndex === section.items.length - 1) {
      const breakpoint = selected.get(section.id);
      if (breakpoint !== undefined) {
        block["cache_control"] = cacheControl(breakpoint.horizon);
      }
    }
    return block;
  });
}

export function renderAnthropic(context: RenderContext): JsonObject {
  const model = requireModel(context);
  const maxTokens = context.ordered.plan.maxTokens;
  if (maxTokens === undefined) {
    throw new CacheCraftError(
      "CC_ANTHROPIC_MAX_TOKENS_REQUIRED",
      "maxTokens is required to generate an Anthropic Messages API payload.",
      { path: "$.maxTokens" }
    );
  }

  const selected = breakpointMap(context.breakpoints);
  const instructionSections = context.ordered.sections.filter((section) => section.lane === "instructions");
  const conversationSections = context.ordered.sections.filter((section) => section.lane === "conversation");
  if (conversationSections.length === 0) {
    throw new CacheCraftError(
      "CC_ANTHROPIC_MESSAGE_REQUIRED",
      "Anthropic payload generation requires at least one conversation section."
    );
  }

  const payload: JsonObject = {
    model,
    max_tokens: maxTokens,
    messages: conversationSections.flatMap((section) => section.items.map((item, itemIndex) => {
      const block: JsonObject = {
        type: "text",
        text: item.content
      };
      if (itemIndex === section.items.length - 1) {
        const breakpoint = selected.get(section.id);
        if (breakpoint !== undefined) {
          block["cache_control"] = cacheControl(breakpoint.horizon);
        }
      }
      return {
        role: item.role,
        content: [block]
      };
    }))
  };
  if (instructionSections.length > 0) {
    payload["system"] = instructionSections.flatMap(
      (section) => renderSectionBlocks(section, selected)
    );
  }
  if (context.tools.length > 0) {
    payload["tools"] = context.tools.map(renderTool);
  }

  const anthropicOptions = context.ordered.plan.providerOptions.anthropic;
  if (anthropicOptions.automatic) {
    const finalSection = context.ordered.sections.at(-1);
    const finalExplicit = finalSection === undefined ? undefined : selected.get(finalSection.id);
    if (finalExplicit !== undefined && finalExplicit.horizon !== anthropicOptions.automaticHorizon) {
      throw new CacheCraftError(
        "CC_ANTHROPIC_AUTOMATIC_TTL_CONFLICT",
        "Anthropic automatic caching conflicts with the explicit TTL on the final cacheable block.",
        {
          details: {
            sectionId: finalExplicit.sectionId,
            explicitHorizon: finalExplicit.horizon,
            automaticHorizon: anthropicOptions.automaticHorizon
          }
        }
      );
    }
    payload["cache_control"] = cacheControl(anthropicOptions.automaticHorizon);

    if (finalSection?.stability === "request" || finalSection?.stability === "turn") {
      context.diagnostics.push({
        code: "CC107_AUTOMATIC_CACHE_INCLUDES_VOLATILE_SUFFIX",
        severity: "warning",
        message: `Anthropic automatic caching targets the final ${finalSection.stability}-stable section ${finalSection.id}.`,
        sectionId: finalSection.id
      });
    }
  }

  return payload;
}
