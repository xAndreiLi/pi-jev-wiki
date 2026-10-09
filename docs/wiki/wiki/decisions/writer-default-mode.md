---
title: The writer composes, the agent promotes
type: decision
topic: decisions
summary: "The wiki writer defaults to draft mode: the writer model composes a page and the agent reviews and promotes it, keeping the authoring cost off the session context while the agent keeps the final word; auto mode is a verified alternative, not a default."
tags: [writer, autonomy, maintenance, draft, workflow]
updated: 2026-10-08
sources: [raw/sessions/2026-10-08-session-2026-10-08-092138.md, docs/plans/AUTONOMY.md]
claims:
  - id: c1
    text: "The writer defaults to draft mode: the writer model composes the page and the agent reviews and promotes it, because draft removes the agent's authoring cost while keeping the agent as the final word on what the wiki holds."
    status: verified
    support: 0.97
    evidence: [docs/plans/AUTONOMY.md, raw/sessions/2026-10-08-session-2026-10-08-092138.md]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c2
    text: The two writer modes are to be compared by testing before auto is relied on, rather than assumed equivalent to draft.
    status: user-stated
    support: 0.7
    evidence: [raw/sessions/2026-10-08-session-2026-10-08-092138.md, we should also plan to run tests between the two to verify.]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
files: [src/pipeline/write.ts, src/config.ts]
---

# The writer composes, the agent promotes

**Status.** accepted

**Date.** 2026-10-08

## Context

Adding knowledge was the most expensive thing an agent did with this wiki. Under the `guided` mode
that shipped as the default, the agent authored every page in its own session context, frontmatter
included — `status`, `support`, `evidence`, `reviewed` and `last_checked` are all data the pipeline
already holds. Measured on this repository: frontmatter is 44% of wiki bytes, and 51% of claim bytes
are YAML scaffolding rather than the claim itself.

`src/pipeline/write.ts` already knew how to do that work — grouping claims by target page, reading
the existing page for merge, generating claim records, running a literal-grounding check, and
updating the index and log. In `guided` it returns before writing anything, and `draft` composed
pages into `.jev-wiki/drafts/` from which nothing could promote them.

## Options considered

1. **`guided`** — the agent authors everything. Highest quality control, highest token cost, and the
   cost lands in the session context where it persists for the rest of the session.
2. **`draft`** — the writer model composes into a drafts directory; the agent reviews, corrects and
   promotes. Authoring moves to a bounded side call; the agent keeps the final word.
3. **`auto`** — the writer composes straight into `wiki/`; the agent handles only flagged pages.
   Cheapest, and the only guard is the code-level grounding check.

## Decision

- **`draft` is the default.** The agent reviews every composed page before it lands.
- **`auto` is an alternative, not a default.** It is adopted only after the two modes have been
  compared by testing, and even then it stays gated to claims below the criticality escalation
  threshold.
- Composing in a side call is the point: the authoring work leaves the session context, which is the
  resource the wiki exists to protect.
- Mode resolution is per item, not per batch, so one critical claim cannot drag the routine claims
  around it into hand-authoring.

## Consequences

- A promote path is a precondition, not a follow-on: without it `draft` is worse than `guided`,
  because the agent composes nothing and still has to write the page.
- Every written page records the mode it was written under, so decisions about the default can be
  re-litigated from the ledger rather than from memory.
- The agent's remaining job is review and correction, which is a reading pass, not an authoring pass.
- A composed page that fails the literal-grounding check is flagged `needs_review` rather than
  silently accepted.

## Evidence

- `docs/plans/AUTONOMY.md` — W2–W5 and the draft-vs-auto verification protocol.
- `src/pipeline/write.ts` — `writeAcceptedPages`, `resolveWriterMode`, `callWriter`.
- `src/config.ts` — `writer.mode` default.
