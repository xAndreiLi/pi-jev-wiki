---
title: Capture flow
type: architecture/flow
topic: architecture
summary: "At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates. Capture runs on a configurable cadence (manual, task, or commit), with onCompact as an independent trigger."
tags: [capture, insights, workflow, cadence]
updated: 2026-09-26
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md, raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
claims:
  - id: c1
    text: "Capture flow: at the end of work the agent composes an insight list with evidence pointers, Jev filters and places each insight, and the agent writes the resulting updates."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
  - id: c2
    text: "capture.cadence has three modes: manual (default, only /wiki:capture or explicit wiki_insights), task (after each settled task, a Jev pre-screen decides whether the session is worth extracting; accepted insights are queued for the agent to write with a 10-minute debounce), and commit (only after a new git commit is detected, regardless of how it was made, with no time debounce)."
    status: verified
    support: 0.97
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c3
    text: "capture.onCompact: true is an independent trigger that captures before context compaction."
    status: verified
    support: 0.97
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c4
    text: "The legacy capture.onSettle: true still enables task capture."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/pipeline/capture.ts, src/config.ts]
---

# Capture flow

**Trigger.** Agent finishes substantive work and has durable, non-derivable insights to record.

**Intake channels.** Research ingest (`wiki_ingest`) stages a document immutably under `raw/<topic>/` and splits it into atomic claims; session insights (this page) are composed by the agent with evidence pointers. Both feed the same adjudication and storage pipeline.

**Participants.** Agent session, Jev adjudicator, wiki pages.

## Steps

1. Agent composes atomic insights with evidence pointers (files, commits, tests, user statements).
2. `wiki_insights` submits the list to Jev.
3. Jev filters by groundedness, derivability, and durability; chooses placement (update existing page or create new).
4. Agent writes or merges the recommended pages.
5. `wiki_finalize` updates TOC/log and checks links.

## Capture cadence

`capture.cadence` controls how often the agent updates the wiki during normal work:

- `manual` (default) — only `/wiki:capture` or an explicit `wiki_insights` call.
- `task` — after each settled task a Jev pre-screen decides whether the session is worth extracting; accepted insights are queued for the agent to write with a 10-minute debounce.
- `commit` — only after a new git commit is detected, regardless of how it was made, with no time debounce ("update the wiki when I'm ready to commit").

`capture.onCompact: true` remains an independent trigger (capture before context compaction), and the legacy `capture.onSettle: true` still enables task capture.

## Invariants

- Insights must not contain transient task state, code snippets, or anything derivable from the repo.
- Every insight must cite evidence.

## Failure modes

- If Jev rejects all insights, no pages are updated.
- If agent writes without following the brief, `wiki_finalize` may report link or claim mismatches.

## Change impact

- Changes to insight schema affect `wiki_insights` and Jev placement logic.
- Changes to page templates affect step 4.

## See also

- [pi extension module](../architecture/module-pi-extension.md)
- [Scope boundary](../decisions/scope-boundary.md)
- [Guided writing](../decisions/guided-writing.md)
