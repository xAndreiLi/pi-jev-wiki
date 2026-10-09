---
title: "The vector store tolerates one opener, and it stays open for the whole session"
type: gotcha
topic: architecture
summary: "Historical (PGlite, removed 2026-10-08): PGlite 0.5.8 locks nothing and the store was opened at session_start and released only at session_shutdown, so two concurrent pi sessions were unguarded openers of one store — the corruption precondition. The store is SQLite now: no single owner is needed, and a reset is a file delete."
tags: [index, pglite, vector, concurrency, lifecycle, gotcha]
updated: 2026-10-09
sources: [raw/sessions/2026-10-08-session-2026-10-08-065213.md, raw/sessions/2026-10-08-session-2026-10-08-065227.md]
claims:
  - id: c1
    text: "PGlite 0.5.8 does not lock its data directory: a second process that opens ~/.pi/agent/jev-wiki/vector while another holds it is not refused and reads its own snapshot, so nothing at the storage layer prevents two openers of the shared vector store."
    status: superseded
    support: 0.83
    evidence: ["command: two-process probe 2026-10-08 on a temp dataDir — process A opened and CREATE TABLE'd, then process B opened the same dir while A was still open → 'B: OPENED CONCURRENTLY, rows = 0', no error", "file: node_modules/@electric-sql/pglite/dist/fs/nodefs.d.ts — NodeFS declares only init() and closeFs(), no inter-process lock", "source: https://github.com/electric-sql/pglite/issues/323 — 'PGlite is Postgres in single user mode. There is no support for concurrent connections and you are like to corrupt the database if you open it multiple times at once.'"]
    reviewed: 2026-10-08
    last_checked: 2026-10-09
    superseded_by: commit 9a83aa1
  - id: c2
    text: "The embedded vector store has session-grained lifetime: it is opened during session_start by the default-on warmEmbeddingProvider and closed only by closeVectorDbs() on session_shutdown, with no per-query or idle release point (the handle is cached process-wide in vectorDbFor)."
    status: verified
    support: 0.53
    evidence: ["file: src/extension.ts — pi.on(\"session_start\") calls `void warmEmbeddingProvider(loaded, warmLayout.wikiDir).catch(() => undefined);`, and pi.on(\"session_shutdown\") calls `await closeVectorDbs()`", "file: src/auto-retrieve.ts — warmEmbeddingProvider guards on `hooks.autoRetrieve.mode === \"off\" || !vectorEnabled(...)` and then calls `vectorDbFor(vectorDataDir(loaded.agentDir)).counts()`, which constructs the PGlite instance", "file: src/config.ts — DEFAULT_CONFIG sets `hooks: { autoRetrieve: { mode: \"inject\", ... } }` and `search: { vector: { enabled: true, db: \"embedded\", ... } }`, so both guards pass out of the box", "file: src/vector/db.ts — `const instances = new Map<string, PGliteVectorDb>()` with 'Process-wide shared handle per data directory', and close() is the only release"]
    reviewed: 2026-10-08
    last_checked: 2026-10-09
files: [src/vector/db.ts, src/extension.ts, src/auto-retrieve.ts, src/config.ts]
---


# The vector store tolerates one opener, and it stays open for the whole session

> **Historical, 2026-10-08.** This describes the PGlite store, which no longer exists: the index is
> SQLite now ([the store decision](vector-store-swap-constraints.md#decision), [plan](../../../plans/INDEX-SERVICE.md)),
> where every operation opens and closes its own connection, several sessions share one store safely,
> and a reset is a file delete. The claims below remain true statements about PGlite 0.5.8 — a
> caution for anyone reaching for it again — not about the current index.

**Status.** verified 2026-10-08 with a two-process probe; both halves observed directly.

## What was observed

Opening one data directory twice is silent. Running two Node processes against the same PGlite
directory — A opens it and creates a table, B opens it while A is still open — produces no error at
all: B starts, reads the schema, reports `rows = 0`, and holds its own snapshot.

```
A: opened and wrote schema at 2026-10-08T10:50:13.423Z
B: OPENED CONCURRENTLY, rows = 0
```

Nothing in the store refuses the second opener. Upstream states the rule plainly: PGlite is Postgres
in single-user mode, concurrent opens are unsupported, and corrupting the database is the expected
outcome ([issue 323](https://github.com/electric-sql/pglite/issues/323)). NodeFS in 0.5.8 exposes
only `init()` and `closeFs()` — there is no lock file, and the multi-process guard that upstream
added later is not in this version.

## Why the window is the whole session

The store is not opened per query and closed again. With the default config (`hooks.autoRetrieve.mode:
"inject"`, `search.vector.enabled: true`) every session warms the embedder at `session_start`, and
that path calls `counts()`, which constructs the PGlite instance. The handle is cached process-wide
by `vectorDbFor(dataDir)`, and the only release point is `closeVectorDbs()` in `session_shutdown`.

So the store is open from the first moment of a session to its last, whether or not the session ever
searches anything.

## What this means

- **Two pi sessions on one machine are two unguarded openers of the same store.** That is the
  precondition for the failure already recorded in
  [a vector store that will not open is rebuilt, not repaired](gotcha-corrupt-vector-store-recovery.md):
  independent buffers and WAL against one directory, with no error until the checkpoint PANIC
  appears on the next open.
- **Repair and reset are hostage to session lifetime.** While any session holds the handle the store
  cannot be swapped, renamed, or reset from outside; deleting the tree is the only move that always
  works, and it is the destructive one. See the recovery page for that procedure.
- **Any change here has to make one process the owner** — either a single owning process that every
  session talks to, or storage that handles multi-process access itself — and make the handle
  releasable without ending the session.

## Evidence

- Probe: two Node processes, one temp data directory, 2026-10-08 (`OPENED CONCURRENTLY`).
- `node_modules/@electric-sql/pglite/dist/fs/nodefs.d.ts` — no lock.
- `src/extension.ts` — `session_start` warms, `session_shutdown` closes.
- `src/auto-retrieve.ts` — the warm path reaches `counts()`.
- `src/config.ts` — auto-retrieve and the vector index are both on by default.
- `src/vector/db.ts` — process-wide handle cache, no idle release.
