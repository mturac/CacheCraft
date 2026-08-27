import { canonicalJson } from "./canonical-json.js";
import { CacheCraftError } from "./errors.js";
import type {
  AnthropicProviderOptions,
  CacheHorizon,
  CacheIntent,
  CacheMode,
  JsonObject,
  OpenAIProviderOptions,
  OrderPolicy,
  PromptItem,
  PromptLane,
  PromptPlan,
  PromptRole,
  PromptSection,
  ProviderOptions,
  Stability,
  ToolDefinition
} from "./types.js";

const PLAN_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "id",
  "version",
  "model",
  "maxTokens",
  "cacheKey",
  "sections",
  "tools",
  "providerOptions"
]);
const SECTION_KEYS = new Set(["id", "lane", "stability", "order", "cache", "before", "after", "items"]);
const ITEM_KEYS = new Set(["role", "content"]);
const CACHE_KEYS = new Set(["mode", "horizon"]);
const TOOL_KEYS = new Set(["name", "description", "inputSchema"]);
const PROVIDER_KEYS = new Set(["openai", "anthropic"]);
const OPENAI_KEYS = new Set(["mode"]);
const ANTHROPIC_KEYS = new Set(["automatic", "automaticHorizon"]);

const STABILITIES = new Set<Stability>(["global", "deployment", "session", "turn", "request"]);
const LANES = new Set<PromptLane>(["instructions", "conversation"]);
const ROLES = new Set<PromptRole>(["system", "developer", "user", "assistant"]);
const ORDER_POLICIES = new Set<OrderPolicy>(["optimize", "preserve"]);
const CACHE_MODES = new Set<CacheMode>(["required", "preferred", "never"]);
const CACHE_HORIZONS = new Set<CacheHorizon>(["long", "short"]);

function error(code: string, message: string, path: string): never {
  throw new CacheCraftError(code, message, { path });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return error("CC_INVALID_PLAN", `Expected an object at ${path}.`, path);
  }
  return value;
}

function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      error("CC_UNKNOWN_PROPERTY", `Unknown property ${path}.${key}.`, `${path}.${key}`);
    }
  }
}

function requiredString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return error("CC_INVALID_PLAN", `Expected ${path}.${key} to be a non-empty string.`, `${path}.${key}`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return error("CC_INVALID_PLAN", `Expected ${path}.${key} to be a non-empty string.`, `${path}.${key}`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return error("CC_INVALID_PLAN", `Expected ${path} to be an array of section IDs.`, path);
  }

  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return error("CC_INVALID_PLAN", `Expected ${path}[${index}] to be a non-empty string.`, `${path}[${index}]`);
    }
    return entry;
  });

  if (new Set(result).size !== result.length) {
    error("CC_DUPLICATE_DEPENDENCY", `Duplicate dependency in ${path}.`, path);
  }
  return result;
}

function parseItem(value: unknown, path: string, lane: PromptLane): PromptItem {
  const record = objectAt(value, path);
  assertKnownKeys(record, ITEM_KEYS, path);
  const role = requiredString(record, "role", path);
  if (!ROLES.has(role as PromptRole)) {
    return error("CC_INVALID_PLAN", `Unsupported prompt role at ${path}.role.`, `${path}.role`);
  }
  const typedRole = role as PromptRole;
  if (lane === "instructions" && typedRole !== "system" && typedRole !== "developer") {
    return error(
      "CC_ROLE_LANE_MISMATCH",
      `Role ${typedRole} is not valid in the instructions lane.`,
      `${path}.role`
    );
  }
  if (lane === "conversation" && typedRole !== "user" && typedRole !== "assistant") {
    return error(
      "CC_ROLE_LANE_MISMATCH",
      `Role ${typedRole} is not valid in the conversation lane.`,
      `${path}.role`
    );
  }

  return {
    role: typedRole,
    content: requiredString(record, "content", path)
  };
}

function parseCache(value: unknown, path: string): CacheIntent {
  if (value === undefined) {
    return { mode: "never", horizon: "short" };
  }
  const record = objectAt(value, path);
  assertKnownKeys(record, CACHE_KEYS, path);
  const mode = requiredString(record, "mode", path);
  const horizon = requiredString(record, "horizon", path);
  if (!CACHE_MODES.has(mode as CacheMode)) {
    return error("CC_INVALID_PLAN", `Unsupported cache mode at ${path}.mode.`, `${path}.mode`);
  }
  if (!CACHE_HORIZONS.has(horizon as CacheHorizon)) {
    return error("CC_INVALID_PLAN", `Unsupported cache horizon at ${path}.horizon.`, `${path}.horizon`);
  }
  return { mode: mode as CacheMode, horizon: horizon as CacheHorizon };
}

