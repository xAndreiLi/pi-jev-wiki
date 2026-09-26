---
title: Capture routing and gating
type: invariant
topic: invariants
summary: "Automatic capture targets the wiki of the session's working directory, and task-cadence captures pass a Jev pre-screen that extracts only sessions scoring at least 0.6 on worth_capturing."
tags: [capture, routing, gating, cadence, jev]
updated: 2026-09-26
sources: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md]
claims:
  - id: c1
    text: "The capture target wiki is resolved from the session's working directory, not from the subject matter — a session run from home files captures into the life wiki even when the work concerns the package repository."
    status: verified
    support: 0.87
    evidence: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c2
    text: "Task-cadence captures are gated by Jev's pre-screen: a session scoring below 0.6 on worth_capturing is skipped with only a capture.screen ledger entry and leaves no wiki trace, while at or above 0.6 the insights are extracted and proposed for the agent to write."
    status: verified
    support: 0.9
    evidence: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/extension.ts, src/config.ts]
---

# Capture routing and gating

## Routing follows the working directory

`capture.cadence` decides *when* the wiki is updated; the session's working directory decides
*which* wiki (`resolveLayout(ctx.cwd, …)`). Running pi from home files captures into the life wiki
even when the work itself is package work — which is how package knowledge once ended up filed in
the life wiki. To capture package knowledge into this wiki, run the session from the repository.
Cross-wiki write routing is planned to replace this directory rule with per-claim routing; until
then this is the behaviour to expect.

## The pre-screen keeps routine work out

Task cadence is not "write something after every task". Each settle goes through Jev's
`worth_capturing` screen; below 0.6 the session is skipped with only a ledger entry
(`capture.screen`), so trivial tasks leave no wiki trace. Above it, insights are extracted,
adjudicated, and proposed — the agent still writes the pages and calls `wiki_finalize`, so capture
stays advisory.

Observed on 2026-09-26: two "call wiki_status" smoke runs scored 0.39 and 0.47 (skipped), while
documentation sessions scored 0.95 and 0.94 (extracted).

## Related

- [Capture flow](../architecture/flow-capture.md)
- [Capture evidence resolves from the session cwd](../architecture/gotcha-capture-evidence-resolution.md)
- [Scope boundary](../decisions/scope-boundary.md)
