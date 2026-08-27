import { CacheCraftError } from "../errors.js";
import type {
  Diagnostic,
  JsonObject,
  OrderedPlan,
  SelectedBreakpoint,
  ToolDefinition
} from "../types.js";

export interface RenderContext {
  ordered: OrderedPlan;
  tools: ToolDefinition[];
  breakpoints: SelectedBreakpoint[];
  cacheKey: string;
  model?: string;
  diagnostics: Diagnostic[];
}

export function requireModel(context: RenderContext): string {
  if (context.model === undefined) {
    throw new CacheCraftError(
      "CC_MODEL_REQUIRED",
      "A model is required for provider-specific payload generation."
    );
  }
  return context.model;
}

export function requireOpenAIBreakpointModel(context: RenderContext): string {
  const model = requireModel(context);
  const match = /(?:^|:)gpt-(\d+)(?:\.(\d+))?/i.exec(model);
  if (match !== null) {
    const major = Number(match[1]);
    const minor = match[2] === undefined ? 0 : Number(match[2]);
    if (major < 5 || (major === 5 && minor < 6)) {
      throw new CacheCraftError(
        "CC_OPENAI_BREAKPOINT_MODEL_UNSUPPORTED",
        `OpenAI explicit and implicit breakpoint controls require GPT-5.6 or a later model family; received ${model}.`,
        { details: { model, minimumFamily: "gpt-5.6" } }
      );
    }
    return model;
  }

  context.diagnostics.push({
    code: "CC108_OPENAI_MODEL_CAPABILITY_UNVERIFIED",
    severity: "warning",
    message: `CacheCraft could not verify that OpenAI model alias ${model} supports GPT-5.6+ prompt-cache breakpoint controls.`,
    details: { model, requiredCapability: "gpt-5.6+ prompt-cache breakpoints" }
  });
  return model;
}

export function warnForVolatileOpenAIImplicitBoundary(context: RenderContext): void {
  if (context.ordered.plan.providerOptions.openai.mode !== "implicit") {
    return;
  }

  for (let sectionIndex = context.ordered.sections.length - 1; sectionIndex >= 0; sectionIndex -= 1) {
    const section = context.ordered.sections[sectionIndex];
    if (section === undefined) {
      continue;
    }
    if (!section.items.some((item) => item.role === "user")) {
      continue;
    }
    if (section.stability === "turn" || section.stability === "request") {
      context.diagnostics.push({
        code: "CC109_IMPLICIT_CACHE_INCLUDES_VOLATILE_SUFFIX",
        severity: "warning",
        message: `OpenAI implicit caching will place a provider-managed write boundary on a ${section.stability}-stable user message in section ${section.id}.`,
        sectionId: section.id,
        details: { stability: section.stability }
      });
    }
    return;
  }
}

export function breakpointMap(breakpoints: SelectedBreakpoint[]): Map<string, SelectedBreakpoint> {
  return new Map(breakpoints.map((breakpoint) => [breakpoint.sectionId, breakpoint]));
}

export function genericTool(tool: ToolDefinition): JsonObject {
  const output: JsonObject = {
    name: tool.name,
    input_schema: tool.inputSchema
  };
  if (tool.description !== undefined) {
    output["description"] = tool.description;
  }
  return output;
}
