export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export type Stability = "global" | "deployment" | "session" | "turn" | "request";
export type PromptLane = "instructions" | "conversation";
export type PromptRole = "system" | "developer" | "user" | "assistant";
export type OrderPolicy = "optimize" | "preserve";
export type CacheMode = "required" | "preferred" | "never";
export type CacheHorizon = "long" | "short";
export type ProviderTarget = "generic" | "openai-responses" | "openai-chat" | "anthropic";
export type DiagnosticSeverity = "info" | "warning";
export type CacheKeySource = "compile-option" | "plan" | "derived";
export type ProviderManagedBreakpointMode = "openai-implicit" | "anthropic-automatic";
export type ProviderManagedBreakpointStatus = "active" | "no-op";

export interface PromptItem {
  role: PromptRole;
  content: string;
}

export interface CacheIntent {
  mode: CacheMode;
  horizon: CacheHorizon;
}

export interface PromptSectionInput {
  id: string;
  lane: PromptLane;
  stability: Stability;
  order?: OrderPolicy;
  cache?: CacheIntent;
  before?: readonly string[];
  after?: readonly string[];
  items: readonly PromptItem[];
}

export interface PromptSection {
  id: string;
  lane: PromptLane;
  stability: Stability;
  order: OrderPolicy;
  cache: CacheIntent;
  before: string[];
  after: string[];
  items: PromptItem[];
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonObject;
}

export interface OpenAIProviderOptions {
  mode: "explicit" | "implicit";
}

export interface AnthropicProviderOptions {
  automatic: boolean;
  automaticHorizon: CacheHorizon;
}

export interface ProviderOptions {
  openai: OpenAIProviderOptions;
  anthropic: AnthropicProviderOptions;
}

export interface ProviderOptionsInput {
  openai?: Partial<OpenAIProviderOptions>;
  anthropic?: Partial<AnthropicProviderOptions>;
}

export interface PromptPlanInput {
  $schema?: string;
  schemaVersion: "1";
  id: string;
  version: string;
  model?: string;
  maxTokens?: number;
  cacheKey?: string;
  sections: readonly PromptSectionInput[];
  tools?: readonly ToolDefinition[];
  providerOptions?: ProviderOptionsInput;
}

export interface PromptPlan {
  schemaVersion: "1";
  id: string;
  version: string;
  model?: string;
  maxTokens?: number;
  cacheKey?: string;
  sections: PromptSection[];
  tools: ToolDefinition[];
  providerOptions: ProviderOptions;
}

export interface CompileOptions {
  provider: ProviderTarget;
  model?: string;
  cacheKey?: string;
}

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  sectionId?: string;
  details?: JsonObject;
}

export interface OrderedPlan {
  plan: PromptPlan;
  sections: PromptSection[];
  diagnostics: Diagnostic[];
}

export interface SelectedBreakpoint {
  sectionId: string;
  sectionIndex: number;
  mode: Exclude<CacheMode, "never">;
  horizon: CacheHorizon;
  providerTtl: "1h" | "5m" | "30m" | "logical";
  estimatedPrefixTokens: number;
  prefixHash: string;
}

export interface ProviderManagedBreakpoint {
  mode: ProviderManagedBreakpointMode;
  status: ProviderManagedBreakpointStatus;
  sectionId: string;
  sectionIndex: number;
  itemIndex: number;
  stability: Stability;
  horizon: CacheHorizon;
  providerTtl: "1h" | "5m" | "30m";
  estimatedPrefixTokens: number;
  prefixHash: string;
}

export interface CacheCraftManifest {
  schemaVersion: "1";
  compiler: {
    name: "@mturac/cachecraft";
    version: string;
  };
  planId: string;
  planVersion: string;
  provider: ProviderTarget;
  providerConfiguration: JsonObject;
  model?: string;
  cacheKey: string;
  cacheKeySource: CacheKeySource;
  sourceOrder: string[];
  compiledOrder: string[];
  toolNames: string[];
  toolsHash: string;
  compiledPromptHash: string;
  breakpoints: SelectedBreakpoint[];
  providerManagedBreakpoint: ProviderManagedBreakpoint | null;
  stablePrefixHash: string | null;
  estimatedInputTokens: number;
  contractHash: string;
}

export interface CompilationResult {
  payload: JsonObject;
  manifest: CacheCraftManifest;
  diagnostics: Diagnostic[];
}

export interface ManifestDiff {
  changed: boolean;
  contractHashChanged: boolean;
  compilerChanged: boolean;
  planIdChanged: boolean;
  planVersionChanged: boolean;
  stablePrefixHashChanged: boolean;
  providerChanged: boolean;
  providerConfigurationChanged: boolean;
  modelChanged: boolean;
  cacheKeyChanged: boolean;
  cacheKeySourceChanged: boolean;
  promptChanged: boolean;
  sourceOrderChanged: boolean;
  orderChanged: boolean;
  toolsChanged: boolean;
  breakpointsChanged: boolean;
  providerManagedBreakpointChanged: boolean;
  estimatedInputTokensChanged: boolean;
  beforeContractHash: string;
  afterContractHash: string;
}
