---
title: Capture routing and gating
type: invariant
topic: invariants
summary: "Automatic capture defaults to the subject wiki — the registered wiki that owns the session's edited files, when exactly one does — and falls back to the session's working-directory wiki with a visible warning; task-cadence captures pass a Jev pre-screen that extracts only sessions scoring at least 0.6 on worth_capturing."
tags: [capture, routing, gating, cadence, jev]
updated: 2026-09-26
sources: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md]
claims:
  - id: c1
    text: "The capture target wiki is resolved from the session's working directory, not from the subject matter — a session run from home files captures into the life wiki even when the work concerns the package repository."
    status: superseded
    support: 0.87
    evidence: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
    superseded_by: "Capture routing defaults to the subject wiki (c3); the working-directory rule now applies only when capture.route is session or no registered wiki owns the session's edits."
    superseded_at: 2026-09-26
  - id: c2
    text: "Task-cadence captures are gated by Jev's pre-screen: a session scoring below 0.6 on worth_capturing is skipped with only a capture.screen ledger entry and leaves no wiki trace, while at or above 0.6 the insights are extracted and proposed for the agent to write."
    status: verified
    support: 0.9
    evidence: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c3
    text: "Auto-capture routing defaults to the subject wiki: with capture.route: subject, the capture is filed into the registered wiki that owns the files the session edited when exactly one does; otherwise it stays on the session wiki with a visible warning. The working-directory rule applies when capture.route: session."
    status: verified
    support: 0.83
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0025.md, "c5e5f62"]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/extension.ts, src/config.ts, src/wiki/target.ts]
---

# Capture routing and gating

## Routing follows the subject by default

`capture.cadence` decides *when* the wiki is updated; `capture.route` (default `subject`) decides
*which* wiki. Auto-capture tracks the files the session **edited** (not merely read) and files the
capture into the registered wiki that owns them when exactly one matches. Ambiguous edits, no
matching registered wiki, or evidence-only matches keep the session's working-directory wiki and
put a `⚠` warning in the brief naming where the evidence points. `capture.route: session` restores
the working-directory rule, and an explicit `wiki: "<name>"` on a write tool always overrides
inference. Every decision is logged as `capture.route` in the ledger.

Historical note: before 0.8.0 the working directory decided the target unconditionally — which is
how package knowledge once ended up filed in the life wiki. See
[Cross-wiki write routing](../decisions/cross-wiki-writes.md).

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
