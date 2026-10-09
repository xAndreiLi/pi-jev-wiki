---
title: Autonomy must not fail into a loop
type: invariant
topic: invariants
summary: "Any autonomous maintenance trigger must bound its own spending without human intervention: guard state is persisted, guard timestamps advance on failure as well as success, non-retryable errors open a circuit breaker, and sync persists partial progress so its baseline never advances past unchecked claims."
tags: [autonomy, reliability, backoff, failure-loop, sync, capture]
updated: 2026-10-08
sources: [raw/sessions/2026-10-08-session-2026-10-08-092138.md, docs/plans/AUTONOMY.md]
claims:
  - id: c1
    text: "No autonomous maintenance trigger may fail into a retry loop: guard state must be persisted rather than process-local, and guard timestamps must advance on failure as well as on success."
    status: user-stated
    support: 0.7
    evidence: [raw/sessions/2026-10-08-session-2026-10-08-092138.md, Jev spend is fine but we should make sure that there is no possibility of a failure loop.]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c2
    text: Non-retryable provider errors open a circuit breaker for the rest of the session instead of being retried, because a billing or authentication fault is not repaired by trying again.
    status: verified
    support: 0.8
    evidence: [docs/plans/AUTONOMY.md, src/jev.ts]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c3
    text: Sync persists progress incrementally, so its baseline never advances past claims that were not actually checked.
    status: verified
    support: 0.8
    evidence: [docs/plans/AUTONOMY.md, src/sync.ts]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
files: [src/sync.ts, src/extension.ts, src/jev.ts]
---

# Autonomy must not fail into a loop

**Status.** accepted

**Date.** 2026-10-08

## Context

Autonomy means hooks that spend money with nobody watching. The failure mode that matters is not a
single failed call — it is a failed call that repeats. Three shapes exist:

- **Retry storm.** Work throws before its guard state is updated, so the next trigger sees a stale
  guard and fires again immediately.
- **Self-capture.** Capture writes pages; that writing is a turn; the next settle re-screens the
  maintenance work itself as if it were knowledge.
- **All-or-nothing progress.** The baseline advances only on complete success, so a partial run
  re-does everything it already did.

## Decision

- Guard state is **persisted**, not process-local. A restart must not clear a backoff.
- Guard timestamps advance in a `finally`. An error moves the clock like any other outcome.
- Failures open a **circuit breaker** with exponential backoff, cleared on success.
- **Non-retryable** errors — authentication and billing faults — open the breaker for the whole
  session and are recorded with a reason.
- **Progress is incremental.** A sync records the checked prefix, so a partial run resumes rather
  than restarts.
- Every autonomous trigger carries a **per-session call ceiling**, so the bound does not depend on
  any single guard being correct.
- **Maintenance work does not trigger capture.** This is terminated by construction rather than by
  throttle.

## Consequences

- A broken key degrades the wiki to stale-but-safe instead of burning the ceiling every settle.
- Staleness becomes the visible failure mode, which is why the doctor and the session agenda both
  report breaker state.
- Backoff coefficients are configuration, not constants, so a stuck breaker can be cleared without
  a code change.
- The resolution path cannot loop back into detection: sync maps claims to file patterns that point
  at code, so a wiki page rewrite matches no affected claim. This is an invariant to preserve, not
  an accident to rely on.

## Evidence

- `docs/plans/AUTONOMY.md` §3 — loop classes and the design rules L1–L7.
- `src/extension.ts` — `autoCapture` guards and their assignment paths.
- `src/sync.ts` — `writeSyncState` and baseline advancement.
