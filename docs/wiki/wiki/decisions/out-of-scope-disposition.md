---
title: Out-of-scope review disposition
type: decision
topic: decisions
summary: "A claim that is correct but belongs to another wiki is resolved out_of_scope with an optional target: nothing is written to the page, the claim is not marked wrong, and it does not count as a rejection."
tags: [review, disposition, cross-wiki, decision]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-0025.md]
claims:
  - id: c1
    text: "`out_of_scope` is the review disposition for a claim that is correct but belongs to another wiki: it records the resolution with an optional `target` and leaves the page frontmatter untouched, so the claim is not marked wrong and does not feed rejection calibration."
    status: verified
    support: 0.57
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0025.md, src/review.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/review.ts, src/extension.ts]
---

# Out-of-scope review disposition

**Status.** accepted

**Date.** 2026-09-26

## Context

- A review item can hold a claim that is correct but belongs to a different wiki. The vocabulary was accept/reject/supersede/defer: `reject` records the claim as wrong and feeds rejection calibration, while leaving the item open re-proposes it on later passes. The handoff observed seven such claims resolved only in chat.
- With cross-wiki writes available, the honest move is to decline the claim here and record where it belongs — not to judge it false.

## Decision

- `wiki_review resolution=out_of_scope` (with an optional `target` naming a registered wiki or page) resolves the item, records the disposition and target in the ledger, and leaves page frontmatter untouched.
- Automatic suppression of re-proposals is deliberately not implemented yet: once claim forwarding exists, the same claim should be routed to the target wiki rather than dropped by a suppression list.

## Consequences

- Out-of-scope declines are visible in the ledger and no longer pollute rejection statistics.
- Critical items still require user confirmation before any non-defer resolution, including this one.

## Related

- [Agent-managed review with user escalation for critical items](review-escalation.md)
- [Cross-wiki write routing](cross-wiki-writes.md)
