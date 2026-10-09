---
title: "A vector store that will not open is rebuilt, not repaired"
type: gotcha
topic: architecture
summary: "Historical (PGlite, removed 2026-10-08): a corrupt PGlite store aborted every open and wiki_ask quietly fell back to lexical search. The store is SQLite now — reset with wiki_index action=reset while pi runs, then rebuild with wiki_index action=rebuild all=true — but the lesson stands: a degraded index that does not say why is indistinguishable from an empty wiki."
tags: [index, pglite, vector, recovery, rebuild, gotcha]
updated: 2026-10-09
sources: [raw/sessions/2026-10-02-session-2026-10-02-002535.md, raw/sessions/2026-10-02-session-2026-10-02-002551.md]
claims:
  - id: c1
    text: "A PGlite semantic index that cannot open is repaired by deleting and rebuilding, not by fixing the store: on 2026-10-02 every open of `~/.pi/agent/jev-wiki/vector` aborted with `PANIC: could not locate a valid checkpoint record at 0/246FC18` after an unclean shutdown, and `wiki_ask` silently degraded to lexical search; deleting the directory and re-embedding all seven registered wikis (1,385 chunks) restored semantic retrieval."
    status: superseded
    support: 0.85
    evidence: ["\"command: node -e \\\"new PGlite('C:/Users/liand/.pi/agent/jev-wiki/vector'", "{ debug: 5 })\\\" → LOG: database system was interrupted; last known up at 2026-10-01 07:28:17 -05 / LOG: invalid resource manager ID in checkpoint record / PANIC: could not locate a valid checkpoint record at 0/246FC18 / Aborted()\"", "command: wiki_index action=rebuild per wiki, 2026-10-02 → database: ok; home 126, calisthenics 150, cultivation-game 245, card-sorter 101, memory 196, discord-assistant 319, pi-jev-wiki 248 chunks", "command: shell → mv vector vector.corrupt-2026-10-02 denied while the live session held the cached handle; rm -rf vector succeeded", "file: src/vector/db.ts (handle() sets this.db only after CREATE EXTENSION succeeds) — a retry after deletion constructs a fresh PGlite, which is why the fix works in the running session", "invariant: architecture/flow-retrieval.md c7 — the vector index is a derived cache, never a source of truth, safe to rebuild or delete"]
    reviewed: 2026-10-09
    last_checked: 2026-10-09
    superseded_by: commit 9a83aa1
files: [src/vector/db.ts, src/vector/registry.ts]
---



# A vector store that will not open is rebuilt, not repaired

> **Historical, 2026-10-08.** Written for the PGlite store, which was deleted on 2026-10-08
> (`PANIC: failed to add new item` during WAL redo of a Btree insert — the multi-writer corruption
> class). The index is SQLite now: `wiki_index action=reset` deletes it while pi runs and
> `wiki_index action=reset` deletes it while pi runs; `wiki_index action=rebuild all=true` re-embeds
> every registered wiki (`npm run rebuild` does the same from a checkout). The reusable lesson is the
> second half
> of the page: a degraded index must say why it is degraded, and preserved evidence must be marked
> where status is read, not only in a page.

**Status.** verified 2026-10-02, observed while fixing the index for all seven registered wikis.

## Symptom

`wiki_index status` reports `database: unavailable — Aborted(). Build with -sASSERTIONS for more info.`
and every wiki shows "not indexed yet". `wiki_ask` does not error — it returns lexical results, so the
degradation is easy to miss (see [silent search degradation](gotcha-silent-search-degradation.md)).

## Cause

Opening the data directory reproduces it outside any wiki tool:

```
$ node -e "new PGlite('C:/Users/liand/.pi/agent/jev-wiki/vector', { debug: 5 })"
LOG:  database system was interrupted; last known up at 2026-10-01 07:28:17 -05
LOG:  invalid resource manager ID in checkpoint record
PANIC:  could not locate a valid checkpoint record at 0/246FC18
Aborted()
```

The store did not shut down cleanly and its WAL cannot be replayed: crash recovery cannot find a valid
checkpoint. There is no repair path in PGlite 0.5.8 (no `pg_resetwal` ships with it), and the data is
derived anyway.

## Before deleting

Check whether the store is being kept as evidence. On 2026-10-01 this directory was deliberately
preserved — "do not rebuild it before that diagnosis" — for a toast-corruption investigation, and
that instruction lived only in a paragraph of
[the silent-degradation gotcha](gotcha-silent-search-degradation.md), so the maintenance path that
deleted it on 2026-10-02 did not see it and the deeper diagnosis became impossible. If you preserve a
broken store, mark it where status is read — not only in a page — and capture the panic output before
deleting. A rebuild discards the only copy.

## Fix

1. Delete `~/.pi/agent/jev-wiki/vector`. A rename fails while a live session holds the cached handle
   (`Permission denied`), but deleting the tree works, and `closeVectorDbs()` only runs at session
   shutdown — so delete, do not rename.
2. Rebuild: `wiki_index action=rebuild wiki=<name>` for each wiki, or `all=true`. The model cache
   (`jev-wiki/models`, ~956 MB) is untouched, so no download. On this machine the seven wikis took
   ~60–240 s each and produced 1,385 chunks.
3. Verify: `wiki_index status` shows `database: ok` with a chunk count per wiki, and a semantic
   `wiki_ask` returns the page you would expect.

## Why it works from inside the running session

`PGliteVectorDb.handle()` opens the database and runs `CREATE EXTENSION IF NOT EXISTS vector;` *before*
it assigns the cached handle:

```ts
const db = new pglite.PGlite({ dataDir: this.dataDir, extensions: { vector: pgvector.vector } });
await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
this.db = db;
```

A failed open therefore leaves the process-wide cache in a state that retries construction, so the
rebuild after the deletion creates a healthy store in the same session.

## What to keep

The panic output and the fact that search falls back silently, not a copy of the data directory. The
index rebuilds from the wiki pages; the ledgers and raws under `docs/wiki/` are the sources of truth.

## See also

[The vector store tolerates one opener, and it stays open for the whole session](gotcha-vector-store-single-owner.md)
— why a second process is never refused and why the handle outlives every write.
