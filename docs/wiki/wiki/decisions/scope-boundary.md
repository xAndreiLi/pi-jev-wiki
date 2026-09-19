---
title: Scope boundary — exclude derivable knowledge
type: decision
topic: decisions
summary: jev-wiki deliberately excludes anything a developer could re-derive from the repository in under a minute.
tags: [scope, policy, wiki]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "jev-wiki deliberately excludes anything a developer could re-derive from the repository in under a minute."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Scope boundary — exclude derivable knowledge

**Status.** accepted

**Date.** 2026-09-19

## Context

- The wiki must remain a mental model, not a mirror of the codebase.
- If content is easily derivable from code, it adds maintenance burden without decision value.

## Decision

- Exclude anything a developer could re-derive from the repository in under a minute.
- File only module responsibilities, boundaries, data flow, invariants, decisions with rationale, change-impact knowledge, historical attempts, external constraints, and domain glossary.

## Consequences

- Pages stay small and high-signal.
- Agents must read code for implementation details; the wiki answers "where" and "why."
- Scope violations should be pruned during review.

## Evidence

- `docs/notes/jev-wiki-overview.md` — purpose section and quality bar.
