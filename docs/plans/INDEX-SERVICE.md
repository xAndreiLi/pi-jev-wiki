# Index service: SQLite store + one shared embedder

Decision (2026-10-08): replace the PGlite + pgvector index store with SQLite, and move the
embedding model out of pi sessions into a single shared local process, so that exactly one
embedder identity ever produces the vectors this machine retrieves against.

Measured evidence and the constraints this inherits: `docs/wiki/wiki/architecture/vector-store-swap-constraints.md`.
The problem this removes: `docs/wiki/wiki/architecture/gotcha-vector-store-single-owner.md`.

## Why both parts

- **Store.** PGlite 0.5.8 is single-user and locks nothing (lock PR upstream is still open), so two
  pi sessions opening `~/.pi/agent/jev-wiki/vector` can corrupt it — that is the class of failure
  behind the 2026-10-02 checkpoint PANIC and the current `Aborted()` store. SQLite has real
  multi-process locking, so the store stops needing a single owner and a reset becomes a file delete.
- **Embedder.** Retrieval only works when the query vectors and the stored vectors come from the same
  embedder identity. Today nothing enforces that: the store matches rows on `model` name + `dim`, so
  changing `dtype`, pooling, dimensions or a prompt template silently mixes incomparable vectors. One
  process that owns the model, plus a fingerprint recorded per row, makes parity structural. The
  measured side effect is that sessions drop from ~800 MB RSS to ~70 MB (the model is loaded once,
  not once per session).

## Architecture

```
pi session ─┬─ SQLite (per-operation connections) ── ~/.pi/agent/jev-wiki/vector/index.sqlite
            └─ NDJSON over a local pipe ─────────── embedder process (model, one at a time)
```

Each resource gets the mechanism it actually needs: SQLite for concurrent access, process isolation
for the single shared model. The embedder process **does not touch the store** — it is stateless
weights, so killing it can never damage the index, and sessions never need it to read or write rows.

### Parity invariant

```
fingerprint = `${preset.id}@v${preset.version}:${dtype}:${dimensions}`
```

- `preset.version` is an explicit integer per preset in `src/vector/embed.ts`, bumped whenever a
  prompt template, pooling mode, or model repo changes. Never hash the template functions.
- Every stored chunk row carries the fingerprint; `knn` filters on it; `wiki_index status` shows the
  store's fingerprint and the live embedder's, and says "rebuild required" when they differ.
- A query against rows with a different fingerprint returns nothing **and says why** — never a
  silent lexical fallback.
- The embedder serves exactly one fingerprint, taken from the user-level config. A project config
  naming a different preset cannot be honoured: index that project's wiki is skipped with a warning
  naming both presets. (`wiki_index action=model` already writes the user config; this makes the
  existing "one preset for every project" intent enforceable.)

## Store spec (`src/vector/db.ts` → `SqliteVectorDb`)

- File: `~/.pi/agent/jev-wiki/vector/index.sqlite` (keep the directory as the reset target).
- Schema: `chunks(wiki, path, key, kind, claim_id, status, title, text, hash, model, fingerprint,
  dim, embedding BLOB, updated_at, PRIMARY KEY (wiki, path, key))`, index on `(wiki, fingerprint)`;
  `index_state(wiki PK, model, fingerprint, dim, chunks, updated_at)`.
- Embeddings: `Float32Array` stored normalized, as a BLOB (4 bytes per dimension).
- Pragmas on every open: `busy_timeout=5000` **first, in its own statement**, then
  `journal_mode=WAL`, `synchronous=NORMAL`.
- Connections are opened per operation and closed immediately — that is what keeps the file
  deletable while sessions run (Windows `EBUSY` otherwise).
- Every open runs `CREATE TABLE IF NOT EXISTS`, so a store deleted underneath a session reads as
  "not indexed yet", not as an error.
- Refuse (warn, fall back to lexical) when the store path is a UNC/network path: WAL is unsafe there.
- KNN stays an exact cosine scan in JS (9.2 ms/query at 1,385×1024 today; no ANN index exists now).
- Unchanged: the `VectorDb` interface and its callers.

## Embedder process spec

- Entry: `src/vector/embedder/server.ts`, spawned with `process.execPath` and argv
  `[--experimental-strip-types if node < 22.18] server.ts <pipePath> <agentDir> <preset> <dtype> <dimensions>`.
  Verified: type stripping runs this file graph under plain `node` on 22.23.2; the daemon's import
  graph must stay erasable (no enums, no parameter properties) — a spawn test guards that.
- Transport: one local pipe. Windows `\\.\pipe\pi-jev-wiki-embed-<sha1(agentDir).slice(0,12)>`;
  POSIX `<tmpdir>/pi-jev-wiki-embed-<hash>.sock` (mode 0600). The path is derivable on both sides,
  so there is no metadata file and no stale-port problem. Verified on Windows: named pipe listens,
  connects, and round-trips a 200 KB request.
