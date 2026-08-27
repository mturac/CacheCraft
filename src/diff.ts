import { canonicalJson } from "./canonical-json.js";
import { compareCodeUnits } from "./compare.js";
import { CacheCraftError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import type {
  CacheCraftManifest,
  CacheKeySource,
  JsonObject,
  ManifestDiff,
  ProviderManagedBreakpoint,
  ProviderTarget,
  SelectedBreakpoint
} from "./types.js";

const PROVIDERS = new Set<ProviderTarget>([
  "generic",
  "openai-responses",
  "openai-chat",
  "anthropic"
]);
const CACHE_KEY_SOURCES = new Set<CacheKeySource>(["compile-option", "plan", "derived"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "compiler",
  "planId",
  "planVersion",
  "provider",
  "providerConfiguration",
  "model",
  "cacheKey",
  "cacheKeySource",
  "sourceOrder",
  "compiledOrder",
  "toolNames",
  "toolsHash",
  "compiledPromptHash",
  "breakpoints",
  "providerManagedBreakpoint",
  "stablePrefixHash",
  "estimatedInputTokens",
  "contractHash"
]);
const BREAKPOINT_KEYS = new Set([
  "sectionId",
  "sectionIndex",
  "mode",
  "horizon",
  "providerTtl",
  "estimatedPrefixTokens",
  "prefixHash"
]);
const MANAGED_BREAKPOINT_KEYS = new Set([
  "mode",
  "status",
  "sectionId",
  "sectionIndex",
  "itemIndex",
  "stability",
  "horizon",
  "providerTtl",
  "estimatedPrefixTokens",
  "prefixHash"
]);

function fail(message: string, path: string, code = "CC_INVALID_MANIFEST"): never {
  throw new CacheCraftError(code, message, { path });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return fail(`Manifest field ${path} must be an object.`, path);
  }
  return value;
}

function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(`Unknown manifest field ${path}.${key}.`, `${path}.${key}`);
    }
  }
}

function requireString(record: Record<string, unknown>, key: string, path = "$."): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    return fail(`Manifest field ${key} must be a non-empty string.`, `${path}${key}`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    return fail(`Manifest field ${key} must be a non-empty string when present.`, `$.${key}`);
  }
  return value;
}

function requireSha256(record: Record<string, unknown>, key: string, path = "$." ): string {
  const value = requireString(record, key, path);
  if (!SHA256_PATTERN.test(value)) {
    return fail(`Manifest field ${key} must be a lowercase SHA-256 hex digest.`, `${path}${key}`);
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    return fail(`Manifest field ${path}.${key} must be a non-negative integer.`, `${path}.${key}`);
  }
  return value as number;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  options: { nonEmpty?: boolean; sorted?: boolean } = {}
): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    return fail(`Manifest field ${key} must be an array of non-empty strings.`, `$.${key}`);
  }
  const result = value as string[];
  if (options.nonEmpty && result.length === 0) {
    fail(`Manifest field ${key} must not be empty.`, `$.${key}`);
  }
  if (new Set(result).size !== result.length) {
    fail(`Manifest field ${key} must not contain duplicates.`, `$.${key}`);
  }
  if (options.sorted && result.some((entry, index) => index > 0
    && compareCodeUnits(result[index - 1] ?? "", entry) > 0)) {
    fail(`Manifest field ${key} must use deterministic code-unit ordering.`, `$.${key}`);
  }
  return result;
}

