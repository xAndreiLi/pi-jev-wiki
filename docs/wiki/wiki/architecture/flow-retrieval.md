---
title: Retrieval pipeline
type: architecture/flow
topic: architecture
summary: "wiki_ask retrieves knowledge from a derived vector index: claim and section chunks, local embedding presets, hybrid BM25+vector rank fusion (RRF), and batched Jev rerank and sufficiency judgments, with keyword fallback when the index is cold."
tags: [retrieval, search, embeddings, index, fusion, jev]
updated: 2026-09-26
sources: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
claims:
  - id: c1
    text: "Chunking produces one chunk per active claim (with page-title context) plus one per page section (~1,200 tokens, heading-stable keys)."
    status: verified
    support: 0.96
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c2
    text: "Generated files (index.md, log.md, toc.md, toc/) are never chunked."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c3
    text: "Embeddings are local, CPU-only ONNX via @huggingface/transformers with two presets: performance (EmbeddingGemma-300M, q8, 768d) and quality (Qwen3-Embedding-0.6B, q8, 1024d)."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c4
    text: "Embedding presets include MRL truncation and per-model prompt templates."
    status: verified
    support: 0.81
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c5
    text: "The embedding model is chosen once, before the first build, via wiki_index action=model."
    status: verified
    support: 0.96
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c6
    text: "The vector index uses PGlite + pgvector with one user-level database covering every registered wiki at ~/.pi/agent/jev-wiki/vector."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c7
    text: "The vector index is a derived cache — never a source of truth, safe to rebuild or delete."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c8
    text: "Queries never download a model; a cold or mismatched index falls back to keyword search."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c9
    text: "wiki_ask selects keyword (index/BM25), semantic (cosine KNN), or hybrid search modes."
    status: verified
    support: 0.97
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c10
    text: "Hybrid search fuses BM25 and vector ranks with reciprocal rank fusion."
    status: verified
    support: 0.99
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c11
    text: "Fusion is granularity-aware: a page-level lexical hit merges into a claim-level sibling, while distinct claims stay separate."
    status: verified
    support: 0.98
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c12
    text: "One batched Jev call scores each candidate's relevance to the query (rerank) and returns an evidence-sufficiency verdict."
    status: verified
    support: 0.97
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c13
    text: "search.jev.rerank can be auto (hybrid only), always, or never."
    status: verified
    support: 0.97
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c14
    text: "Below search.jev.minSufficiency, the answer carries a calibrated note that the wiki may not cover this yet."
    status: verified
    support: 0.89
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c15
    text: "Rerank verdicts are logged as ask.judge."
    status: verified
    support: 0.77
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/vector/chunks.ts, src/vector/embed.ts, src/vector/db.ts, src/wiki/search.ts, src/vector/judgments.ts]
---

# Retrieval pipeline

**Trigger.** An agent calls `wiki_ask` with a question; optionally `scope=all` to search every registered wiki, or `search` to force keyword/semantic/hybrid.

**Participants.** Chunk builder (`src/vector/chunks.ts`) → embedder (`src/vector/embed.ts`) → index (`src/vector/db.ts`) → query/fusion (`src/wiki/search.ts`) → Jev retrieval judge (`src/vector/judgments.ts`).

## Steps

1. **Chunking** — pages are split into one chunk per active claim (with page-title context) plus one per page section (~1,200 tokens, heading-stable keys); generated files are never chunked.
2. **Embedding** — chunks are embedded locally, CPU-only, with a preset chosen once before the first build via `wiki_index action=model`: `performance` (EmbeddingGemma-300M, q8, 768d) or `quality` (Qwen3-Embedding-0.6B, q8, 1024d). Presets include MRL truncation and per-model prompt templates.
3. **Index** — chunks are stored in one user-level PGlite + pgvector database covering every registered wiki (~/.pi/agent/jev-wiki/vector). The index is a derived cache: never a source of truth, safe to rebuild or delete.
4. **Query** — `wiki_ask` runs keyword (index/BM25), semantic (cosine KNN), or hybrid retrieval. A cold or mismatched index falls back to keyword search; queries never download a model.
5. **Fusion** — hybrid search fuses BM25 and vector ranks with reciprocal rank fusion, and is granularity-aware: a page-level lexical hit merges into a claim-level sibling while distinct claims stay separate.
6. **Jev judgments** — one batched Jev call reranks candidates by relevance and returns an evidence-sufficiency verdict (`search.jev.rerank` is `auto` (hybrid only), `always`, or `never`). Below `search.jev.minSufficiency` the answer carries a calibrated "the wiki may not cover this yet" note; verdicts are logged as `ask.judge`.

## Invariants

- The index is a derived cache and may be rebuilt or deleted at any time.
- A cold or model-mismatched index degrades to keyword search instead of failing or downloading a model.
- Generated files are never chunked.

## Failure modes

- **Model mismatch or cold index** — semantic results are unavailable until rebuild; retrieval silently falls back to keyword.
- **Sufficiency below threshold** — the answer is annotated rather than trusted; the wiki may not cover the question yet.
- **Model swap with a stale index** — the old vectors no longer match; rebuild before relying on semantic retrieval.

## Change impact

- Chunk shape changes (`src/vector/chunks.ts`) require a full re-index.
- Embedding preset changes (`src/vector/embed.ts`, `search.vector.model`) purge and re-embed per wiki.
- Fusion or rerank changes (`src/wiki/search.ts`, `src/vector/judgments.ts`) affect ranking for every `wiki_ask` call.

## See also

- [Adjudication policy computed in code](adjudication-policy.md)
- [Table of contents hierarchy](table-of-contents.md)
- [Capture flow](flow-capture.md)