- Protocol v1, newline-delimited JSON, one reply per request id:
  - `{op:"hello", protocol:1}` → `{protocol, fingerprint, model, dims, pid, startedAt, modelLoaded}`
  - `{op:"embed", kind:"query"|"document", inputs:[{title,text}]}` → `{vectors:[base64], dims}`
  - `{op:"status"}` → queue depths, `modelLoaded`, last error
  - `{op:"shutdown"}` → clean exit
- Client side: on mismatch of `protocol` or `fingerprint`, send `shutdown`, wait, respawn.
- Queueing: one ONNX session, single flight. Two queues — interactive (queries) drained before
  batch (document chunks) — so a rebuild cannot make a prompt-time retrieval miss its 2.5 s budget.
  Client submits document work in batches (~32).
- Lifecycle: spawned detached by the first client, survives the spawning session (verified), exits
  after `search.vector.embedder.idleExitMs` (default 30 min) with no connected clients.
  `wiki_index action=stop` shuts it down; `action=restart` evicts and respawns.
- Logging: stdio to `<agentDir>/jev-wiki/embedder.log` (append, rotate at 1 MB) with start, stop,
  fingerprint, and crash lines — the evidence the current design never produced.
- Failure handling: respawn is attempted at most twice per session per operation, then semantic
  search is reported unavailable (loud) and lexical search continues.

## Sessions

- `SharedEmbedder implements EmbeddingService` replaces `providerFor`/`warmEmbeddingProvider`'s model
  load. Session start only pings the daemon (starting it if absent); no model is loaded in-process.
- No `inline` mode: a second embedder in a session is exactly the thing being removed. Tests inject
  their provider directly (the existing `IndexOptions.provider` seam), and the daemon's server module
  exports `startEmbedderService({ pipePath, provider })` so suites can host it in-process, offline.
- Loud degradation: `wiki_index status` (store path, availability + reason, fingerprint match, daemon
  pid/uptime/queue, store chunk counts), `wiki_ask` (reason when the vector half is unavailable),
  `wiki_finalize` (index refresh skipped + why).

## Config

```jsonc
"search": { "vector": {
  "enabled": true, "model": "quality",
  "embedder": { "idleExitMs": 1800000, "logMaxBytes": 1048576 },
  // retired: db ("embedded"), url (both never read)
}}
```

## Order of work

1. **Store swap** (`SqliteVectorDb`, fingerprint column, per-operation connections, reset action,
   missing-store/UNC handling). PGlite stays until the equivalence test passes.
2. **Fingerprint plumbing** into `index.ts`, `query.ts`, `wiki_index status`.
3. **Delete PGlite**: equivalence + two-process tests green, then remove the deps and re-embed the 9
   registered wikis (~30 min unattended). Semantic search is restored here — after this step the
   broken store no longer exists.
4. **Embedder process**: server, client, protocol, queues, idle exit, logging, spawn under test.
5. **Switch sessions** to the shared embedder; delete the per-session model load and warm path.
6. **Loud degradation** in the three surfaces above.
7. **Docs**: README, CHANGELOG, `engines` ≥ 22.13, wiki pages (the two PGlite gotchas become
   historical), `docs/plans/README.md`, PLAN.md/CRITIQUE.md amendments.

## Tests

- Store: existing vector suite against SQLite; cross-backend equivalence on a fixture (identical
  top-K ordering) before PGlite is deleted.
- Concurrency: two writers + one reader, many short-lived connections, zero errors and
  `integrity_check ok` (already proven in a scratch benchmark).
- Daemon: spawn → hello → embed → shutdown; stale-daemon eviction on fingerprint mismatch; idle exit;
  query jumps ahead of a queued rebuild batch.
- Parity: rows with an old fingerprint are not returned, and the reason is reported.
- Reset: delete the store while a session is idle → next operation reads as "not indexed yet",
  then a rebuild succeeds.
- Spawn safety: the daemon's import graph is erasable (guards the type-stripping assumption).

## Acceptance criteria

1. Two concurrent pi sessions: one embedder process, no model in either session (RSS ~70 MB each),
   no corruption, no lock errors.
2. `rm ~/.pi/agent/jev-wiki/vector/index.sqlite*` while pi runs is safe and its next use reads as
   "not indexed yet".
3. Stopping the daemon mid-session does not break a session: the next query restarts it or reports
   the reason.
4. Every "no vector results" path states a reason.
5. Cross-backend equivalence test passes before PGlite is deleted.

## Risks

- Type stripping is experimental (Node 22.18+); the spawn test fails loudly if the graph stops being
  erasable. Fallback if it ever bites: ship the daemon entry as plain `.mjs`.
- The daemon is a new background process on the machine: documented, stoppable, idle-exiting, logged.
- First daemon start may download the model (existing behaviour, still never triggered by a query).
- A project-level preset that differs from the global one is now refused rather than honoured.