function validateProviderConfiguration(
  provider: ProviderTarget,
  value: unknown
): JsonObject {
  const configuration = requireRecord(value, "$.providerConfiguration");
  switch (provider) {
    case "generic":
      assertKnownKeys(configuration, new Set(["format"]), "$.providerConfiguration");
      if (configuration["format"] !== "cachecraft-logical-v1") {
        fail("Generic providerConfiguration.format must be cachecraft-logical-v1.", "$.providerConfiguration.format");
      }
      break;
    case "openai-responses":
    case "openai-chat":
      assertKnownKeys(configuration, new Set(["mode", "ttl"]), "$.providerConfiguration");
      if (configuration["mode"] !== "explicit" && configuration["mode"] !== "implicit") {
        fail("OpenAI providerConfiguration.mode must be explicit or implicit.", "$.providerConfiguration.mode");
      }
      if (configuration["ttl"] !== "30m") {
        fail("OpenAI providerConfiguration.ttl must be 30m.", "$.providerConfiguration.ttl");
      }
      break;
    case "anthropic":
      assertKnownKeys(
        configuration,
        new Set(["automatic", "automaticHorizon"]),
        "$.providerConfiguration"
      );
      if (typeof configuration["automatic"] !== "boolean") {
        fail("Anthropic providerConfiguration.automatic must be a boolean.", "$.providerConfiguration.automatic");
      }
      if (configuration["automaticHorizon"] !== "long"
        && configuration["automaticHorizon"] !== "short") {
        fail(
          "Anthropic providerConfiguration.automaticHorizon must be long or short.",
          "$.providerConfiguration.automaticHorizon"
        );
      }
      break;
  }
  canonicalJson(configuration);
  return configuration as JsonObject;
}

function validateBreakpoint(
  value: unknown,
  index: number,
  compiledOrder: string[],
  provider: ProviderTarget
): SelectedBreakpoint {
  const path = `$.breakpoints[${index}]`;
  const record = requireRecord(value, path);
  assertKnownKeys(record, BREAKPOINT_KEYS, path);
  const sectionId = requireString(record, "sectionId", `${path}.`);
  const sectionIndex = requireInteger(record, "sectionIndex", path);
  if (compiledOrder[sectionIndex] !== sectionId) {
    fail("Breakpoint sectionId and sectionIndex do not match compiledOrder.", path);
  }
  if (record["mode"] !== "required" && record["mode"] !== "preferred") {
    fail("Breakpoint mode must be required or preferred.", `${path}.mode`);
  }
  if (record["horizon"] !== "long" && record["horizon"] !== "short") {
    fail("Breakpoint horizon must be long or short.", `${path}.horizon`);
  }
  const expectedProviderTtl = provider === "generic"
    ? "logical"
    : provider === "anthropic"
      ? record["horizon"] === "long" ? "1h" : "5m"
      : "30m";
  if (record["providerTtl"] !== expectedProviderTtl) {
    fail(
      `Breakpoint providerTtl must be ${expectedProviderTtl} for ${provider} and the selected horizon.`,
      `${path}.providerTtl`
    );
  }
  requireInteger(record, "estimatedPrefixTokens", path);
  requireSha256(record, "prefixHash", `${path}.`);
  return record as unknown as SelectedBreakpoint;
}

