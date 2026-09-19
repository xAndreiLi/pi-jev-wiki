---
title: Review resolutions applied by code
type: decision
topic: decisions
summary: The agent picks a resolution, but frontmatter is rewritten deterministically by applyReviewResolution, not by the model.
tags: [review, resolution, frontmatter, determinism]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1734.md]
claims:
  - id: c1
    text: "Review resolutions are applied by code, not by the model: the agent chooses accept, reject, supersede, or defer and frontmatter is rewritten deterministically."
    status: verified
    support: 0.95
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1734.md]
files: [src/review.ts]
---

# Review resolutions applied by code

**Status.** accepted

**Date.** 2026-09-19

## Context

- Letting the model rewrite page frontmatter risks drift, hallucination, or inconsistent status values.
- The resolution vocabulary is small and closed: `accept`, `reject`, `supersede`, `defer`.

## Options considered

1. Agent resolves + model rewrites frontmatter — flexible, but non-deterministic and error-prone.
2. Agent resolves + code rewrites frontmatter — deterministic, auditable, and safe.
3. Fully automated resolution without agent — too risky for high-stakes claims.

## Decision

- The agent (or escalated user) chooses the resolution via `wiki_review`.
- `applyReviewResolution` in `src/review.ts` maps the resolution to exact frontmatter mutations:
  - `accept` → `status: verified`, bumps `support` to at least `0.8`.
  - `reject` → `status: rejected`.
  - `supersede` → `status: superseded`.
  - `defer` → no frontmatter change; item stays in queue.
- The model never directly edits claim status during review.

## Consequences

- Review outcomes are reproducible and searchable in the ledger.
- Adding a new resolution requires changing `applyReviewResolution` and the `ReviewResolution` type.
- The agent can still edit pages normally via the write tool; review is a special-case path.

## Evidence

- `src/review.ts` — `applyReviewResolution` implementation.
