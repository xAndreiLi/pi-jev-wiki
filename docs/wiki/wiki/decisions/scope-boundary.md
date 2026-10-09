---
title: Scope boundary — exclude derivable knowledge
type: decision
topic: decisions
summary: "jev-wiki is a conceptual state space and a decisioning history — concepts and the reasoning behind decisions — and deliberately excludes anything a developer could re-derive from the repository in under a minute."
tags: [scope, policy, wiki]
updated: 2026-10-08
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md, raw/sessions/2026-10-08-session-2026-10-08-092138.md]
claims:
  - id: c1
    text: "jev-wiki deliberately excludes anything a developer could re-derive from the repository in under a minute."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
  - id: c2
    text: "The wiki is a conceptual state space and a decisioning history: it holds concepts and the reasoning behind decisions, not implementation detail."
    status: user-stated
    support: 0.42
    evidence: [raw/sessions/2026-10-08-session-2026-10-08-092138.md, The wiki should be a space for conceptual state space and decisioning history.]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
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

## What it holds

The wiki is a **conceptual state space and a decisioning history**. Its durable content is concepts —
how the system is shaped, where its boundaries sit, why they sit there — together with the record of
decisions that produced them, including the options rejected and the reasons. It is not an
implementation reference and not a status report: anything that reads as a snapshot of the code at a
moment in time belongs in the repository, in a plan, or in a commit message.

This is the positive half of the boundary. The exclusion above says what may not enter; this says what
the wiki is *for*, and it is the test to apply when a claim is durable but not conceptual.

## Consequences

- Pages stay small and high-signal.
- Agents must read code for implementation details; the wiki answers "where" and "why."
- Scope violations should be pruned during review.

## Evidence

- `docs/notes/jev-wiki-overview.md` — purpose section and quality bar.
