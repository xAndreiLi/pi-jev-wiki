---
title: The maintenance loop
type: architecture/flow
topic: architecture
summary: "Wiki maintenance is a closed loop of six stages — trigger, adjudication, placement, write, commit, and currency/health — in which only the write stage needs an agent, and every stage is bounded by an escalation boundary and the failure-loop rules."
tags: [autonomy, maintenance, workflow, capture, sync, review]
updated: 2026-10-08
sources: [docs/plans/AUTONOMY.md, raw/sessions/2026-10-08-session-2026-10-08-092138.md]
claims:
  - id: c1
    text: "Every wiki artefact the human sees is either a critical review escalation or the one-time embedding-preset choice; the rest of maintenance belongs to the agent."
    status: user-stated
    support: 0.7
    evidence: [raw/sessions/2026-10-08-session-2026-10-08-092138.md, The human user should not need to manually touch any part of the wiki unless it is very critical.]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c2
    text: "Maintenance is a closed loop of six stages: trigger, adjudication, placement, write, commit, and currency/health, where only the write stage requires an agent at all."
    status: verified
    support: 0.9
    evidence: [docs/plans/AUTONOMY.md]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c3
    text: Currency and health are triggers in their own right, not side effects of capture — a wiki that is only maintained when work is captured goes stale between captures.
    status: verified
    support: 0.85
    evidence: [docs/plans/AUTONOMY.md, src/sync.ts]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c4
    text: The escalations that reach a human are the exceptions that are unsafe to decide automatically, so the loop is defined by its escalation boundary rather than by what it automates.
    status: verified
    support: 0.85
    evidence: [docs/plans/AUTONOMY.md, docs/wiki/wiki/decisions/review-escalation.md]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
files: [src/extension.ts, src/sync.ts, src/pipeline/write.ts, src/lint.ts]
---

# The maintenance loop

**Status.** accepted

**Date.** 2026-10-08

## Stages

| Stage | Trigger | Who decides | Output |
|---|---|---|---|
| **1. Trigger** | `agent_settled` on task or commit cadence, `session_before_compact`, or an explicit call | Code | A session transcript to screen |
| **2. Adjudication** | Arrival of insight or source claims | Jev advises, **code** applies thresholds | file · reinforce · review · reject |
| **3. Placement** | An accepted claim without a target page | Jev, via a sharded-choice tournament | A target page, existing or new |
| **4. Write** | A placed claim | The writer composes, the agent promotes | A page in `wiki/` |
| **5. Commit** | A page written | Code | Index, log, ledger, reindex, `wiki_finalize` |
| **6. Currency & health** | Commit observed, session start, backstop interval | Jev for impact, code for policy | `needs_recheck`/`superseded` claims, review items, lint findings |

The loop closes because stage 6 feeds stage 2: an invalidated claim becomes a review item, which is
adjudicated and either rewritten or accepted as still true.

## The two boundaries

**The escalation boundary.** Human attention is reserved for critical review items — security,
breaking API changes, data loss — and the one-time embedding-preset choice. Everything else is the
agent's. The loop is best understood by what it escalates rather than by what it automates, because
the escalation set is the part that cannot be delegated safely.

**The failure boundary.** Every stage that spends money must bound its own spend. A stage that can
fail repeatedly without moving its own guard is not autonomous, it is a leak. See
[failure-loop safety](../invariants/failure-loop-safety.md).

## Why the write stage is the hinge

Stages 1–3 and 5–6 are decisions and bookkeeping: a model call with a typed answer, then code. The
write stage is the only one that needs judgement plus composition, and it is where almost all agent
tokens go, because composing a page means emitting its prose, its frontmatter, and its claim records
in the session context — where they then remain for the rest of the session.

Moving composition into a bounded side call is what makes the loop affordable. That is the whole
argument for a writer mode at all: not to remove the agent from the loop, but to stop the loop from
running inside the agent's context.

## Failure modes

- **A stage with no trigger.** Staleness, not corruption — the wiki is correct but old. Recognize it
  by a sync baseline far behind HEAD with a clean review queue.
- **Unbounded escalation.** A queue that grows faster than it is worked, until a human is doing the
  routine upkeep the loop was meant to absorb. Recognize it by review-item age, not queue length.
- **A silent downgrade.** A mode or threshold dropping work without saying so; the claim vanishes
  with no ledger entry. Anything that declines to write must record a non-file action.
- **A bypassed boundary.** The sensitive and injection boundaries are absolute and survive every
  advisory outcome; they are the one place where a Jev verdict is not advice.

## See also

- [Capture flow](flow-capture.md)
- [Adjudication policy computed in code](adjudication-policy.md)
- [Agent-managed review with user escalation for critical items](../decisions/review-escalation.md)
- [Autonomy must not fail into a loop](../invariants/failure-loop-safety.md)
- [The writer composes, the agent promotes](../decisions/writer-default-mode.md)
