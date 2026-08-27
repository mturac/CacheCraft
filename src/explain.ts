import type { CompilationResult, ManifestDiff } from "./types.js";

export function explainCompilation(result: CompilationResult): string {
  const lines: string[] = [
    `CacheCraft compilation: ${result.manifest.planId}@${result.manifest.planVersion}`,
    `Provider: ${result.manifest.provider}`,
    `Model: ${result.manifest.model ?? "not specified"}`,
    `Cache key: ${result.manifest.cacheKey} (${result.manifest.cacheKeySource})`,
    "",
    "Compiled order:"
  ];

  for (const [index, sectionId] of result.manifest.compiledOrder.entries()) {
    lines.push(`  ${index + 1}. ${sectionId}`);
  }

  lines.push("", "Provider-managed breakpoint:");
  if (result.manifest.providerManagedBreakpoint === null) {
    lines.push("  none");
  } else {
    const breakpoint = result.manifest.providerManagedBreakpoint;
    lines.push(
      `  - ${breakpoint.mode}/${breakpoint.status} at ${breakpoint.sectionId}`
      + ` item ${breakpoint.itemIndex + 1}: ${breakpoint.providerTtl},`
      + ` ~${breakpoint.estimatedPrefixTokens} prefix tokens`
    );
  }

  lines.push("", "Cache breakpoints:");
  if (result.manifest.breakpoints.length === 0) {
    lines.push("  none");
  } else {
    for (const breakpoint of result.manifest.breakpoints) {
      lines.push(
        `  - ${breakpoint.sectionId}: ${breakpoint.mode}/${breakpoint.horizon}`
        + ` -> ${breakpoint.providerTtl}, ~${breakpoint.estimatedPrefixTokens} prefix tokens`
      );
    }
  }

  lines.push("", "Diagnostics:");
  if (result.diagnostics.length === 0) {
    lines.push("  none");
  } else {
    for (const diagnostic of result.diagnostics) {
      lines.push(`  - [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  lines.push(
    "",
    `Stable prefix hash: ${result.manifest.stablePrefixHash ?? "none"}`,
    `Contract hash: ${result.manifest.contractHash}`
  );
  return `${lines.join("\n")}\n`;
}

export function explainManifestDiff(diff: ManifestDiff): string {
  const lines = [
    diff.changed ? "Cache contract changed." : "Cache contract unchanged.",
    `Before: ${diff.beforeContractHash}`,
    `After:  ${diff.afterContractHash}`,
    "",
    `Contract hash: ${diff.contractHashChanged ? "changed" : "unchanged"}`,
    `Compiler: ${diff.compilerChanged ? "changed" : "unchanged"}`,
    `Plan ID: ${diff.planIdChanged ? "changed" : "unchanged"}`,
    `Plan version: ${diff.planVersionChanged ? "changed" : "unchanged"}`,
    `Stable prefix hash: ${diff.stablePrefixHashChanged ? "changed" : "unchanged"}`,
    `Provider: ${diff.providerChanged ? "changed" : "unchanged"}`,
    `Provider configuration: ${diff.providerConfigurationChanged ? "changed" : "unchanged"}`,
    `Model: ${diff.modelChanged ? "changed" : "unchanged"}`,
    `Cache key: ${diff.cacheKeyChanged ? "changed" : "unchanged"}`,
    `Cache key source: ${diff.cacheKeySourceChanged ? "changed" : "unchanged"}`,
    `Prompt content: ${diff.promptChanged ? "changed" : "unchanged"}`,
    `Source order: ${diff.sourceOrderChanged ? "changed" : "unchanged"}`,
    `Compiled order: ${diff.orderChanged ? "changed" : "unchanged"}`,
    `Tools: ${diff.toolsChanged ? "changed" : "unchanged"}`,
    `Explicit breakpoints: ${diff.breakpointsChanged ? "changed" : "unchanged"}`,
    `Provider-managed breakpoint: ${diff.providerManagedBreakpointChanged ? "changed" : "unchanged"}`,
    `Estimated input tokens: ${diff.estimatedInputTokensChanged ? "changed" : "unchanged"}`
  ];
  return `${lines.join("\n")}\n`;
}
