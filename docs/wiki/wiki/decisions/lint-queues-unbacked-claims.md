---
title: Lint Queues Unbacked Claims
type: decision
topic: decisions
summary: "The wiki lint process queues claims lacking accepted ledger entries as review items instead of deleting or rejecting them, because a missing ledger entry may be a bookkeeping gap rather than bad knowledge."
tags: [lint, claims, review-queue, ledger, bookkeeping]
updated: 2026-09-28
sources: [raw/sessions/2026-09-19-session-2026-09-19-1806.md, src/lint.ts]
claims:
  - id: c1
    text: "Unbacked claims are queued as review items rather than deleted, because a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge."
    status: user-stated
    support: 0.74
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1806.md, src/lint.ts]
    reviewed: 2026-09-20
    last_checked: 2026-09-28
files: [src/lint.ts]
---

# Lint Queues Unbacked Claims

**Status.** accepted

**Date.** 2026-09-19

## Decision

When `lintWiki` detects an active claim with no accepted ledger entry and no prior review reference, it does not delete or reject the claim. Instead, it enqueues a `claim_review` item with criticality `0.45` and reason `lint: no accepted ledger entry backs this claim`. This reflects the policy that a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge.

## Rationale

A claim can be valid even if its ledger entry is missing, mis-filed, or not yet recorded. Deleting it would lose knowledge; queueing it lets a human (or later automation) verify and either accept or dispute it.

## Implementation

See `src/lint.ts`, in the **Unbacked claims** section:

```typescript
if (!backed && !reviewed) {
    report.unbackedClaims.push({
        page: page.rel,
        claimId: typeof claim.id === "string" ? claim.id : undefined,
        text: claim.text,
    });
    if (autoFix) {
        await enqueueReview(layout, {
            kind: "claim_review",
            claimText: claim.text,
            page: page.rel,
            claimId: typeof claim.id === "string" ? claim.id : undefined,
            criticality: 0.45,
            reason: "lint: no accepted ledger entry backs this claim",
        });
    }
}
```

## Consequences

- The review queue may accumulate low-criticality items for claims that are actually correct but simply lack ledger entries.
- Human review (or a later backfill of ledger entries) is required to clear these items.
- The agent must not auto-accept these items in headless mode because the default criticality (`0.45`) is below typical auto-accept thresholds.

## History

- 2026-09-19 — decision captured from session `raw/sessions/2026-09-19-session-2026-09-19-1806.md`; an earlier consolidation superseded this claim in favor of the mis-titled duplicate `decisions/retry-handling-in-client.md`.
- 2026-09-28 — duplicate removed; this accurately named page with the fuller implementation detail is the canonical copy, and the claim is restored to `user-stated`.
