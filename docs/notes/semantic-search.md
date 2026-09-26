# Semantic search across wikis (design note)

Status: P1 implemented (2026-09-25) · P2–P4 pending

## Goal

Agents can semantically search **all registered wikis** from any session — the user-level
life wiki, project wikis, and future linked wikis — while each wiki stays self-contained
(writes never cross roots; the index is a derived, read-only cache).

## Decisions

| Decision | Choice |
|---|---|
| Storage | **PGlite + pgvector** embedded (`@electric-sql/pglite` + `@electric-sql/pglite-pgvector`), one user-level DB; optional server Postgres later |
| Embedding models | Two presets: **`performance`** = EmbeddingGemma-300M (q8, 768d) *default*; **`quality`** = Qwen3-Embedding-0.6B (q8, 1024d) |
| Retrieval | `wiki_ask` gains `scope` (local / all / wiki names) and `search` (auto / keyword / semantic / hybrid); **hybrid = RRF** fusion of BM25 + vector, with automatic fallback when the index or deps are unavailable |
| Index scope | All **registered** wikis by default, per-wiki `enabled` opt-out; `wiki index forget <name>` purges immediately |
| Runtime | Local ONNX via `@huggingface/transformers` (lazy import, optional dependency); no Python, no GPU, no Docker, no API keys |
| Chunking | One chunk per active claim (title context included) + one per page section (~1,200 tokens, heading-stable keys) |
| Privacy | Embeddings and index stay local; cloud providers are an explicit later opt-in |

## Model presets (verified file sizes, HF API)

| Preset | Model | dtype | Dims | Download | MTEB | Prefixes |
|---|---|---|---|---|---|---|
| `performance` | `onnx-community/embeddinggemma-300m-ONNX` | q8 | 768 (MRL) | 309 MB (q4: 197 MB) | Eng v2 68.1 / Multi 61.2 | query: `task: search result \| query: …`; doc: `title: … \| text: …` |
| `quality` | `onnx-community/Qwen3-Embedding-0.6B-ONNX` | q8 | 1024 (MRL) | 614 MB | Eng v2 70.7 / Multi 64.3 | query: `Instruct: …\nQuery: …`; doc: plain |

Both are confirmed working with Transformers.js (`pooling: sentence_embedding` / `last_token`).
Switching presets triggers a rebuild and purges the other model's rows.

## Architecture

```
page claims/sections ──▶ chunker ──▶ provider (preset prefixes) ──▶ PGlite.wiki_chunks (pgvector)
                                                                          ▲
wiki_ask(query, scope) ──▶ embed ──▶ cosine KNN ─┐                        │
                                                 ├─ RRF fusion ──▶ grouped results, [wiki] tags
                          BM25/index engines ────┘
```

- **DB location**: `~/.pi/agent/jev-wiki/vector/` (PGlite data directory); model cache in
  `~/.pi/agent/jev-wiki/models/`. Both are user-level so every wiki in the registry is searchable
  from any session.
- **Registry**: `~/.pi/agent/jev-wiki/wikis.json` — `{ name, root, enabled, added }`. The current
  wiki auto-registers on first vector use.
- **Schema**: `wiki_chunks(wiki, path, key, kind, claim_id, status, title, text, hash, model, dim,
  embedding vector, updated_at)` with PK `(wiki, path, key)`; `wiki_index_state(wiki, model, dim,
  chunks, updated_at)`.
- **Incremental**: `content_hash = sha256(title + text)`; only changed chunks are re-embedded.
  `wiki_finalize` reindexes just the touched pages (non-fatal if deps/index are unavailable).
- **Progress**: `indexWiki` accepts an `onProgress` sink; the extension throttles it into one footer
  status entry via `ctx.ui.setStatus` (250 ms, cleared after indexing) and prints a single stable
  line when there is no UI. The transformers.js callback fires on cached loads too (~180 events in
  ~1.3 s for `quality`), so a per-event console sink floods the TUI on every reindex.
- **KNN**: exact cosine scan (`<=>`) — milliseconds at wiki scale; HNSW is a later option at
  20k+ chunks. Results carry `wiki`, `path`, `claim_id`, `status`, so `wiki_ask` can cite
  `[life] personal/summary-andrei-li.md#c3` and exclude superseded claims by default.
- **Provenance and fusion**: every lexical result is stamped with its wiki name; RRF merging is
  granularity-aware — a page-level lexical hit merges into a claim-level vector hit for the same
  page, while distinct claims stay separate. Empty results name scoped wikis with no indexed content
  yet instead of a generic "no match".
- **Catalog**: `wiki_toc scope=all` reads per-wiki TOC manifests plus index state and reports pages,
  topics, chunks, model, and staleness flags without parsing pages in bulk; see
  [`overview-and-toc.md`](overview-and-toc.md). Jev adds batched rerank and an evidence-sufficiency
  verdict to `wiki_ask` (`search.jev`), with every verdict recorded in the ledger.

## Model selection

`wiki_index action=model` reports the effective preset and its source (project config > user config >
built-in default). Before the first index build anywhere on the machine, `rebuild` stops with both
presets described and instructs the agent to ask the user; the choice is persisted to the user-level
config with `action=model model=performance|quality`. Switching presets marks every wiki stale and
requires `rebuild all=true`; the previous model's rows are purged per wiki, and queries degrade to
keyword search until the rebuild completes.

## Discovery and adoption

`wiki_index action=discover` walks the configured scan roots (default: the home directory;
`search.vector.scan.roots`, `maxDepth`, `wsl`) and queries each WSL distro with `find`, mapping
results to `\\wsl.localhost` paths. A directory is a wiki root when it contains `.jev-wiki/`, or
`wiki/` plus `raw/` or `wiki/index.md`; project `.pi/jev-wiki.json` files resolve their `wikiRoot`
too. The report groups wikis into unregistered / registered-but-missing / registered, with page
counts, marker type, and index status. `register=true` adopts everything unregistered;
`rebuild all=true` indexes every enabled wiki.

## Known limitations (P1)

- Cross-wiki catalog questions ("what projects do I have?") are answered by `wiki_index status` and
  `discover`, not by similarity search; a cross-wiki overview/TOC primitive is the next step (P2).

- PGlite is a single-process database: concurrent pi sessions writing the index at the same
  moment can conflict. Reads are unaffected; the escape hatch is the planned server-Postgres
  backend.
- Custom HF model ids are not yet supported (presets only); `dimensions` (MRL truncation) is
  supported per preset.
- Server Postgres, cloud providers, HNSW, and rerankers are P4.

## Phases

- **P1 (this)** — index core: PGlite backend, presets + local provider, chunker, registry,
  incremental reindex on finalize, `wiki_index` tool, `wiki_ask` scope/search, doctor checks,
  tests with a fake embedder.
- **P2** — cross-wiki links/`parent` integration, index-aware TOC, per-wiki opt-out surfaced in
  `wiki_status`.
- **P3** — golden-query benchmark (recall@5 / MRR: BM25 vs vector vs hybrid vs Jev-reranked) and
  default `wiki_ask` engine selection.
- **P4** — server Postgres, OpenAI/Ollama providers, HNSW, optional reranker.
