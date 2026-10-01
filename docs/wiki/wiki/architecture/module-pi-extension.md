---
title: pi extension module
type: architecture/module
topic: architecture
summary: Owns staging, Jev adjudication, placement, and TOC/log bookkeeping for the project wiki.
tags: [pi-extension, architecture, wiki]
updated: 2026-09-28
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
    evidence: [docs/plans/PLAN.md]
files: [src/extension.ts, src/config.ts, src/pipeline/capture.ts, src/pipeline/adjudicate.ts, src/wiki/toc.ts]
---

# pi extension module

**Responsibility.** Owns the wiki tools registered in pi sessions. It stages sources, runs Jev adjudication, decides placement, and maintains the table of contents and log.

**Public surface.** Fifteen `wiki_*` tools exposed to agents, grouped by job:

- **Knowledge** — `wiki_toc`, `wiki_ask`, `wiki_status`.
- **Writing** — `wiki_ingest`, `wiki_insights`, `wiki_finalize`, `wiki_remove`.
- **Maintenance** — `wiki_sync`, `wiki_review`, `wiki_lint`, `wiki_structure`, `wiki_index`, `wiki_doctor`, `wiki_setup`, `wiki_triage`.

Every tool accepts an optional `wiki: "<registered name>"` and targets exactly one registered wiki per call; omitting it keeps the session wiki ([cross-wiki writes](../decisions/cross-wiki-writes.md)).

**Dependencies.** A provider-agnostic Jev client (`src/jev.ts`) speaking to System One, plus the local vector stack (PGlite + pgvector, `@huggingface/transformers`) used by retrieval and the catalog.

**Key files.**

- `src/extension.ts` — tool registration, session hooks, and orchestration.
- `src/config.ts` — configuration schema and defaults (`.pi/jev-wiki.json`).
- `src/pipeline/` — capture/extraction (`capture.ts`, `extract.ts`), adjudication (`adjudicate.ts`), page writing (`write.ts`).
- `src/wiki/` — layout, lock, frontmatter, TOC/manifest, search, links, cross-wiki target resolution.
- `src/vector/` — chunking, embeddings, index, judgments, registry, discovery.
- `src/review.ts`, `src/sync.ts`, `src/lint.ts`, `src/doctor.ts`, `src/triage.ts`, `src/structure.ts` — maintenance flows.

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
- [Cross-wiki write routing](../decisions/cross-wiki-writes.md)
- [One install source only](../pi/one-install-source.md)
- [Structure coverage check](structure-coverage.md)
- [Provider-agnostic Jev client schema](../decisions/provider-agnostic-schema.md)
