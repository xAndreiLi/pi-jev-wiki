---
title: Decision ledger retention
type: decision
topic: decisions
summary: Rejected claims remain visible in the decision ledger to support future threshold tuning audit.
tags: [decisions, ledger, audit, threshold-tuning, retention]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1812.md]
files: []
claims:
  - id: c1
    text: "Rejected claims stay visible in the decision ledger instead of being deleted, so threshold tuning can be audited later."
    status: user-stated
    support: 0.56
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1812.md, keep rejected claims visible in the decision ledger instead of deleting them]
---

## Responsibility

Govern how rejected claims are handled in the decision ledger.

## Decision

Rejected claims stay visible in the decision ledger instead of being deleted. This preserves the ability to audit threshold tuning later.

## Invariants

- Visibility of rejected claims is non-negotiable; deletion is not an option.
- The ledger must remain interpretable for retrospective threshold analysis.

## Change impact

- Increases ledger size over time.
- May require indexing or filtering conventions if query performance degrades.

## See also

- Raw session: `raw/sessions/2026-09-19-session-2026-09-19-1812.md`
