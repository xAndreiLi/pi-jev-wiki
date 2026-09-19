---
title: Capture flow
type: architecture/flow
topic: architecture
summary: At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates.
tags: [capture, insights, workflow]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "Capture flow: at the end of work the agent composes an insight list with evidence pointers, Jev filters and places each insight, and the agent writes the resulting updates."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Capture flow

**Trigger.** Agent finishes substantive work and has durable, non-derivable insights to record.

**Participants.** Agent session, Jev adjudicator, wiki pages.

## Steps

1. Agent composes atomic insights with evidence pointers (files, commits, tests, user statements).
2. `wiki_insights` submits the list to Jev.
3. Jev filters by groundedness, derivability, and durability; chooses placement (update existing page or create new).
4. Agent writes or merges the recommended pages.
5. `wiki_finalize` updates TOC/log and checks links.

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
