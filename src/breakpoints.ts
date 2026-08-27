import { CacheCraftError } from "./errors.js";
import {
  estimateSectionsTokens,
  estimateSectionsTokensThroughItem,
  estimateToolsTokens
} from "./estimate.js";
import { sha256Hex } from "./hash.js";
import { logicalPromptMaterial, logicalPromptMaterialThroughItem } from "./material.js";
import type {
  CacheHorizon,
  Diagnostic,
  OrderedPlan,
  PromptSection,
  ProviderManagedBreakpoint,
  ProviderTarget,
  SelectedBreakpoint,
  Stability,
  ToolDefinition
} from "./types.js";

const STABILITY_RANK: Record<Stability, number> = {
  global: 0,
  deployment: 1,
  session: 2,
  turn: 3,
  request: 4
};

interface Candidate {
  section: PromptSection;
  sectionIndex: number;
}

export interface BreakpointSelection {
  breakpoints: SelectedBreakpoint[];
  diagnostics: Diagnostic[];
}

export interface ProviderManagedBreakpointSelection {
  breakpoint: ProviderManagedBreakpoint | null;
  diagnostics: Diagnostic[];
}

function breakpointBudget(ordered: OrderedPlan, provider: ProviderTarget): number {
  switch (provider) {
    case "openai-responses":
    case "openai-chat":
      return ordered.plan.providerOptions.openai.mode === "implicit" ? 3 : 4;
    case "anthropic":
      if (!ordered.plan.providerOptions.anthropic.automatic) {
        return 4;
      }
      {
        const finalSection = ordered.sections.at(-1);
        const automaticHorizon = ordered.plan.providerOptions.anthropic.automaticHorizon;
        const automaticWillBeNoOp = finalSection?.cache.mode === "required"
          && finalSection.cache.horizon === automaticHorizon;
        return automaticWillBeNoOp ? 4 : 3;
      }
    case "generic":
      return 4;
  }
}

function providerTtl(provider: ProviderTarget, horizon: CacheHorizon): SelectedBreakpoint["providerTtl"] {
  switch (provider) {
    case "anthropic":
      return horizon === "long" ? "1h" : "5m";
    case "openai-responses":
    case "openai-chat":
      return "30m";
    case "generic":
      return "logical";
  }
}

function prefixMaterial(tools: ToolDefinition[], sections: PromptSection[], sectionIndex: number): unknown {
  return logicalPromptMaterial(tools, sections.slice(0, sectionIndex + 1));
}

