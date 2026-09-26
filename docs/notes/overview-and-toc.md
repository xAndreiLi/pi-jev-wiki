# Cross-wiki catalog and overview (design note)

Status: implemented (P2.0) · decisions agreed 2026-09-26

## Goal

Answer catalog questions ("what wikis do I have?", "what is in this wiki?") without dumping every
TOC, and without creating a second source of truth that can drift.

## Decisions

| Question | Decision |
|---|---|
| Surface | Extend `wiki_toc`: `scope: "all"` for the catalog, `wiki: "<name>"` for another wiki's entries, existing topic/tag/query filters otherwise. No new tool. |
| Persistence | Per-wiki derived manifest at `<wikiRoot>/.jev-wiki/toc.json`, gitignored, written by the **same single writer** that writes `index.md`/`toc/` (`updateIndex`). Never a merged global TOC file. |
| Index health | Folded into the catalog (chunks, model, last indexed, flags) rather than deferring to `wiki_index status`. |
| Listing visibility | Reuses the registry `enabled` flag; a separate `listed` flag can split indexing from advertising later. |
| Jev | Retrieval judgments (rerank + sufficiency), see below. Never owns counts, budgets, or ordering keys. |

## Layers and budgets

| Layer | Cost | Budget |
|---|---|---|
| **L0 catalog** (`wiki_toc scope=all`) — name, root, pages, topics, chunks, model, last indexed, flags | O(wikis): manifest read + one page-mtime walk per wiki | default 25 wikis, `limit` ≤ 100, `offset` paging |
| **L1 wiki TOC** (`wiki_toc wiki=<name>`) | one wiki | `toc.maxTokens` (3000, ×4 chars) with a "… N more entries" tail |
| **L2 content** (`wiki_ask`, optionally scoped) | unchanged | existing limits |

Ordering is deterministic: most recently active (index `updatedAt`, else manifest `generatedAt`),
then name — so paging is stable across calls. Measured: **100 wikis catalogued in 29 ms** (manifest
reads plus page-mtime walks, concurrency 4) in the vector test suite.

## Maintenance and staleness

- `index.md`, `toc/<topic>.md`, and `.jev-wiki/toc.json` are written together under the wiki lock.
  The manifest carries `entriesHash` (drift check), `pages`, `topics`, `generatedAt`, and the
  write-time `newestPageMtime`.
- **Staleness is computed, not guessed**: the catalog walks the wiki's real pages (excluding
  generated files) and compares the *current* newest mtime against `manifest.generatedAt`
  (`toc-stale`) and against the index `updatedAt` (`index-stale`). The walk is the price of a
  correct answer; it is bounded by concurrency 4 and a 750 ms timeout per wiki.
- Flags: `root-missing`, `unreachable`, `manifest-missing`, `empty`, `never-indexed`, `disabled`,
  `toc-stale`, `index-stale`, `model-mismatch`.
- Page counting is shared (`countPages`) and excludes `index.md`, `log.md`, `toc.md`, and `toc/`,
  so `discover`, `status`, and the catalog agree.

## Failure isolation

- Bounded concurrency (4) and per-wiki timeout (750 ms); failures become `unreachable` flags.
- The catalog is read-only and never writes into another wiki; the index database is optional
  (catalog still reports TOC metadata when it is unavailable).

## Jev retrieval judgments (P-A)

- `wiki_ask` asks Jev for, in **one batched call**: a relevance `noul` per candidate (up to
  `search.jev.maxCandidates`, default 8) and one sufficiency `noul` for the evidence set.
- `search.jev.rerank`: `"never"` | `"always"` | `"auto"` (default). `auto` reranks hybrid queries
  only — the case where two rankings are fused and order is least trustworthy — so simple keyword
  and pure-vector queries stay fast.
- `search.jev.sufficiency: true` adds a calibrated note when the verdict is below
  `minSufficiency` (default 0.5): *"Evidence may be insufficient (0.30): the wiki may not cover this
  yet."*
- Every judgment is written to the decision ledger (`actor: jev`, `op: ask.judge`) with the
  per-candidate scores and token usage, so the P3 benchmark can compare pure fusion against
  Jev-reranked results. Any Jev failure degrades to the unjudged result order.

## Known gaps (next)

- In-process catalog cache (root + mtime fingerprint) to avoid repeat walks within a session.
- Jev routing (P-B): choose wikis / catalog-vs-search once the registry exceeds ~20 wikis.
- Cross-wiki contradiction scan and summary-fidelity lint (P-B/P-C).
- HNSW at 20k+ chunks; server Postgres; cloud embedding providers (P4).
