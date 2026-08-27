# Changelog

All notable changes to CacheCraft are documented in this file.

The project follows Semantic Versioning once the first package is published.

## [0.1.0] - 2026-08-27

### Added

- Deterministic, provider-neutral prompt plan schema.
- Safe-by-default section ordering with explicit cache-aware optimization.
- Explicit breakpoint selection with provider write-slot enforcement.
- OpenAI Responses and Chat Completions adapters for GPT-5.6+ cache controls.
- Anthropic Messages adapter with explicit and automatic prompt caching.
- Generic logical payload adapter.
- Runtime cache-key overrides and cache-key provenance.
- Provider-managed breakpoint evidence for OpenAI implicit and Anthropic automatic modes.
- Canonical SHA-256 prompt, tools, prefix, and complete contract manifests.
- Canonical manifest integrity validation, cross-field validation, and structured contract diffing.
- Dependency-free CLI for compile, explain, and diff workflows.
- Narrow package-root API and a TypeScript consumer-contract test.
- JSON Schema, example plan, tests, CI, contributor guidance, and security policy.
