# CacheCraft

<p align="center">
  <img src="docs/assets/cachecraft-hero.jpg" alt="CacheCraft — deterministic cache-aware prompt compiler" width="100%" />
</p>

[![CI](https://github.com/mturac/CacheCraft/actions/workflows/ci.yml/badge.svg)](https://github.com/mturac/CacheCraft/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Compile provider-neutral prompt plans into deterministic, cache-aware OpenAI and Anthropic requests.**

Prompt caches reuse an exact prefix. A timestamp, reordered tool schema, or request-specific block placed too early can invalidate every reusable token that follows it. CacheCraft makes prompt layout and cache boundaries explicit before a request reaches a provider.

It is an offline compiler, not a proxy:

```text
Prompt plan
  -> validation
  -> safe ordering
  -> breakpoint planning
  -> provider rendering
  -> cache contract manifest
```

CacheCraft performs no inference calls, accepts no API keys, emits no telemetry, and has zero runtime dependencies. Version 0.1 compiles text messages and function tools; multimodal content and tool-result messages are intentionally outside the initial schema.

## Why CacheCraft

Provider prompt caching is powerful but easy to configure incorrectly:

- cache hits require an identical rendered prefix;
- tools, schemas, messages, multimodal blocks, and their ordering can affect that prefix;
- OpenAI and Anthropic expose different breakpoint, TTL, and automatic-caching controls;
- moving prompt blocks can improve reuse but can also change semantics;
- runtime cache regressions are hard to diagnose without a known compile-time contract.

CacheCraft gives applications one declarative prompt plan and produces:

- stable provider payloads;
- explicit and provider-managed breakpoint evidence;
- deterministic tool ordering and canonical schema serialization;
- a stable or caller-supplied cache key;
- SHA-256 hashes for tools, prompt material, prefixes, and the complete contract;
- diagnostics for unsafe layouts and provider compatibility limits;
- manifest comparison suitable for CI.

## Safety model

CacheCraft is conservative by default.

All sections default to `order: "preserve"`. CacheCraft reorders a section only when its author explicitly sets `order: "optimize"`. Preserved sections are anchors: optimized sections cannot move across them. Use `order: "optimize"` only when movement inside that anchored region is semantically safe. Conversation history remains preserved unless explicitly modeled otherwise.

Cache intent and ordering intent are separate:

- `order` controls whether a section may move;
- `cache.mode` controls whether CacheCraft must, should, or must not emit an explicit breakpoint after it.

## Installation

The npm package name is `@mturac/cachecraft`:

```bash
npm install --save-dev @mturac/cachecraft
```

Until the first npm publication is available, build from source:

```bash
git clone https://github.com/mturac/CacheCraft.git
cd CacheCraft
npm ci
npm run build
node bin/cachecraft.mjs --help
```

Requirements: Node.js 22 or newer.

## Quick start

Create a provider-neutral plan:

```json
{
  "$schema": "./node_modules/@mturac/cachecraft/schema/cachecraft.schema.json",
  "schemaVersion": "1",
  "id": "support-agent",
  "version": "2026-08-27",
  "model": "gpt-5.6",
  "maxTokens": 1024,
  "providerOptions": {
    "openai": { "mode": "explicit" },
    "anthropic": { "automatic": false }
  },
  "tools": [
    {
      "name": "lookup_order",
      "description": "Look up an order by identifier.",
      "inputSchema": {
        "type": "object",
        "properties": { "order_id": { "type": "string" } },
        "required": ["order_id"],
        "additionalProperties": false
      }
    }
  ],
  "sections": [
    {
      "id": "global-policy",
      "lane": "instructions",
      "stability": "global",
      "order": "optimize",
      "cache": { "mode": "required", "horizon": "long" },
      "items": [
        { "role": "developer", "content": "Long, stable support policy..." }
      ]
    },
    {
      "id": "request",
      "lane": "conversation",
      "stability": "request",
      "order": "preserve",
      "items": [
        { "role": "user", "content": "Where is order 1234?" }
      ]
    }
  ]
}
```

Compile an OpenAI Responses request and its manifest:

```bash
cachecraft compile plan.json \
  --provider openai-responses \
  --cache-key session:customer-42 \
  --out request.json \
  --manifest-out cache-contract.json
```

Inspect the layout without writing files:

```bash
cachecraft explain plan.json \
  --provider openai-responses \
  --cache-key session:customer-42
```

Compare two cache contracts in CI:

```bash
cachecraft diff before.json after.json --fail-on-change
```

`diff --fail-on-change` exits with code `2` when the contract changed. Validation and operational errors exit with code `1`.

Plans can also be read from stdin:

```bash
cat plan.json | cachecraft compile - --provider generic
```

## CLI

```text
cachecraft compile <plan.json|-> --provider <provider>
  [--model <model>]
  [--cache-key <key>]
  [--out <payload.json>]
  [--manifest-out <manifest.json>]

cachecraft explain <plan.json|-> --provider <provider>
  [--model <model>]
  [--cache-key <key>]

cachecraft diff <before-manifest.json> <after-manifest.json>
  [--json]
  [--fail-on-change]

cachecraft --version
cachecraft --help
```

Supported targets:

- `openai-responses`
- `openai-chat`
- `anthropic`
- `generic`

Machine-readable command output goes to stdout. Diagnostics and errors go to stderr. File outputs are written atomically.

## Library API

```ts
import {
  CacheCraftError,
  compilePromptPlan,
  diffManifests,
  explainCompilation,
  type PromptPlanInput
} from "@mturac/cachecraft";

const plan: PromptPlanInput = {
  schemaVersion: "1",
  id: "support-agent",
  version: "1",
  sections: [
    {
      id: "policy",
      lane: "instructions",
      stability: "global",
      items: [{ role: "developer", content: "Stable policy" }]
    },
    {
      id: "request",
      lane: "conversation",
      stability: "request",
      items: [{ role: "user", content: "Hello" }]
    }
  ]
};

const result = compilePromptPlan(plan, {
  provider: "openai-responses",
  model: "gpt-5.6",
  cacheKey: "session:customer-42"
});

console.log(result.payload);
console.log(result.manifest.contractHash);
console.log(explainCompilation(result));
```

The main result is:

```ts
interface CompilationResult {
  payload: JsonObject;
  manifest: CacheCraftManifest;
  diagnostics: Diagnostic[];
}
```

All expected failures are `CacheCraftError` values with a stable `code`, optional JSON path, and structured details. The package root deliberately exposes only the supported compiler, validation, diff, and explanation APIs; ordering, hashing, breakpoint selection, and provider rendering stages remain internal.

## Prompt plan model

### Lanes

`instructions`
: Accepts `system` and `developer` items. Every instruction section is rendered before conversation sections.

`conversation`
: Accepts `user` and `assistant` items. Source order is preserved by default.

### Stability

From most stable to most volatile:

1. `global`
2. `deployment`
3. `session`
4. `turn`
5. `request`

Stability is an ordering signal, not a claim that CacheCraft can prove from a single request. Authors are responsible for assigning the correct lifetime.

### Ordering

`preserve`
: Keep source order. This is the default for every section.

`optimize`
: Permit deterministic reordering inside the region bounded by preserved sections, when dependency constraints allow it. CacheCraft prioritizes more stable content and then cache intent.

Use `before` and `after` for semantic dependencies:

```json
{
  "id": "policy-examples",
  "before": ["request"],
  "after": ["global-policy"]
}
```

Unknown dependencies and dependency cycles are hard errors. Dependencies cannot move conversation content ahead of instructions.

### Cache intent

```json
{
  "cache": {
    "mode": "required",
    "horizon": "long"
  }
}
```

Modes:

- `required`: an explicit breakpoint must be emitted or compilation fails;
- `preferred`: emit when provider write-slot capacity permits;
- `never`: do not emit an explicit breakpoint after this section.

Horizons:

- `long`
- `short`

They are logical lifetimes. The provider adapter maps them to supported TTLs and emits a diagnostic when the distinction cannot be retained.

### Tools

Tools are validated, sorted by Unicode code-unit order, and rendered with canonical input schemas. Changes to tool names, descriptions, schemas, or ordering alter the tool and prompt hashes.

Portable tool names use 1–64 ASCII letters, digits, underscores, or hyphens.

### Cache keys

Precedence is:

1. `CompileOptions.cacheKey` or CLI `--cache-key`;
2. plan-level `cacheKey`;
3. a deterministic key derived from plan ID and version.

Cache keys are limited to 64 characters for provider portability. The derived key is useful for low-volume and repeatable builds, but it groups the whole plan version under one key. OpenAI recommends partitioning high-volume traffic with a stable mapping such as a session, user, or deterministic shard key. CacheCraft emits `CC110_DERIVED_CACHE_KEY_UNSHARDED` when an OpenAI request relies on the derived key.

Do not put secrets in cache keys.

## Provider behavior

Provider contracts are version-sensitive. CacheCraft 0.1.0 targets the provider documentation available on 2026-08-27.

| Target | Cache controls | Explicit write budget | TTL mapping | Important behavior |
|---|---|---:|---|---|
| OpenAI Responses | GPT-5.6+ explicit or implicit mode | 4 explicit, or 3 explicit plus one provider-managed implicit boundary | request-wide `30m` | Prefix through each breakpoint must contain at least 1,024 tokens |
| OpenAI Chat Completions | GPT-5.6+ explicit or implicit mode | 4 explicit, or 3 explicit plus implicit | request-wide `30m` | Uses Chat content-block breakpoint markers |
| Anthropic Messages | explicit block markers and optional automatic caching | 4 total; automatic caching normally consumes one slot | `5m` or `1h` | Long-TTL breakpoints must appear before short-TTL breakpoints |
| Generic | logical CacheCraft metadata | 4 | `long` / `short` | Intended for adapters, tests, and inspection |

### OpenAI

CacheCraft:

- emits `prompt_cache_key`;
- emits `prompt_cache_options.mode` and `ttl: "30m"`;
- attaches `prompt_cache_breakpoint: { "mode": "explicit" }` to selected content blocks;
- records the latest implicit user-message boundary in the manifest when mode is `implicit`;
- warns when implicit caching includes a volatile `turn` or `request` suffix;
- rejects known OpenAI model names below GPT-5.6 for explicit/implicit breakpoint controls;
- warns instead of guessing for custom model aliases whose capability cannot be verified.

### Anthropic

CacheCraft:

- renders instructions into top-level `system` blocks and conversation into `messages`;
- emits block-level `cache_control` with a 5-minute or 1-hour TTL;
- supports top-level automatic caching;
- reserves automatic caching's write slot unless the final required explicit breakpoint has the same TTL and makes automatic caching a no-op;
- replaces a redundant preferred final marker with the automatic boundary;
- drops a preferred breakpoint when keeping it would violate Anthropic's long-before-short TTL ordering;
- rejects conflicting final TTLs and invalid required long-after-short layouts;
- records whether the automatic boundary is active or a no-op.

## Cache contract manifest

The manifest is evidence for what CacheCraft compiled, not a runtime cache-hit report.

It records:

- compiler, plan, provider, model, and provider configuration;
- cache key and whether it came from the compile call, plan, or derivation;
- source and compiled section order;
- deterministic tool names and `toolsHash`;
- `compiledPromptHash`;
- every explicit breakpoint and prefix hash;
- the provider-managed implicit or automatic breakpoint, when applicable;
- estimated input and prefix token counts;
- `stablePrefixHash` for the last explicit boundary;
- `contractHash` over the canonical manifest contents.

`compiledPromptHash`, prefix hashes, and `stablePrefixHash` cover CacheCraft's canonical **logical** prompt material. They are deterministic cross-provider evidence, not hashes of provider wire bytes. `validateManifest` recomputes the contract hash and rejects unknown fields, malformed cross-field combinations, and accidental or untrusted modifications whose hash was not recomputed. The hash is an integrity check, not a signature or proof of authorship. Hashes identify content; they do **not** encrypt it or make low-entropy prompt material confidential.

## Diagnostics

| Code | Meaning |
|---|---|
| `CC101_VOLATILE_BEFORE_STABLE` | Preserved/dependent ordering forces volatile instructions before more stable content |
| `CC102_PREFERRED_BREAKPOINT_DROPPED` | Provider capacity or TTL ordering dropped a preferred explicit boundary |
| `CC103_CACHE_HORIZON_COLLAPSED` | Provider cannot preserve distinct logical TTL horizons |
| `CC104_PREFIX_TOKEN_COUNT_ESTIMATED` | Counts use the deterministic character estimator rather than a provider tokenizer |
| `CC105_NO_CACHE_BREAKPOINT` | No explicit boundary was selected |
| `CC106_ESTIMATED_PREFIX_BELOW_MINIMUM` | OpenAI boundary is estimated below 1,024 tokens |
| `CC107_AUTOMATIC_CACHE_INCLUDES_VOLATILE_SUFFIX` | Anthropic automatic caching targets volatile trailing content |
| `CC108_OPENAI_MODEL_CAPABILITY_UNVERIFIED` | A custom OpenAI model alias could not be capability-checked |
| `CC109_IMPLICIT_CACHE_INCLUDES_VOLATILE_SUFFIX` | OpenAI implicit caching targets volatile trailing content |
| `CC110_DERIVED_CACHE_KEY_UNSHARDED` | OpenAI traffic uses one derived plan-wide cache key |
| `CC111_PROVIDER_MANAGED_BREAKPOINT_UNAVAILABLE` | Implicit/automatic mode found no eligible modeled target |
| `CC112_AUTOMATIC_BREAKPOINT_REPLACED` | Anthropic automatic caching replaced a preferred final marker |

Diagnostics do not expose full prompt content.

## Determinism guarantees

For equivalent JSON input and identical compile options, CacheCraft guarantees stable:

- validation output;
- code-unit key and tool ordering;
- section ordering;
- breakpoint selection;
- provider payload structure;
- SHA-256 evidence hashes;
- diagnostics codes and structured details.

Object property insertion order does not affect results. Arrays remain ordered because their order is semantically meaningful.

Token counts are deliberately estimates. Provider tokenizers and request-rendering overhead can differ, so CacheCraft never presents the estimate as billing truth.

## What CacheCraft does not do

- observe real `cached_tokens` or cache-write usage;
- proxy or send provider requests;
- store prompts in a hosted registry;
- rewrite prompt prose with an LLM;
- prove that reordered sections are semantically independent;
- guarantee provider cost savings or cache hits;
- replace provider-native token counting;
- route requests between models, providers, replicas, or GPUs.

## Complementary projects

CacheCraft is intentionally narrower than runtime cache tooling:

- [CacheSentry](https://github.com/PS4Emp/cachesentry) analyzes cache behavior from traces and CI artifacts;
- [prefixguard](https://github.com/pgstorm148/prefixguard) detects prefix regressions across live session turns;
- [promptir](https://github.com/esandorfi/promptir) provides deterministic prompt compilation and manifest workflows.

CacheCraft focuses on **safe layout plus provider-portable cache controls before runtime**. Its manifest can be retained alongside runtime telemetry from complementary tools.

## Development

```bash
npm ci
npm run verify
```

`npm run verify`:

1. compiles strict TypeScript;
2. syntax-checks the CLI;
3. runs the Node test suite;
4. creates a real npm tarball, rejects unexpected package files, installs it into a temporary consumer project, imports the public API, compiles a plan, and executes the installed CLI.

The core package must remain offline and dependency-free at runtime. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
