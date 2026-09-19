---
title: Retry Handling in Client
type: decision
topic: decisions
summary: Unbacked claims are queued as review items rather than deleted, because a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge.
tags: [lint, claims, review-queue, ledger, bookkeeping]
updated: 2026-09-19
sources:
  - raw/sessions/2026-09-19-session-2026-09-19-1806.md
claims:
  - id: c1
    text: "Unbacked claims are queued as review items rather than deleted, because a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge."
    status: user-stated
    support: 0.58
    evidence:
      - raw/sessions/2026-09-19-session-2026-09-19-1806.md
files: [src/lint.ts]
---

# Retry Handling in Client

**Status.** accepted

**Date.** 2026-09-19

## Decision

When the lint process detects an active claim that lacks an accepted ledger entry and has not been previously reviewed, it does not delete or reject the claim. Instead, it queues the claim as a `claim_review` item with criticality 0.45 and reason `lint: no accepted ledger entry backs this claim`. This approach treats a missing ledger entry as a potential bookkeeping gap rather than evidence of bad knowledge.

## Rationale

A claim may be valid even if its corresponding ledger entry is missing, mis-filed, or not yet recorded. Deleting the claim would risk losing valid knowledge. Queuing it for review allows a human (or later automation) to verify the claim and either accept, reject, or dispute it.

## Evidence

- `docs/wiki/raw/sessions/2026-09-19-session-2026-09-19-1806.md` — user-stated decision captured during session.
- `src/lint.ts` — unbacked-claims section that enqueues review items rather than deleting claims.
