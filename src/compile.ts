import { selectBreakpoints, selectProviderManagedBreakpoint } from "./breakpoints.js";
import { CacheCraftError } from "./errors.js";
import { buildManifest, resolveCacheKey } from "./manifest.js";
import { orderSections } from "./order.js";
import { renderProviderPayload } from "./render.js";
import { sortTools } from "./tools.js";
import type { CompilationResult, CompileOptions, PromptPlanInput, ProviderTarget } from "./types.js";
import { validatePromptPlan } from "./validate.js";

const PROVIDERS = new Set<ProviderTarget>([
  "generic",
  "openai-responses",
  "openai-chat",
  "anthropic"
]);

function validateCompileOptions(options: CompileOptions): CompileOptions {
  if (options === null || typeof options !== "object" || !PROVIDERS.has(options.provider)) {
    throw new CacheCraftError(
      "CC_UNSUPPORTED_PROVIDER",
      `provider must be one of: ${[...PROVIDERS].join(", ")}.`,
      { path: "$.provider" }
    );
  }
  if (options.model !== undefined && (typeof options.model !== "string" || options.model.trim().length === 0)) {
    throw new CacheCraftError(
      "CC_INVALID_COMPILE_OPTIONS",
      "model override must be a non-empty string.",
      { path: "$.model" }
    );
  }
  if (options.cacheKey !== undefined
    && (typeof options.cacheKey !== "string"
      || options.cacheKey.trim().length === 0
      || options.cacheKey.length > 64)) {
    throw new CacheCraftError(
      "CC_INVALID_COMPILE_OPTIONS",
      "cacheKey override must be a non-empty string containing at most 64 characters.",
      { path: "$.cacheKey" }
    );
  }
  return options;
}

export function compilePromptPlan(input: PromptPlanInput, rawOptions: CompileOptions): CompilationResult {
  const options = validateCompileOptions(rawOptions);
  const plan = validatePromptPlan(input);
  const ordered = orderSections(plan);
  const tools = sortTools(plan.tools);
  const selection = selectBreakpoints(ordered, tools, options.provider);
  const managedSelection = selectProviderManagedBreakpoint(
    ordered,
    tools,
    options.provider,
    selection.breakpoints
  );
  const diagnostics = [
    ...ordered.diagnostics,
    ...selection.diagnostics,
    ...managedSelection.diagnostics
  ];
  const cacheKey = resolveCacheKey(ordered, tools, options.cacheKey);
  if ((options.provider === "openai-responses" || options.provider === "openai-chat")
    && cacheKey.source === "derived") {
    diagnostics.push({
      code: "CC110_DERIVED_CACHE_KEY_UNSHARDED",
      severity: "warning",
      message: "The derived OpenAI prompt_cache_key is shared by the entire plan version. Supply a stable per-session, per-user, or deterministic shard key for high-volume traffic.",
      details: { source: cacheKey.source }
    });
  }
  const model = options.model ?? plan.model;
  const manifest = buildManifest(
    ordered,
    tools,
    options.provider,
    model,
    cacheKey,
    selection.breakpoints,
    managedSelection.breakpoint
  );
  const payload = renderProviderPayload(options.provider, {
    ordered,
    tools,
    breakpoints: selection.breakpoints,
    cacheKey: cacheKey.value,
    diagnostics,
    ...(model === undefined ? {} : { model })
  });
  return { payload, manifest, diagnostics };
}
