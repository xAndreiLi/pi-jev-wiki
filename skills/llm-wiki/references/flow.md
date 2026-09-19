---
name: flow-page
description: Template for end-to-end data or control flow wiki pages.
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
