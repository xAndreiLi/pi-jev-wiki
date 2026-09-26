---
title: Guided writing as default mode
type: decision
topic: decisions
summary: "Historical decision: guided writing (Jev decides, the agent writes, code enforces policy) — superseded; Jev verdicts are advisory and the agent has the final say, recording overrides in the ledger."
tags: [workflow, writing, policy, superseded]
updated: 2026-09-26
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md, raw/sessions/2026-09-26-session-2026-09-26-2247.md]
claims:
  - id: c1
    text: "Guided writing is the default mode: Jev decides, the agent writes, and code enforces policy."
    status: superseded
    support: 0.99
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
    superseded_by: architecture/adjudication-policy.md#c3
    superseded_at: 2026-09-26
  - id: c2
    text: "Rejected claims are never written to the wiki, even when the user explicitly asks for that content; the writer reports the rejection instead."
    status: superseded
    support: 0.95
    evidence: [skills/llm-wiki/SKILL.md, research/karpathy-llm-wiki-gist.md]
    superseded_by: architecture/adjudication-policy.md#c3
    superseded_at: 2026-09-26
  - id: c3
    text: "The wiki uses an explicit confidence threshold and review queue for accepting insights; not all insights survive review, even when a user explicitly requests capture."
    status: verified
    support: 0.90
    evidence: [docs/wiki/wiki/decisions/guided-writing.md]
files: []
---

# Guided writing as default mode

**Status.** superseded by [Adjudication policy computed in code](../architecture/adjudication-policy.md#c3), 2026-09-26

**Date.** 2026-09-19

> **Superseded 2026-09-26.** Jev verdicts are advisory: the agent has the final say and records overrides via `wiki_finalize`. The text below is the historical decision, preserved as written.

## Context

- Fully automated wiki writing risks low-quality or generic content.
- Fully manual writing is slow and inconsistent.

## Options considered

1. Fully automated — fast, but quality unpredictable.
2. Fully manual — high quality, but high latency and agent-dependent.
3. Guided writing (Jev decides, agent writes) — balances quality and consistency.

## Decision

- Adopt guided writing as the default.
- Jev adjudicates groundedness, derivability, and placement.
- The agent composes the actual page text, following templates and frontmatter rules.
- Enforcement is handled by the extension code, not by agent prompting alone.
- An explicit confidence threshold and review gate control acceptance; not all submitted insights survive review, even when the user explicitly requests capture.

## Consequences

- Pages are uniform in structure.
- Agents remain responsible for clarity and concision.
- Misalignment between Jev placement and agent prose is caught during `wiki_finalize`.
- Rejected claims are never written to the wiki, even when the user explicitly asks for that content; the agent reports the rejection and its reason instead.

## Evidence

- `docs/notes/jev-wiki-overview.md` — components and decisions sections.
