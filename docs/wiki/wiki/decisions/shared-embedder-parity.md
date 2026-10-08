---
title: One embedder process, one embedder identity
type: decision
topic: decisions
summary: "The embedding model leaves pi sessions for a single shared local process, and the embedder identity is recorded on every chunk row as a fingerprint (preset, preset version, dtype, dimensions) that queries filter on and that status reports against — so a dtype, dimension or prompt-template change forces a rebuild instead of leaving vectors that score plausibly but are not comparable."
tags: [decisions, embeddings, parity, index, retrieval]
updated: 2026-10-08
sources: [raw/sessions/2026-10-08-session-2026-10-08-070753.md]
files: [src/vector/embed.ts, src/vector/db.ts, src/vector/query.ts, docs/plans/INDEX-SERVICE.md]
claims:
  - id: c1
    text: "One shared local process owns the embedding model for the whole machine, started on first use and idle-exiting when unused, and sessions never load the model themselves — with no inline mode, because a second embedder is exactly what parity cannot survive."
    status: user-stated
    support: 0.9
    evidence: ["user: \"There should be a shared embedder now to always have parity as the embedder being the same globally is what is required for retrieval to work at all.\" (Andrei, 2026-10-08)", "file: docs/plans/INDEX-SERVICE.md — the embedder process is stateless (it never touches the store), serves exactly one fingerprint, and exits after its idle timeout"]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c2
    text: "The embedder identity is a fingerprint — preset id, preset version, dtype, dimensions — stored on every chunk row, filtered on by KNN, reported by wiki_index status, and checked in the daemon handshake, so a change to dtype, dimensions, pooling or a prompt template is detected as a mismatch instead of silently mixing incomparable vectors."
    status: user-stated
    support: 0.91
    evidence: ["user: parity is what makes retrieval work at all (Andrei, 2026-10-08)", "file: docs/plans/INDEX-SERVICE.md — `fingerprint = preset.id@v{preset.version}:{dtype}:{dimensions}`, version bumped by hand when a template, pooling mode or repo changes"]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
  - id: c3
    text: "Retrieval is only meaningful between vectors produced by one embedder identity: the store matches rows on preset name and dimensionality alone, so a change to dtype, pooling, dimensions or a prompt template would leave old vectors behind that score plausibly but are not comparable."
    status: verified
    support: 0.55
    evidence: ["file: src/vector/db.ts — the KNN filter is `model = $2 AND dim = $3`; dtype, pooling and the prompt templates appear nowhere in the schema", "file: src/vector/embed.ts — a preset pins repo, dtype, dimensions, pooling and the query/document templates, so any of them changes the vectors without changing the model name or dim"]
    reviewed: 2026-10-08
    last_checked: 2026-10-08
---

## Responsibility

Govern which embedder produces the vectors the index stores and retrieves, and how a mismatch between
the query embedder and the stored vectors is detected.

## Decision

- **One process embeds.** A shared, stateless local embedder owns the model, started on first use,
  idle-exiting after `search.vector.embedder.idleExitMs` (default 30 minutes) and stoppable with
  `wiki_index action=stop`. It never touches the store, so killing it cannot damage the index.
- **Sessions never embed.** The per-session model load and the session-start warm path are deleted.
  If the embedder cannot start, semantic search is reported unavailable **with the reason** and
  lexical search continues.
- **Identity is explicit.** `fingerprint = preset.id@v{preset.version}:{dtype}:{dimensions}` is
  written to every row, filtered on by KNN, compared by `wiki_index status`, and checked in the
  daemon handshake (mismatch → evict and respawn). A preset's `version` is bumped by hand whenever
  its templates, pooling mode or repo change.

## Why

Parity is a correctness condition, not a performance one: two vectors are only comparable if one
embedder produced both. Today nothing enforces it — rows are matched on preset name and dimensions,
so retyping `dtype`, changing `dimensions`, or editing a prompt template leaves a store that answers
with plausible-looking, incomparable vectors. One owner plus a recorded identity makes the failure
impossible to reach: a mismatch is a rebuild, not a silent degradation.

The measured side effect: the model is loaded once for the machine (~800 MB), not once per session
(~70 MB per session afterwards), and warm query embeddings cost ~39 ms.

## Consequences

- **Implemented 2026-10-08.** Sessions carry no model (measured ~800 MB → ~70 MB RSS), the daemon is
  reused across processes (a second session reconnected to the same pid), and the index store moved
  to SQLite in the same change. See the changelog and `docs/plans/INDEX-SERVICE.md`.
- A project-level preset that differs from the global one is refused with a warning naming both,
  instead of silently indexing that project under a second identity.
- Changing the fingerprint requires a rebuild; `wiki_index status` says so in those words.
- The machine gains one documented background process with a log (`<agent dir>/jev-wiki/embedder.log`),
  an idle exit, and an explicit stop action.
- Retrieval quality now has a single point of failure — the embedder — which is why every failure
  path in this design is loud rather than falling back quietly.