function parseSection(value: unknown, index: number): PromptSection {
  const path = `$.sections[${index}]`;
  const record = objectAt(value, path);
  assertKnownKeys(record, SECTION_KEYS, path);

  const laneValue = requiredString(record, "lane", path);
  if (!LANES.has(laneValue as PromptLane)) {
    return error("CC_INVALID_PLAN", `Unsupported lane at ${path}.lane.`, `${path}.lane`);
  }
  const lane = laneValue as PromptLane;

  const stabilityValue = requiredString(record, "stability", path);
  if (!STABILITIES.has(stabilityValue as Stability)) {
    return error("CC_INVALID_PLAN", `Unsupported stability at ${path}.stability.`, `${path}.stability`);
  }

  const rawOrder = record["order"];
  const defaultOrder: OrderPolicy = "preserve";
  const order = rawOrder === undefined ? defaultOrder : rawOrder;
  if (typeof order !== "string" || !ORDER_POLICIES.has(order as OrderPolicy)) {
    return error("CC_INVALID_PLAN", `Unsupported order policy at ${path}.order.`, `${path}.order`);
  }

  const rawItems = record["items"];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return error("CC_INVALID_PLAN", `Expected ${path}.items to contain at least one item.`, `${path}.items`);
  }

  return {
    id: requiredString(record, "id", path),
    lane,
    stability: stabilityValue as Stability,
    order: order as OrderPolicy,
    cache: parseCache(record["cache"], `${path}.cache`),
    before: stringArray(record["before"], `${path}.before`),
    after: stringArray(record["after"], `${path}.after`),
    items: rawItems.map((item, itemIndex) => parseItem(item, `${path}.items[${itemIndex}]`, lane))
  };
}

function parseTool(value: unknown, index: number): ToolDefinition {
  const path = `$.tools[${index}]`;
  const record = objectAt(value, path);
  assertKnownKeys(record, TOOL_KEYS, path);
  const inputSchema = objectAt(record["inputSchema"], `${path}.inputSchema`) as JsonObject;
  canonicalJson(inputSchema);

  const name = requiredString(record, "name", path);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    return error(
      "CC_INVALID_TOOL_NAME",
      "Tool names must contain 1-64 ASCII letters, digits, underscores, or hyphens.",
      `${path}.name`
    );
  }
  const description = optionalString(record, "description", path);
  const tool: ToolDefinition = {
    name,
    inputSchema
  };
  if (description !== undefined) {
    tool.description = description;
  }
  return tool;
}

function parseProviderOptions(value: unknown): ProviderOptions {
  if (value === undefined) {
    return {
      openai: { mode: "explicit" },
      anthropic: { automatic: false, automaticHorizon: "short" }
    };
  }

  const record = objectAt(value, "$.providerOptions");
  assertKnownKeys(record, PROVIDER_KEYS, "$.providerOptions");

  const openaiRecord = record["openai"] === undefined
    ? {}
    : objectAt(record["openai"], "$.providerOptions.openai");
  assertKnownKeys(openaiRecord, OPENAI_KEYS, "$.providerOptions.openai");
  const openaiMode = openaiRecord["mode"] ?? "explicit";
  if (openaiMode !== "explicit" && openaiMode !== "implicit") {
    return error(
      "CC_INVALID_PLAN",
      "OpenAI cache mode must be explicit or implicit.",
      "$.providerOptions.openai.mode"
    );
  }
  const openai: OpenAIProviderOptions = { mode: openaiMode };

  const anthropicRecord = record["anthropic"] === undefined
    ? {}
    : objectAt(record["anthropic"], "$.providerOptions.anthropic");
  assertKnownKeys(anthropicRecord, ANTHROPIC_KEYS, "$.providerOptions.anthropic");
  const automatic = anthropicRecord["automatic"] ?? false;
  if (typeof automatic !== "boolean") {
    return error(
      "CC_INVALID_PLAN",
      "Anthropic automatic must be a boolean.",
      "$.providerOptions.anthropic.automatic"
    );
  }
  const automaticHorizon = anthropicRecord["automaticHorizon"] ?? "short";
  if (automaticHorizon !== "long" && automaticHorizon !== "short") {
    return error(
      "CC_INVALID_PLAN",
      "Anthropic automaticHorizon must be long or short.",
      "$.providerOptions.anthropic.automaticHorizon"
    );
  }
  const anthropic: AnthropicProviderOptions = { automatic, automaticHorizon };

  return { openai, anthropic };
}

