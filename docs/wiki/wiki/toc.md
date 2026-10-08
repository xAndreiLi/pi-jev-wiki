# Wiki TOC

> 53 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 22 | [toc/architecture.md](toc/architecture.md) |
| decisions | 16 | [toc/decisions.md](toc/decisions.md) |
| invariants | 11 | [toc/invariants.md](toc/invariants.md) |
| pi | 4 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [A vector store that will not open is rebuilt, not repaired](architecture/gotcha-corrupt-vector-store-recovery.md) — Historical (PGlite, removed 2026-10-08): a corrupt PGlite store aborted every open and wiki_ask quietly fell back to lexical search. The store is SQLite now — reset with wiki_index action=reset while pi runs, then npm run rebuild — but the lesson stands: a degraded index that does not say why is indistinguishable from an empty wiki. (2026-10-08)
- [The index store moves to SQLite — constraints, measured costs, decision](architecture/vector-store-swap-constraints.md) — The index store moves from PGlite + pgvector to SQLite (node:sqlite) with a connection per operation, so multi-process locking comes from SQLite, the store needs no single owner, and a reset is a file delete. Records the constraints it inherits (short-lived connections, busy_timeout before journal_mode=WAL, local filesystem, a missing store must read as empty) and the measured costs against PGlite at the real corpus size. (2026-10-08)
- [The vector store tolerates one opener, and it stays open for the whole session](architecture/gotcha-vector-store-single-owner.md) — Historical (PGlite, removed 2026-10-08): PGlite 0.5.8 locks nothing and the store was opened at session_start and released only at session_shutdown, so two concurrent pi sessions were unguarded openers of one store — the corruption precondition. The store is SQLite now: no single owner is needed, and a reset is a file delete. (2026-10-08)
- [One embedder process, one embedder identity](decisions/shared-embedder-parity.md) — The embedding model leaves pi sessions for a single shared local process, and the embedder identity is recorded on every chunk row as a fingerprint (preset, preset version, dtype, dimensions) that queries filter on and that status reports against — so a dtype, dimension or prompt-template change forces a rebuild instead of leaving vectors that score plausibly but are not comparable. (2026-10-08)
- [The shared embedder: one process, and the two ways to end up with three](architecture/gotcha-embedder-restarts.md) — One local process owns the embedding model, started on demand over a pipe derived from the agent dir. Two traps cost real CPU when it was first run: Windows lets several processes bind the same pipe name (so a pipe name is not a single instance — the daemon takes a pid lock file), and the pipe hash must come from a canonicalised agent dir or the same directory spelled two ways yields two daemons and two model copies. A batch lost to a dying daemon now retries once instead of failing a whole wiki. (2026-10-08)