function validateManagedBreakpoint(
  value: unknown,
  provider: ProviderTarget,
  configuration: JsonObject,
  compiledOrder: string[]
): ProviderManagedBreakpoint | null {
  if (value === null) {
    if (provider === "anthropic" && configuration["automatic"] === true) {
      fail(
        "Anthropic automatic caching requires a provider-managed boundary in a valid compiled manifest.",
        "$.providerManagedBreakpoint"
      );
    }
    return null;
  }

  const path = "$.providerManagedBreakpoint";
  const record = requireRecord(value, path);
  assertKnownKeys(record, MANAGED_BREAKPOINT_KEYS, path);
  const mode = requireString(record, "mode", `${path}.`);
  if (mode !== "openai-implicit" && mode !== "anthropic-automatic") {
    fail("Provider-managed breakpoint mode is unsupported.", `${path}.mode`);
  }
  if ((mode === "openai-implicit" && provider !== "openai-responses" && provider !== "openai-chat")
    || (mode === "anthropic-automatic" && provider !== "anthropic")) {
    fail("Provider-managed breakpoint mode does not match the manifest provider.", `${path}.mode`);
  }
  if (mode === "openai-implicit" && configuration["mode"] !== "implicit") {
    fail("OpenAI provider-managed breakpoint requires implicit mode.", path);
  }
  if (mode === "anthropic-automatic" && configuration["automatic"] !== true) {
    fail("Anthropic provider-managed breakpoint requires automatic caching.", path);
  }
  if (record["status"] !== "active" && record["status"] !== "no-op") {
    fail("Provider-managed breakpoint status must be active or no-op.", `${path}.status`);
  }
  if (mode === "openai-implicit" && record["status"] !== "active") {
    fail("OpenAI implicit provider-managed breakpoints must be active.", `${path}.status`);
  }
  const sectionId = requireString(record, "sectionId", `${path}.`);
  const sectionIndex = requireInteger(record, "sectionIndex", path);
  if (compiledOrder[sectionIndex] !== sectionId) {
    fail("Provider-managed breakpoint does not match compiledOrder.", path);
  }
  requireInteger(record, "itemIndex", path);
  if (!new Set(["global", "deployment", "session", "turn", "request"]).has(record["stability"] as string)) {
    fail("Provider-managed breakpoint stability is unsupported.", `${path}.stability`);
  }
  if (record["horizon"] !== "long" && record["horizon"] !== "short") {
    fail("Provider-managed breakpoint horizon must be long or short.", `${path}.horizon`);
  }
  if (mode === "openai-implicit") {
    if (record["providerTtl"] !== "30m") {
      fail("OpenAI implicit provider-managed breakpoint TTL must be 30m.", `${path}.providerTtl`);
    }
  } else {
    const automaticHorizon = configuration["automaticHorizon"];
    if (record["horizon"] !== automaticHorizon) {
      fail(
        "Anthropic automatic breakpoint horizon must match providerConfiguration.automaticHorizon.",
        `${path}.horizon`
      );
    }
    const expectedTtl = automaticHorizon === "long" ? "1h" : "5m";
    if (record["providerTtl"] !== expectedTtl) {
      fail(`Anthropic automatic breakpoint TTL must be ${expectedTtl}.`, `${path}.providerTtl`);
    }
  }
  requireInteger(record, "estimatedPrefixTokens", path);
  requireSha256(record, "prefixHash", `${path}.`);
  return record as unknown as ProviderManagedBreakpoint;
}

