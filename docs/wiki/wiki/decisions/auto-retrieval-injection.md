---
title: Auto-retrieval injects a Jev-gated wiki brief on every prompt
type: decision
topic: decisions
summary: "The session wiki is searched on every prompt and a Jev-gated, budgeted <auto-retrieval> brief is injected before the first provider request; it is session-wiki-only, fails closed, and is logged as op auto — never as a consultation."
tags: [retrieval, injection, hooks, jev, search, decision]
updated: 2026-10-04
sources: [raw/sessions/2026-10-04-session-2026-10-04-181406.md]
claims:
  - id: c1
    text: "Auto-retrieval is on by default (`hooks.autoRetrieve.mode: \"inject\"`): every prompt searches the session wiki and, when Jev's sufficiency verdict passes `search.jev.minSufficiency`, an `<auto-retrieval>` brief is injected with the prompt before the first provider request. It covers the session wiki only — other registered wikis and the global vault stay a manual `wiki_ask`, documented in the llm-wiki skill — and it fails closed: no verdict, low sufficiency, or `budgetMs` expiry injects nothing."
    status: user-stated
    support: 0.9
    evidence: [raw/sessions/2026-10-04-session-2026-10-04-181406.md, "Andrei, 2026-10-04: \"Inject by default for now, I want this feature rolled out and tested. Inject should use the jev gate.\"", "Andrei, 2026-10-04: \"Session wiki only for the automatic injection, but this should be documented in the skill so that agents know to search manually for global wiki hits.\""]
    reviewed: 2026-10-04
    last_checked: 2026-10-04
  - id: c2
    text: "Prompt-time auto-retrieval is logged to `.jev-wiki/metrics.jsonl` as `op: "auto"`, never as `op: "ask"`: `ask` is the consultation instrument, and counting an automatic search as a consultation would repeat the defect class where counting maintenance calls inflated measured wiki use from 30% to 93%."
    status: verified
    support: 0.7
    evidence: [README.md, src/auto-retrieve.ts, docs/wiki/wiki/architecture/gotcha-wiki-consultation-vs-maintenance.md, raw/sessions/2026-10-04-session-2026-10-04-181435.md]
    reviewed: 2026-10-04
    last_checked: 2026-10-04
files: [src/auto-retrieve.ts, src/config.ts, src/extension.ts, skills/llm-wiki/SKILL.md, docs/plans/AUTO-RETRIEVAL.md]
---


# Auto-retrieval injects a Jev-gated wiki brief on every prompt

**Status.** accepted

**Date.** 2026-10-04

## Context

- The wiki's original rule was "no injection": the TOC is available like a skill and the agent
  consults on demand (`PLAN.md` §4.1).
- Measured use did not justify leaving it there: 30% of episodes consulted the wiki, with a 13.2%
  rediscovery rate (`EFFICACY.md`, R0), and `CRITIQUE.md` §1.10 had already specified the mechanism
  it wanted instead — relevance-gated digest injection with a token budget, shipped only with an A/B.
- Andrei's call was to ship it live rather than stage it behind a display-only rung: "I want this
  feature rolled out and tested."

## Decision

- **On by default.** `hooks.autoRetrieve.mode: "inject"`; `off` opts out.
- **Jev gates it.** `judgeRetrieval` supplies the relevance order and the sufficiency verdict; below
  `search.jev.minSufficiency` nothing is injected. Within a passing run, candidates below Jev's own
  0.5 midpoint are dropped. Fail closed on error, timeout, or missing verdict.
- **Session wiki only.** Other registered wikis and the global vault are never auto-searched; the
  llm-wiki skill states that explicitly so an agent that needs another project's knowledge asks for
  it.
- **Budgeted.** `maxTokens` caps the brief; `budgetMs` bounds the hook.
- **Logged as `op: "auto"`, never `op: "ask"`.** `ask` is the consultation instrument; counting an
  automatic search as a consultation would repeat the defect class in
  [Wiki maintenance is not wiki consultation](../architecture/gotcha-wiki-consultation-vs-maintenance.md).

## Consequences

- The wiki's "no injection" principle becomes "no *ungated* injection". `PLAN.md` §0/§4.1 and
  `CRITIQUE.md` §1.10 were amended the same day to say so, and `llm-wiki` tells agents that the brief
  is a pointer, not an answer.
- An empty brief means "not enough evidence", not "nothing exists" — below-gate runs are logged, so
  a silently empty result cannot be read as an empty wiki (the failure mode documented in
  [Degraded search is indistinguishable from an empty wiki](../architecture/gotcha-silent-search-degradation.md)).
- Blocked runs accumulate a coverage signal: repeated below-gate prompts on one topic are evidence of
  a wiki gap, not just a missed retrieval.
- The decision is provisional in one direction: `docs/plans/AUTO-RETRIEVAL.md` P4 defines the
  measurement (effective consultation on injected episodes, rediscovery below baseline) that decides
  whether it stays.

## Related

- [before_agent_start can inject a message into the prompt batch](../pi/before-agent-start-injection.md)
- [Retrieval pipeline](../architecture/flow-retrieval.md)
- [Efficacy measurement substrate](../architecture/flow-eval-substrate.md)
