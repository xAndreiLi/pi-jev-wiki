---
title: The index store moves to SQLite — constraints, measured costs, decision
type: gotcha
topic: architecture
summary: "The index store moves from PGlite + pgvector to SQLite (node:sqlite) with a connection per operation, so multi-process locking comes from SQLite, the store needs no single owner, and a reset is a file delete. Records the constraints it inherits (short-lived connections, busy_timeout before journal_mode=WAL, local filesystem, a missing store must read as empty) and the measured costs against PGlite at the real corpus size."
tags: [index, vector, sqlite, pglite, concurrency, measurement, decision, gotcha]
updated: 2026-10-08
needs_review: true
sources: [raw/sessions/2026-10-08-session-2026-10-08-070016.md]
claims:
  - id: c1
    text: "A SQLite-backed store is only resettable if its connections are short-lived: on Windows a database file cannot be renamed or deleted while any process holds an open connection (EBUSY) — deletion succeeds in ~4 ms once the connection is closed — and `PRAGMA journal_mode=WAL` needs an exclusive lock, throwing SQLITE_BUSY immediately (errcode 261) when another process holds the database unless busy_timeout is set first in its own statement."
    status: verified
    support: 0.85
    evidence: ["command: scratch benchmark 2026-10-08 — `rename while held: EBUSY / delete while held: EBUSY`, then `delete while idle session alive: exit 0 after 1 attempt(s), 4 ms` once the other process's connection was closed", "command: scratch benchmark 2026-10-08 — `Error: database is locked / errcode: 261, errstr: 'database is locked' at db.exec(\"PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;\")` — the WAL switch ran before busy_timeout was set"]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c2
    text: "Measured at the real corpus size (1,385 chunks, 1024d) on 2026-10-08, node:sqlite with a BLOB column was faster than the PGlite+pgvector store in every operation measured — open/close 0.8 ms vs 1,683 ms PGlite boot, 1,385-row insert 59 ms vs 1,907 ms, KNN 9.2 ms vs 12.6 ms per query (1.9 ms with the vectors resident) — and three processes performing ~19,000 interleaved short-lived open/query/close cycles produced zero errors with integrity_check ok."
    status: verified
    support: 0.52
    evidence: ["command: scratch benchmark 2026-10-08, both backends loaded with the same 1,385 random 1024d vectors and the production batch size of 50 rows", "command: scratch benchmark 2026-10-08 — three Node processes against one database for 6 s: `5244 + 8715 + 5490 open/query/close cycles, 0 errors, exit codes [0,0,0], integrity_check: ok`"]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c3
    text: "The store moves to SQLite (node:sqlite) with a connection opened per operation and closed immediately: SQLite supplies multi-process locking, so the store no longer needs a single owner and a reset is a file delete that works while sessions run."
    status: user-stated
    support: 0.82
    evidence: ["user: \"Lets go with your recs here.\" (Andrei, 2026-10-08)", "file: docs/plans/INDEX-SERVICE.md — decision section: replace PGlite + pgvector with SQLite, per-operation connections, keep ~/.pi/agent/jev-wiki/vector as the reset target", "command: scratch benchmark 2026-10-08 — open+pragma+close 0.8 ms per cycle; three processes, ~19,000 short-lived cycles, 0 errors, integrity_check ok"]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
files: [src/vector/db.ts, docs/plans/INDEX-SERVICE.md]
---

# The index store moves to SQLite — constraints, measured costs, decision

**Status.** measured 2026-10-08 on this machine; decided the same day. Numbers hold for a personal
corpus of this size, not for the general case.

## Outcome (2026-10-08)

Implemented the same day. The PGlite store was deleted (its last open failed in WAL redo:
`PANIC: failed to add new item` on a Btree insert — the multi-writer corruption class this swap
removes), and `npm run rebuild` re-embedded every registered wiki into `index.sqlite` through the
shared embedder. `wiki_index status` now reports the store path and size, the embedder identity, the
live daemon's pid, and which wikis were indexed by a different identity; `wiki_ask` states why when
no vectors can be compared.

## Decision

The store becomes SQLite (`node:sqlite`) at `~/.pi/agent/jev-wiki/vector/index.sqlite`, with a
connection opened per operation and closed immediately, embeddings stored normalized as BLOBs, and
KNN as an exact cosine scan in JS. PGlite and pgvector are removed once the cross-backend
equivalence test passes. Full build plan: [docs/plans/INDEX-SERVICE.md](../../../plans/INDEX-SERVICE.md).

The point of the swap is not speed — it is that the store stops needing a single owner, so the
corruption class in [the single-opener page](gotcha-vector-store-single-owner.md) becomes
unreachable and the store can be reset by deleting a file while pi keeps running.

## Constraints any replacement inherits

- **One owner is not required; one writer per moment is.** The reason PGlite forced a single process
  (see [the single-opener page](gotcha-vector-store-single-owner.md)) does not carry over to a store
  that has real multi-process locking.
- **Short-lived connections are the reset mechanism.** On Windows a database file cannot be renamed
  or deleted while a process holds it open (`EBUSY`); deleting works the moment the connection is
  closed. A long-lived handle recreates the exact problem the swap is meant to remove.
- **`busy_timeout` must be set before anything that takes a lock**, in its own statement:
  `PRAGMA journal_mode=WAL` on a database another process holds throws `SQLITE_BUSY` (errcode 261)
  immediately — the timeout added in the same `exec()` never takes effect.
- **The store must live on a local filesystem.** WAL mode is not safe over network shares, and
  `<agent dir>/jev-wiki/` is local while some registered wikis are not.
- **A reset must read as "empty index", not as an error.** After the file is deleted, the next query
  in a live session failed with `no such table: chunks` — every open has to re-run the schema DDL so
  a missing store degrades into "not indexed yet" and triggers a rebuild.

## Measured costs

Same corpus (1,385 chunks, 1024 dimensions), same machine, 2026-10-08:

| Operation | PGlite + pgvector | node:sqlite (BLOB) |
|---|---|---|
| Open / boot | 1,683 ms (WASM boot + extension) | 0.8 ms (open + pragmas + close) |
| Insert 1,385 rows | 1,907 ms (batches of 50, text vectors) | 59 ms |
| KNN query | 12.6 ms | 9.2 ms (1.9 ms with vectors resident) |
| Store size | 67 MB data dir | 7.8 MB file |
| Concurrent processes | not refused, silently corrupts | 3 processes, ~19,000 cycles, 0 errors, integrity ok |

Suite shape: 1,385 vectors is the whole registered corpus on this machine, and the KNN is an exact
scan in both backends — no ANN index exists in the schema, so an ANN index is not a requirement at
this size.

## What this does not settle

- Whether a shared model process is worth building. That is a separate cost: warming the `quality`
  preset costs ~750 MB RSS and ~1.5 s **per session** (71 MB → 800 MB measured), while a warm query
  embedding takes 39 ms. Numbers are specific to that preset.
- The cross-backend ranking equivalence check: a swap is not done until the same fixture returns the
  same top-K from both backends.
