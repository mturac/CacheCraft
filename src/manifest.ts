import { estimateSectionsTokens, estimateToolsTokens } from "./estimate.js";
import { sha256Hex } from "./hash.js";
import { logicalPromptMaterial, logicalToolsMaterial } from "./material.js";
import type {
  CacheKeySource,
  CacheCraftManifest,
  JsonObject,
  OrderedPlan,
  ProviderManagedBreakpoint,
  ProviderTarget,
  SelectedBreakpoint,
  ToolDefinition
} from "./types.js";
import { VERSION } from "./version.js";

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized.length === 0 ? "plan" : normalized;
}

function providerConfiguration(ordered: OrderedPlan, provider: ProviderTarget): JsonObject {
  switch (provider) {
    case "openai-responses":
    case "openai-chat":
      return {
        mode: ordered.plan.providerOptions.openai.mode,
        ttl: "30m"
      };
    case "anthropic":
      return {
        automatic: ordered.plan.providerOptions.anthropic.automatic,
        automaticHorizon: ordered.plan.providerOptions.anthropic.automaticHorizon
      };
    case "generic":
      return { format: "cachecraft-logical-v1" };
  }
}

export function deriveCacheKey(ordered: OrderedPlan, _tools: ToolDefinition[]): string {
  if (ordered.plan.cacheKey !== undefined) {
    return ordered.plan.cacheKey;
  }
  const identityHash = sha256Hex({
    schemaVersion: ordered.plan.schemaVersion,
    id: ordered.plan.id,
    version: ordered.plan.version
  });
  return `cc:${slug(ordered.plan.id)}:${identityHash.slice(0, 16)}`;
}

export interface ResolvedCacheKey {
  value: string;
  source: CacheKeySource;
}

export function resolveCacheKey(
  ordered: OrderedPlan,
  tools: ToolDefinition[],
  override: string | undefined
): ResolvedCacheKey {
  if (override !== undefined) {
    return { value: override, source: "compile-option" };
  }
  if (ordered.plan.cacheKey !== undefined) {
    return { value: ordered.plan.cacheKey, source: "plan" };
  }
  return { value: deriveCacheKey(ordered, tools), source: "derived" };
}

export function buildManifest(
  ordered: OrderedPlan,
  tools: ToolDefinition[],
  provider: ProviderTarget,
  model: string | undefined,
  cacheKey: ResolvedCacheKey,
  breakpoints: SelectedBreakpoint[],
  providerManagedBreakpoint: ProviderManagedBreakpoint | null
): CacheCraftManifest {
  const stablePrefixHash = breakpoints.at(-1)?.prefixHash ?? null;
  const toolsHash = sha256Hex(logicalToolsMaterial(tools));
  const compiledPromptHash = sha256Hex(logicalPromptMaterial(tools, ordered.sections));
  const base = {
    schemaVersion: "1" as const,
    compiler: {
      name: "@mturac/cachecraft" as const,
      version: VERSION
    },
    planId: ordered.plan.id,
    planVersion: ordered.plan.version,
    provider,
    providerConfiguration: providerConfiguration(ordered, provider),
    cacheKey: cacheKey.value,
    cacheKeySource: cacheKey.source,
    sourceOrder: ordered.plan.sections.map((section) => section.id),
    compiledOrder: ordered.sections.map((section) => section.id),
    toolNames: tools.map((tool) => tool.name),
    toolsHash,
    compiledPromptHash,
    breakpoints,
    providerManagedBreakpoint,
    stablePrefixHash,
    estimatedInputTokens: estimateToolsTokens(tools) + estimateSectionsTokens(ordered.sections)
  };
  const contractInput = model === undefined ? base : { ...base, model };
  const manifest: CacheCraftManifest = {
    ...contractInput,
    contractHash: sha256Hex(contractInput)
  };
  return manifest;
}
