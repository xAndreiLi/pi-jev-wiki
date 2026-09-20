---
title: <Flow name>
type: architecture/flow
topic: architecture
summary: <What this flow accomplishes end to end.>
tags: [<tag>]
updated: YYYY-MM-DD
sources: [<raw source>]
claims:
  - id: c1
    text: "<atomic claim>"
    status: verified
    support: 0.0
    evidence: [<raw source>]
files: [src/<entry>.ts]
---

# <Flow name>

**Trigger.** What starts this flow.

**Participants.** The modules/services involved, in order.

## Steps

1. Entry point (`src/...`) — input shape.
2. Transformation / hand-off — what changes and where.
3. Exit — output shape, side effects, storage.

## Invariants

- Ordering guarantees, idempotency, exactly-once/at-least-once properties.

## Failure modes

- Where it can stall, retry, or duplicate; how errors surface.

## Change impact

- Steps and modules affected by changes to each stage.

## See also

- Related module, invariant, and decision pages.