function collapsePreferred(candidates: Candidate[]): Candidate[] {
  const latest = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.section.stability}:${candidate.section.cache.horizon}`;
    latest.set(key, candidate);
  }
  return [...latest.values()].sort((left, right) => {
    const stability = STABILITY_RANK[left.section.stability] - STABILITY_RANK[right.section.stability];
    if (stability !== 0) {
      return stability;
    }
    return left.sectionIndex - right.sectionIndex;
  });
}

function anthopicTtlOrderIsValid(breakpoints: Candidate[]): boolean {
  let shortSeen = false;
  for (const breakpoint of [...breakpoints].sort((left, right) => left.sectionIndex - right.sectionIndex)) {
    if (breakpoint.section.cache.horizon === "short") {
      shortSeen = true;
    } else if (shortSeen) {
      return false;
    }
  }
  return true;
}

function assertAnthropicTtlOrder(breakpoints: Candidate[]): void {
  if (anthopicTtlOrderIsValid(breakpoints)) {
    return;
  }

  const sorted = [...breakpoints].sort((left, right) => left.sectionIndex - right.sectionIndex);
  let shortSeen = false;
  const offender = sorted.find((breakpoint) => {
    if (breakpoint.section.cache.horizon === "short") {
      shortSeen = true;
      return false;
    }
    return shortSeen;
  });

  throw new CacheCraftError(
    "CC_ANTHROPIC_TTL_ORDER",
    "Anthropic requires long cache TTL breakpoints to appear before short TTL breakpoints.",
    {
      details: {
        sectionId: offender?.section.id,
        horizon: offender?.section.cache.horizon
      }
    }
  );
}

export function selectBreakpoints(
  ordered: OrderedPlan,
  tools: ToolDefinition[],
  provider: ProviderTarget
): BreakpointSelection {
  const diagnostics: Diagnostic[] = [{
    code: "CC104_PREFIX_TOKEN_COUNT_ESTIMATED",
    severity: "info",
    message: "Token counts use a deterministic character-based estimate; provider tokenization may differ."
  }];
  let candidates: Candidate[] = ordered.sections
    .map((section, sectionIndex) => ({ section, sectionIndex }))
    .filter((candidate) => candidate.section.cache.mode !== "never");

  if (provider === "anthropic" && ordered.plan.providerOptions.anthropic.automatic) {
    const finalSection = ordered.sections.at(-1);
    const finalCandidate = finalSection === undefined
      ? undefined
      : candidates.find((candidate) => candidate.section.id === finalSection.id);
    const automaticHorizon = ordered.plan.providerOptions.anthropic.automaticHorizon;

    if (finalCandidate?.section.cache.mode === "required"
      && finalCandidate.section.cache.horizon !== automaticHorizon) {
      throw new CacheCraftError(
        "CC_ANTHROPIC_AUTOMATIC_TTL_CONFLICT",
        "Anthropic automatic caching conflicts with the required explicit TTL on the final cacheable block.",
        {
          details: {
            sectionId: finalCandidate.section.id,
            explicitHorizon: finalCandidate.section.cache.horizon,
            automaticHorizon
          }
        }
      );
    }

    if (finalCandidate?.section.cache.mode === "preferred") {
      candidates = candidates.filter((candidate) => candidate !== finalCandidate);
      diagnostics.push({
        code: "CC112_AUTOMATIC_BREAKPOINT_REPLACED",
        severity: finalCandidate.section.cache.horizon === automaticHorizon ? "info" : "warning",
        message: finalCandidate.section.cache.horizon === automaticHorizon
          ? `Preferred breakpoint after section ${finalCandidate.section.id} is provided by Anthropic automatic caching instead of an explicit marker.`
          : `Preferred breakpoint after section ${finalCandidate.section.id} was replaced by Anthropic automatic caching with a different TTL horizon.`,
        sectionId: finalCandidate.section.id,
        details: {
          preferredHorizon: finalCandidate.section.cache.horizon,
          automaticHorizon
        }
      });
    }
  }

  if (candidates.length === 0) {
    diagnostics.push({
      code: "CC105_NO_CACHE_BREAKPOINT",
      severity: "warning",
      message: "The plan contains no cacheable section, so no explicit cache breakpoint will be emitted."
    });
    return { breakpoints: [], diagnostics };
  }

  const budget = breakpointBudget(ordered, provider);
  const required = candidates.filter((candidate) => candidate.section.cache.mode === "required");
  if (required.length > budget) {
    throw new CacheCraftError(
      "CC_REQUIRED_BREAKPOINT_OVERFLOW",
      `Provider ${provider} supports ${budget} explicit cache breakpoints for this mode, but ${required.length} are required.`,
      {
        details: {
          provider,
          budget,
          requiredSectionIds: required.map((candidate) => candidate.section.id)
        }
      }
    );
  }

  if (provider === "anthropic") {
    assertAnthropicTtlOrder(required);
  }

  const preferred = collapsePreferred(
    candidates.filter((candidate) => candidate.section.cache.mode === "preferred")
  );
  const remaining = Math.max(0, budget - required.length);
  const selectedPreferred: Candidate[] = [];

  for (const candidate of preferred) {
    if (selectedPreferred.length >= remaining) {
      diagnostics.push({
        code: "CC102_PREFERRED_BREAKPOINT_DROPPED",
        severity: "warning",
        message: `Preferred breakpoint after section ${candidate.section.id} was dropped to fit provider ${provider}'s write-slot budget.`,
        sectionId: candidate.section.id,
        details: { provider, budget }
      });
      continue;
    }

    if (provider === "anthropic" && !anthopicTtlOrderIsValid([...required, ...selectedPreferred, candidate])) {
      diagnostics.push({
        code: "CC102_PREFERRED_BREAKPOINT_DROPPED",
        severity: "warning",
        message: `Preferred breakpoint after section ${candidate.section.id} was dropped because it would violate Anthropic TTL ordering.`,
        sectionId: candidate.section.id,
        details: { provider, reason: "ttl-order" }
      });
      continue;
    }

    selectedPreferred.push(candidate);
  }

  const selectedCandidates = [...required, ...selectedPreferred]
    .sort((left, right) => left.sectionIndex - right.sectionIndex);

  if (provider === "anthropic") {
    assertAnthropicTtlOrder(selectedCandidates);
  }

  const horizons = new Set(selectedCandidates.map((candidate) => candidate.section.cache.horizon));
  if ((provider === "openai-responses" || provider === "openai-chat") && horizons.size > 1) {
    diagnostics.push({
      code: "CC103_CACHE_HORIZON_COLLAPSED",
      severity: "warning",
      message: "OpenAI applies one 30-minute TTL to all breakpoints in the request; logical long and short horizons were collapsed.",
      details: { provider, providerTtl: "30m" }
    });
  }

  const toolsTokens = estimateToolsTokens(tools);
  const breakpoints = selectedCandidates.map((candidate): SelectedBreakpoint => {
    const estimatedPrefixTokens = toolsTokens + estimateSectionsTokens(
      ordered.sections.slice(0, candidate.sectionIndex + 1)
    );
    if ((provider === "openai-responses" || provider === "openai-chat") && estimatedPrefixTokens < 1024) {
      diagnostics.push({
        code: "CC106_ESTIMATED_PREFIX_BELOW_MINIMUM",
        severity: "warning",
        message: `The estimated prefix at section ${candidate.section.id} is below OpenAI's 1,024-token cache minimum.`,
        sectionId: candidate.section.id,
        details: { estimatedPrefixTokens, minimumTokens: 1024 }
      });
    }
    return {
      sectionId: candidate.section.id,
      sectionIndex: candidate.sectionIndex,
      mode: candidate.section.cache.mode as "required" | "preferred",
      horizon: candidate.section.cache.horizon,
      providerTtl: providerTtl(provider, candidate.section.cache.horizon),
      estimatedPrefixTokens,
      prefixHash: sha256Hex(prefixMaterial(tools, ordered.sections, candidate.sectionIndex))
    };
  });

  return { breakpoints, diagnostics };
}

