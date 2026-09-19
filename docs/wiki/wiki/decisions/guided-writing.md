---
title: Guided writing as default mode
type: decision
topic: decisions
summary: Jev decides placement, the agent writes the content, and code enforces policy.
tags: [workflow, writing, policy]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "Guided writing is the default mode: Jev decides, the agent writes, and code enforces policy."
    status: verified
    support: 0.99
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
  - id: c2
    text: "Rejected claims are never written to the wiki, even when the user explicitly asks for that content; the writer reports the rejection instead."
    status: verified
    support: 0.95
    evidence: [skills/llm-wiki/SKILL.md, research/karpathy-llm-wiki-gist.md]
files: []
---

# Guided writing as default mode

**Status.** accepted

**Date.** 2026-09-19

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

## Consequences

- Pages are uniform in structure.
- Agents remain responsible for clarity and concision.
- Misalignment between Jev placement and agent prose is caught during `wiki_finalize`.
- Rejected claims are never written to the wiki, even when the user explicitly asks for that content; the agent reports the rejection and its reason instead.

## Evidence

- `docs/notes/jev-wiki-overview.md` — components and decisions sections.
