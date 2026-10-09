# Wiki TOC

> 57 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 24 | [toc/architecture.md](toc/architecture.md) |
| decisions | 17 | [toc/decisions.md](toc/decisions.md) |
| invariants | 12 | [toc/invariants.md](toc/invariants.md) |
| pi | 4 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [One install source only](pi/one-install-source.md) — npm is the supported install for pi-jev-wiki; a repository clone is a development tree, not an install path. Whichever source you use, register exactly one — a second copy makes pi refuse to load the extension with tool-conflict errors. (2026-10-09)
- [A vector store that will not open is rebuilt, not repaired](architecture/gotcha-corrupt-vector-store-recovery.md) — Historical (PGlite, removed 2026-10-08): a corrupt PGlite store aborted every open and wiki_ask quietly fell back to lexical search. The store is SQLite now — reset with wiki_index action=reset while pi runs, then rebuild with wiki_index action=rebuild all=true — but the lesson stands: a degraded index that does not say why is indistinguishable from an empty wiki. (2026-10-08)
- [The index store moves to SQLite — constraints, measured costs, decision](architecture/vector-store-swap-constraints.md) — The index store moves from PGlite + pgvector to SQLite (node:sqlite) with a connection per operation, so multi-process locking comes from SQLite, the store needs no single owner, and a reset is a file delete. Records the constraints it inherits (short-lived connections, busy_timeout before journal_mode=WAL, local filesystem, a missing store must read as empty) and the measured costs against PGlite at the real corpus size. (2026-10-08)
- [The installed copy could not start the embedder](architecture/gotcha-installed-copy-cannot-spawn.md) — 1.0.0 shipped a shared embedder whose daemon only started from a checkout: Node refuses to strip TypeScript under node_modules, so the shipped `server.ts` entry died with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING and every npm install had no semantic search while the whole suite stayed green. The daemon now launches through a plain-JavaScript shim, and CI runs `npm run test:install` — the packed tarball, installed and driven in a throwaway project — on every push and before publishing. (2026-10-08)
- [The maintenance loop](architecture/flow-maintenance.md) — Wiki maintenance is a closed loop of six stages — trigger, adjudication, placement, write, commit, and currency/health — in which only the write stage needs an agent, and every stage is bounded by an escalation boundary and the failure-loop rules. (2026-10-08)
