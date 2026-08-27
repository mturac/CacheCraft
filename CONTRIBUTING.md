# Contributing to CacheCraft

Thank you for helping improve CacheCraft.

## Development requirements

- Node.js 22 or newer
- npm 10 or newer

## Setup

```bash
npm ci
npm run verify
```

## Contribution rules

- Keep the compiler deterministic and offline.
- Do not add provider SDKs or network calls to the core package.
- Add a failing test before changing behavior and verify the expected failure before implementation.
- Keep the package-root API narrow; new low-level exports require a compatibility rationale.
- Provider adapters must cite the matching official provider documentation in code comments or the pull request.
- Never include real prompts, API keys, customer data, or provider credentials in fixtures.

## Pull requests

A pull request should explain the user-visible behavior, compatibility impact, tests run, and documentation updated. By contributing, you agree that your contribution is licensed under Apache-2.0.