export function validateManifest(input: unknown): CacheCraftManifest {
  const record = requireRecord(input, "$");
  assertKnownKeys(record, MANIFEST_KEYS, "$");
  if (record["schemaVersion"] !== "1") {
    fail("Manifest schemaVersion must be exactly \"1\".", "$.schemaVersion");
  }

  const compiler = requireRecord(record["compiler"], "$.compiler");
  assertKnownKeys(compiler, new Set(["name", "version"]), "$.compiler");
  if (compiler["name"] !== "@mturac/cachecraft") {
    fail("Manifest compiler.name must be @mturac/cachecraft.", "$.compiler.name");
  }
  requireString(compiler, "version", "$.compiler.");
  requireString(record, "planId");
  requireString(record, "planVersion");

  const providerValue = requireString(record, "provider");
  if (!PROVIDERS.has(providerValue as ProviderTarget)) {
    fail(`Manifest provider must be one of: ${[...PROVIDERS].join(", ")}.`, "$.provider");
  }
  const provider = providerValue as ProviderTarget;
  const configuration = validateProviderConfiguration(provider, record["providerConfiguration"]);
  const model = optionalString(record, "model");
  if (provider !== "generic" && model === undefined) {
    fail("Provider-specific manifests must record a model.", "$.model");
  }
  const cacheKey = requireString(record, "cacheKey");
  if (cacheKey.length > 64) {
    fail("Manifest cacheKey must contain at most 64 characters.", "$.cacheKey");
  }
  const cacheKeySource = requireString(record, "cacheKeySource");
  if (!CACHE_KEY_SOURCES.has(cacheKeySource as CacheKeySource)) {
    fail("Manifest cacheKeySource is unsupported.", "$.cacheKeySource");
  }

  const sourceOrder = requireStringArray(record, "sourceOrder", { nonEmpty: true });
  const compiledOrder = requireStringArray(record, "compiledOrder", { nonEmpty: true });
  if (sourceOrder.length !== compiledOrder.length
    || sourceOrder.some((id) => !compiledOrder.includes(id))) {
    fail("sourceOrder and compiledOrder must contain the same section IDs.", "$.compiledOrder");
  }
  requireStringArray(record, "toolNames", { sorted: true });
  requireSha256(record, "toolsHash");
  requireSha256(record, "compiledPromptHash");

  const rawBreakpoints = record["breakpoints"];
  if (!Array.isArray(rawBreakpoints)) {
    fail("Manifest breakpoints must be an array.", "$.breakpoints");
  }
  const breakpoints = rawBreakpoints.map((value, index) => validateBreakpoint(value, index, compiledOrder, provider));
  if (breakpoints.some((breakpoint, index) => index > 0
    && (breakpoints[index - 1]?.sectionIndex ?? -1) >= breakpoint.sectionIndex)) {
    fail("Manifest breakpoints must be ordered by increasing sectionIndex.", "$.breakpoints");
  }

  const providerManagedBreakpoint = validateManagedBreakpoint(
    record["providerManagedBreakpoint"],
    provider,
    configuration,
    compiledOrder
  );

  const explicitBudget = (provider === "openai-responses" || provider === "openai-chat")
    ? configuration["mode"] === "implicit" ? 3 : 4
    : provider === "anthropic"
      ? configuration["automatic"] === true && providerManagedBreakpoint?.status !== "no-op" ? 3 : 4
      : 4;
  if (breakpoints.length > explicitBudget) {
    fail(
      `Manifest contains ${breakpoints.length} explicit breakpoints but ${provider} permits ${explicitBudget} for this mode.`,
      "$.breakpoints"
    );
  }

  if (provider === "anthropic") {
    let shortSeen = false;
    for (const breakpoint of breakpoints) {
      if (breakpoint.horizon === "short") {
        shortSeen = true;
      } else if (shortSeen) {
        fail("Anthropic long-TTL breakpoints must precede short-TTL breakpoints.", "$.breakpoints");
      }
    }

    if (providerManagedBreakpoint !== null) {
      const finalSectionIndex = compiledOrder.length - 1;
      if (providerManagedBreakpoint.sectionIndex !== finalSectionIndex) {
        fail(
          "Anthropic automatic caching must target the final compiled section.",
          "$.providerManagedBreakpoint.sectionIndex"
        );
      }
      const explicitAtManagedBoundary = breakpoints.find(
        (breakpoint) => breakpoint.sectionIndex === providerManagedBreakpoint.sectionIndex
      );
      if (providerManagedBreakpoint.status === "no-op") {
        if (explicitAtManagedBoundary === undefined
          || explicitAtManagedBoundary.horizon !== providerManagedBreakpoint.horizon
          || explicitAtManagedBoundary.prefixHash !== providerManagedBreakpoint.prefixHash) {
          fail(
            "Anthropic automatic no-op status requires an identical final explicit breakpoint.",
            "$.providerManagedBreakpoint.status"
          );
        }
      } else {
        if (explicitAtManagedBoundary !== undefined) {
          fail(
            "An active Anthropic automatic boundary cannot duplicate a final explicit breakpoint.",
            "$.providerManagedBreakpoint.status"
          );
        }
        if (providerManagedBreakpoint.horizon === "long"
          && breakpoints.some((breakpoint) => breakpoint.horizon === "short")) {
          fail(
            "An active Anthropic long automatic boundary cannot follow an explicit short boundary.",
            "$.providerManagedBreakpoint.horizon"
          );
        }
      }
    }
  }

  const stablePrefixHash = record["stablePrefixHash"];
  if (stablePrefixHash !== null
    && (typeof stablePrefixHash !== "string" || !SHA256_PATTERN.test(stablePrefixHash))) {
    fail("Manifest stablePrefixHash must be null or a lowercase SHA-256 hex digest.", "$.stablePrefixHash");
  }
  const expectedStablePrefixHash = breakpoints.at(-1)?.prefixHash ?? null;
  if (stablePrefixHash !== expectedStablePrefixHash) {
    fail("Manifest stablePrefixHash must match the final explicit breakpoint hash.", "$.stablePrefixHash");
  }
  requireInteger(record, "estimatedInputTokens", "$");

  const contractHash = requireSha256(record, "contractHash");
  const contractInput = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "contractHash")
  );
  const expectedContractHash = sha256Hex(contractInput);
  if (contractHash !== expectedContractHash) {
    fail(
      "Manifest contractHash does not match the canonical manifest contents.",
      "$.contractHash",
      "CC_MANIFEST_HASH_MISMATCH"
    );
  }

  return {
    ...(record as unknown as CacheCraftManifest),
    provider,
    providerConfiguration: configuration,
    cacheKeySource: cacheKeySource as CacheKeySource,
    sourceOrder,
    compiledOrder,
    breakpoints,
    providerManagedBreakpoint,
    stablePrefixHash
  };
}