function managedBreakpoint(
  mode: ProviderManagedBreakpoint["mode"],
  status: ProviderManagedBreakpoint["status"],
  ordered: OrderedPlan,
  tools: ToolDefinition[],
  sectionIndex: number,
  itemIndex: number,
  horizon: CacheHorizon,
  providerTtlValue: ProviderManagedBreakpoint["providerTtl"]
): ProviderManagedBreakpoint {
  const section = ordered.sections[sectionIndex];
  if (section === undefined) {
    throw new CacheCraftError(
      "CC_INTERNAL_BREAKPOINT_ERROR",
      "Provider-managed breakpoint target could not be resolved."
    );
  }
  return {
    mode,
    status,
    sectionId: section.id,
    sectionIndex,
    itemIndex,
    stability: section.stability,
    horizon,
    providerTtl: providerTtlValue,
    estimatedPrefixTokens: estimateToolsTokens(tools)
      + estimateSectionsTokensThroughItem(ordered.sections, sectionIndex, itemIndex),
    prefixHash: sha256Hex(logicalPromptMaterialThroughItem(
      tools,
      ordered.sections,
      sectionIndex,
      itemIndex
    ))
  };
}

export function selectProviderManagedBreakpoint(
  ordered: OrderedPlan,
  tools: ToolDefinition[],
  provider: ProviderTarget,
  explicitBreakpoints: SelectedBreakpoint[]
): ProviderManagedBreakpointSelection {
  const diagnostics: Diagnostic[] = [];

  if ((provider === "openai-responses" || provider === "openai-chat")
    && ordered.plan.providerOptions.openai.mode === "implicit") {
    for (let sectionIndex = ordered.sections.length - 1; sectionIndex >= 0; sectionIndex -= 1) {
      const section = ordered.sections[sectionIndex];
      if (section === undefined) {
        continue;
      }
      for (let itemIndex = section.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
        if (section.items[itemIndex]?.role === "user") {
          return {
            breakpoint: managedBreakpoint(
              "openai-implicit",
              "active",
              ordered,
              tools,
              sectionIndex,
              itemIndex,
              section.cache.horizon,
              "30m"
            ),
            diagnostics
          };
        }
      }
    }

    diagnostics.push({
      code: "CC111_PROVIDER_MANAGED_BREAKPOINT_UNAVAILABLE",
      severity: "warning",
      message: "OpenAI implicit caching could not find a user message to use as its provider-managed breakpoint."
    });
    return { breakpoint: null, diagnostics };
  }

  if (provider === "anthropic" && ordered.plan.providerOptions.anthropic.automatic) {
    const sectionIndex = ordered.sections.length - 1;
    const section = ordered.sections[sectionIndex];
    const itemIndex = (section?.items.length ?? 0) - 1;
    if (section === undefined || itemIndex < 0) {
      diagnostics.push({
        code: "CC111_PROVIDER_MANAGED_BREAKPOINT_UNAVAILABLE",
        severity: "warning",
        message: "Anthropic automatic caching could not find an eligible content block."
      });
      return { breakpoint: null, diagnostics };
    }

    const horizon = ordered.plan.providerOptions.anthropic.automaticHorizon;
    const finalExplicit = explicitBreakpoints.find((breakpoint) => breakpoint.sectionId === section.id);
    if (finalExplicit !== undefined && finalExplicit.horizon !== horizon) {
      throw new CacheCraftError(
        "CC_ANTHROPIC_AUTOMATIC_TTL_CONFLICT",
        "Anthropic automatic caching conflicts with the explicit TTL on the final cacheable block.",
        {
          details: {
            sectionId: finalExplicit.sectionId,
            explicitHorizon: finalExplicit.horizon,
            automaticHorizon: horizon
          }
        }
      );
    }

    const status: ProviderManagedBreakpoint["status"] = finalExplicit === undefined ? "active" : "no-op";
    if (status === "active" && horizon === "long"
      && explicitBreakpoints.some((breakpoint) => breakpoint.horizon === "short")) {
      throw new CacheCraftError(
        "CC_ANTHROPIC_TTL_ORDER",
        "Anthropic automatic long-TTL caching would place a long TTL after an explicit short TTL.",
        { details: { automaticHorizon: "long" } }
      );
    }

    return {
      breakpoint: managedBreakpoint(
        "anthropic-automatic",
        status,
        ordered,
        tools,
        sectionIndex,
        itemIndex,
        horizon,
        horizon === "long" ? "1h" : "5m"
      ),
      diagnostics
    };
  }

  return { breakpoint: null, diagnostics };
}
