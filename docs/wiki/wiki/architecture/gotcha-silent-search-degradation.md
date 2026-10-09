---
title: Degraded search is indistinguishable from an empty wiki
type: gotcha
topic: architecture
summary: "A wiki_ask whose vector half fails returns local-wiki results, tagged and scored like real matches, with no warning in the default hybrid path — so an agent reading a low-recall result set concludes the knowledge is absent and re-derives what the wiki already holds."
tags: [search, retrieval, fallback, gotcha, vector]
updated: 2026-10-09
sources: [raw/sessions/2026-10-01-session-2026-10-01-015135.md]
claims:
  - id: c1
    text: "A wiki_ask that has silently degraded to lexical search is indistinguishable from an empty wiki: the tool returns local-wiki results, tags and scores them, and warns only in the explicit semantic path, so an agent reading a low-recall result set concludes the knowledge is absent and re-derives what the wiki already holds."
    status: needs_recheck
    support: 0.82
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-015135.md, handoffs/2026-10-01-search-fallback-and-evidence-diagnostics.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-09
files: [src/wiki/search.ts, src/extension.ts]
---


# Degraded search is indistinguishable from an empty wiki

**Symptom.** `wiki_ask` returns pages for a query the wiki does cover, but not the right ones, and
nothing in the output suggests a problem. Observed 2026-10-01: four queries asking for the `home`
and `calisthenics` wikis returned `[pi-jev-wiki]` pages only — each tagged, scored, and formatted as
an ordinary result set. Without reading the wiki's *contents* independently, the natural conclusion
is "that wiki has no page about this", which is the opposite of the truth.

**Cause.** `HybridSearchEngine` (`src/wiki/search.ts:364-367`) wraps both retrieval halves in
`.catch(() => [] as SearchResult[])`. A vector-side failure therefore becomes an empty candidate
list, RRF fuses lexical-only, and the result is presented as hybrid output. The default engine is
`auto`, which resolves to hybrid whenever a vector engine exists (`src/wiki/search.ts:261`), so this
is the common path. The failure surfaces only when semantic search is requested explicitly, because
`VectorSearchEngine` is not wrapped and the caller then adds
`Semantic search failed (…); used keyword search instead.`

Two consequences follow from the same place:

- **Scope is dropped with the vector half.** `wikis` and `scope: "all"` are passed only into
  `vectorSearch` (`src/extension.ts:1081-1088`); the lexical engine is built from the session
  layout alone (`src/wiki/search.ts:271-281`). When the vector half yields nothing, a request for
  another wiki is answered from the local one.
- **The telemetry agrees with the engine object, not the outcome.** `src/extension.ts:1175` records
  `detail: { engine: engine.name }` for the *constructed* engine, so `metrics.jsonl` reports
  `bm25+vector` for runs that returned lexical results (20 of 25 `ask` entries as of 2026-10-01).

**Consequence.** Any conclusion of the form "the wiki does not know X" drawn from `wiki_ask` alone
is unsound while this is present — including conclusions about retrieval quality, which is how the
gap was found: an efficacy-measurement plan was being written on the assumption that a low-recall
result set meant missing knowledge.

**How to tell, until this is fixed.** `wiki_toc wiki="<name>"` reads a specific wiki directly and is
not affected by the search path; the explicit `search: "semantic"` request surfaces the underlying
error in a note; and the recorded engine in `metrics.jsonl` cannot be trusted as evidence that
hybrid retrieval ran. `wiki_ask` also has no `wiki` parameter — a single-wiki lookup is
`wikis: ["<name>"]` (or `scope: "all"`); a `wiki:` key is silently ignored and the local wiki
answers (observed 2026-10-02: a query meant for `discord-assistant` returned three local pages at
0.44–0.48, and the same query with `wikis: ["discord-assistant"]` returned the intended page at 0.65).

**Current state (2026-10-02).** The store this page described as deliberately preserved was deleted
and rebuilt during maintenance: by 2026-10-02 it no longer opened at all (PGlite aborted with
`PANIC: could not locate a valid checkpoint record at 0/246FC18`), so the preservation period ended
without the deeper toast diagnosis it was kept for. All seven registered wikis were re-embedded
(1,385 chunks) and `wiki_index status` reports `database: ok`; the panic output and the recovery
procedure are in [the recovery gotcha](gotcha-corrupt-vector-store-recovery.md). Earlier report:
`handoffs/2026-10-01-search-fallback-and-evidence-diagnostics.md`.

**Related.** `architecture/flow-retrieval.md` documents the intended pipeline; this page documents
how it fails silently. `architecture/gotcha-capture-evidence-resolution.md` covers the adjacent case
where *evidence* fails to resolve and the agent is likewise told only that grounding failed.
