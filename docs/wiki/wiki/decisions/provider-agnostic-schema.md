---
title: Provider-agnostic Jev client schema
type: decision
topic: decisions
summary: Provider switching between TypeSafe, OpenRouter, and AI/ML API is configuration only, because every provider accepts the same System One request schema.
tags: [jev, provider, typesafe, openrouter, aimlapi, configuration]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
claims:
  - id: c1
    text: "Provider switching between TypeSafe, OpenRouter, and AI/ML API is configuration only, because every provider accepts the same System One request schema."
    status: verified
    support: 0.96
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
files: [src/config.ts, src/jev.ts]
---

# Provider-agnostic Jev client schema

**Status.** accepted

**Date.** 2026-09-19

## Context

- The extension needs to call the Jev decision model, but different users may have API keys for TypeSafe, OpenRouter, or AI/ML API.
- Maintaining separate client implementations per provider would fragment the codebase and complicate testing.

## Options considered

1. **Separate clients per provider** — avoids schema negotiation, but duplicates request logic and error handling.
2. **Single client with provider-specific adapters** — one implementation, but adapters must map schemas at runtime.
3. **Single client with identical schema** — all providers accept the native System One schema; only the endpoint and model string differ.

## Decision

- Adopt option 3: a single `JevClient` that sends `{ model, state, questions }` to any provider.
- `PROVIDER_PRESETS` in `src/config.ts` holds per-provider `baseUrl` and `model` defaults.
- Switching providers is a config change only.

## Consequences

- Adding a new provider is a one-line preset addition.
- Bugs in request formatting are fixed once for all providers.
- Providers must remain compatible with the System One schema; divergence would require revisiting this decision.

## Evidence

- `src/config.ts`: `PROVIDER_PRESETS` defines `typesafe`, `openrouter`, and `aimlapi`.
- `src/jev.ts`: `JevClient.systemOne` sends the same `{ model, state, questions }` body regardless of `baseUrl`.
