---
title: pi extension module
type: architecture/module
topic: architecture
summary: Owns staging, Jev adjudication, placement, and TOC/log bookkeeping for the project wiki.
tags: [pi-extension, architecture, wiki]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "The pi extension owns staging, Jev adjudication, placement, and TOC/log bookkeeping."
    status: verified
    support: 0.97
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
  - id: c2
    text: "Claims without file links are not checked on code changes; they rely on the periodic lint backstop instead."
    status: verified
    support: 0.95
    evidence: [PLAN.md]
files: []
---

# pi extension module

**Responsibility.** Owns the wiki tools registered in pi sessions (`wiki_toc`, `wiki_ask`, `wiki_ingest`, `wiki_insights`, `wiki_finalize`). It stages sources, runs Jev adjudication, decides placement, and maintains the table of contents and log.

**Public surface.** The five wiki tool contracts exposed to agents.

**Dependencies.** A separate Jev client that speaks to TypeSafe's System One API.

**Key files.** None documented (extension code not yet mapped).

## Invariants

- Jev returns typed decisions (`noul`, `choice`, `score`), never free-form text.
- Claims without file links are not checked on code changes; they rely on the periodic `wiki_lint` backstop instead.

## Failure modes

- If Jev adjudication fails, placement falls back to agent discretion.
- Broken links are reported during `wiki_finalize`.

## Change impact

- Changes to tool contracts affect every agent workflow that ingests or captures insights.
- Changes to Jev client configuration affect grounding and derivability scoring.

## See also

- [Jev typed decisions](../invariants/jev-typed-decisions.md)
- [Capture flow](../architecture/flow-capture.md)