export function diffManifests(beforeInput: unknown, afterInput: unknown): ManifestDiff {
  const before = validateManifest(beforeInput);
  const after = validateManifest(afterInput);
  const contractHashChanged = before.contractHash !== after.contractHash;
  const compilerChanged = canonicalJson(before.compiler) !== canonicalJson(after.compiler);
  const planIdChanged = before.planId !== after.planId;
  const planVersionChanged = before.planVersion !== after.planVersion;
  const stablePrefixHashChanged = before.stablePrefixHash !== after.stablePrefixHash;
  const providerChanged = before.provider !== after.provider;
  const providerConfigurationChanged = canonicalJson(before.providerConfiguration)
    !== canonicalJson(after.providerConfiguration);
  const modelChanged = before.model !== after.model;
  const cacheKeyChanged = before.cacheKey !== after.cacheKey;
  const cacheKeySourceChanged = before.cacheKeySource !== after.cacheKeySource;
  const promptChanged = before.compiledPromptHash !== after.compiledPromptHash;
  const sourceOrderChanged = canonicalJson(before.sourceOrder) !== canonicalJson(after.sourceOrder);
  const orderChanged = canonicalJson(before.compiledOrder) !== canonicalJson(after.compiledOrder);
  const toolsChanged = before.toolsHash !== after.toolsHash;
  const breakpointsChanged = canonicalJson(before.breakpoints) !== canonicalJson(after.breakpoints);
  const providerManagedBreakpointChanged = canonicalJson(before.providerManagedBreakpoint)
    !== canonicalJson(after.providerManagedBreakpoint);
  const estimatedInputTokensChanged = before.estimatedInputTokens !== after.estimatedInputTokens;

  return {
    changed: contractHashChanged || compilerChanged || planIdChanged || planVersionChanged
      || stablePrefixHashChanged || providerChanged || providerConfigurationChanged || modelChanged
      || cacheKeyChanged || cacheKeySourceChanged || promptChanged || sourceOrderChanged
      || orderChanged || toolsChanged || breakpointsChanged || providerManagedBreakpointChanged
      || estimatedInputTokensChanged,
    contractHashChanged,
    compilerChanged,
    planIdChanged,
    planVersionChanged,
    stablePrefixHashChanged,
    providerChanged,
    providerConfigurationChanged,
    modelChanged,
    cacheKeyChanged,
    cacheKeySourceChanged,
    promptChanged,
    sourceOrderChanged,
    orderChanged,
    toolsChanged,
    breakpointsChanged,
    providerManagedBreakpointChanged,
    estimatedInputTokensChanged,
    beforeContractHash: before.contractHash,
    afterContractHash: after.contractHash
  };
}