function explicitEdges(sections: PromptSection[]): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const section of sections) {
    edges.set(section.id, new Set());
  }
  for (const section of sections) {
    for (const dependency of section.after) {
      edges.get(dependency)?.add(section.id);
    }
    for (const target of section.before) {
      edges.get(section.id)?.add(target);
    }
  }
  return edges;
}

function assertAcyclic(sections: PromptSection[]): void {
  const edges = explicitEdges(sections);
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "visited") {
      return;
    }
    if (current === "visiting") {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      throw new CacheCraftError(
        "CC_DEPENDENCY_CYCLE",
        `Dependency cycle detected: ${cycle.join(" -> ")}.`,
        { details: { cycle } }
      );
    }

    state.set(id, "visiting");
    stack.push(id);
    for (const target of edges.get(id) ?? []) {
      visit(target);
    }
    stack.pop();
    state.set(id, "visited");
  };

  for (const section of sections) {
    visit(section.id);
  }
}

export function validatePromptPlan(input: unknown): PromptPlan {
  const record = objectAt(input, "$");
  assertKnownKeys(record, PLAN_KEYS, "$");
  const schemaReference = record["$schema"];
  if (schemaReference !== undefined
    && (typeof schemaReference !== "string" || schemaReference.trim().length === 0)) {
    return error("CC_INVALID_PLAN", "$schema must be a non-empty string when present.", "$.$schema");
  }
  if (record["schemaVersion"] !== "1") {
    return error("CC_UNSUPPORTED_SCHEMA_VERSION", "schemaVersion must be exactly \"1\".", "$.schemaVersion");
  }

  const rawSections = record["sections"];
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    return error("CC_INVALID_PLAN", "sections must contain at least one section.", "$.sections");
  }
  const sections = rawSections.map(parseSection);
  const sectionIds = new Set<string>();
  for (const section of sections) {
    if (sectionIds.has(section.id)) {
      throw new CacheCraftError(
        "CC_DUPLICATE_SECTION_ID",
        `Duplicate section ID: ${section.id}.`,
        { path: "$.sections", details: { sectionId: section.id } }
      );
    }
    sectionIds.add(section.id);
  }

  for (const section of sections) {
    for (const dependency of [...section.before, ...section.after]) {
      if (!sectionIds.has(dependency)) {
        throw new CacheCraftError(
          "CC_UNKNOWN_DEPENDENCY",
          `Section ${section.id} references unknown dependency ${dependency}.`,
          { details: { sectionId: section.id, dependency } }
        );
      }
    }
  }
  assertAcyclic(sections);

  const rawTools = record["tools"] ?? [];
  if (!Array.isArray(rawTools)) {
    return error("CC_INVALID_PLAN", "tools must be an array.", "$.tools");
  }
  const tools = rawTools.map(parseTool);
  const toolNames = new Set<string>();
  for (const tool of tools) {
    if (toolNames.has(tool.name)) {
      throw new CacheCraftError(
        "CC_DUPLICATE_TOOL_NAME",
        `Duplicate tool name: ${tool.name}.`,
        { path: "$.tools", details: { toolName: tool.name } }
      );
    }
    toolNames.add(tool.name);
  }

  const plan: PromptPlan = {
    schemaVersion: "1",
    id: requiredString(record, "id", "$"),
    version: requiredString(record, "version", "$"),
    sections,
    tools,
    providerOptions: parseProviderOptions(record["providerOptions"])
  };
  const model = optionalString(record, "model", "$");
  const rawMaxTokens = record["maxTokens"];
  if (rawMaxTokens !== undefined) {
    if (!Number.isInteger(rawMaxTokens) || (rawMaxTokens as number) <= 0) {
      return error("CC_INVALID_PLAN", "maxTokens must be a positive integer.", "$.maxTokens");
    }
    plan.maxTokens = rawMaxTokens as number;
  }
  const cacheKey = optionalString(record, "cacheKey", "$");
  if (cacheKey !== undefined && cacheKey.length > 64) {
    return error(
      "CC_INVALID_CACHE_KEY",
      "cacheKey must contain at most 64 characters for provider portability.",
      "$.cacheKey"
    );
  }
  if (model !== undefined) {
    plan.model = model;
  }
  if (cacheKey !== undefined) {
    plan.cacheKey = cacheKey;
  }
  return plan;
}
