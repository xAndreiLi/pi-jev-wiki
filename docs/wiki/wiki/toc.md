# Wiki TOC

> 58 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 25 | [toc/architecture.md](toc/architecture.md) |
| decisions | 17 | [toc/decisions.md](toc/decisions.md) |
| invariants | 12 | [toc/invariants.md](toc/invariants.md) |
| pi | 4 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Finalize leaves TOC shards that git reports as modified](architecture/gotcha-toc-shards-lf-crlf.md) — A tool that rewrites a tracked file with bytes a checkout would not produce — the wiki writer creating a TOC shard with LF while git expects CRLF — leaves it reported as modified in git status while git diff is empty and the blob hashes match. .gitattributes now pins checkouts to LF; a file still cached as CRLF trips once and a re-checkout clears it. (2026-10-09)
- [Retrieval pipeline](architecture/flow-retrieval.md) — wiki_ask retrieves knowledge from a derived vector index: claim and section chunks, local embedding presets, hybrid BM25+vector rank fusion (RRF), and batched Jev rerank and sufficiency judgments, with keyword fallback when the index is cold. (2026-10-09)
- [One install source only](pi/one-install-source.md) — npm is the supported install for pi-jev-wiki; a repository clone is a development tree, not an install path. Whichever source you use, register exactly one — a second copy makes pi refuse to load the extension with tool-conflict errors. (2026-10-09)
- [A vector store that will not open is rebuilt, not repaired](architecture/gotcha-corrupt-vector-store-recovery.md) — Historical (PGlite, removed 2026-10-08): a corrupt PGlite store aborted every open and wiki_ask quietly fell back to lexical search. The store is SQLite now — reset with wiki_index action=reset while pi runs, then rebuild with wiki_index action=rebuild all=true — but the lesson stands: a degraded index that does not say why is indistinguishable from an empty wiki. (2026-10-08)
- [The index store moves to SQLite — constraints, measured costs, decision](architecture/vector-store-swap-constraints.md) — The index store moves from PGlite + pgvector to SQLite (node:sqlite) with a connection per operation, so multi-process locking comes from SQLite, the store needs no single owner, and a reset is a file delete. Records the constraints it inherits (short-lived connections, busy_timeout before journal_mode=WAL, local filesystem, a missing store must read as empty) and the measured costs against PGlite at the real corpus size. (2026-10-08)
