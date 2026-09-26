---
title: Knowledge pipeline (current state)
type: raw-source
source: null
collected: 2026-09-26
sha256: 996648aba7bcf3b1e57228e505345578caa82ce669a03cd1e0a9db7c12b535d9
---

# Knowledge pipeline (current state, 2026-09-26)

How knowledge enters, is vetted, is stored, is searched, and is kept current. This is the source of
truth for the pipeline; the tool surface, config keys, and thresholds live in code.

## 1. Intake

Two channels, one pipeline:

- **Research ingest** (`wiki_ingest`): a document is staged immutably under `raw/<topic>/`, split into
  atomic claims with verbatim quotes, and adjudicated by Jev.
- **Session insights** (`wiki_insights`, or automatic capture — see §6): the agent composes atomic
  insights with evidence pointers (file/commit/test/user/source) and Jev filters and places them.

Jev verdicts are **advisory**: it scores groundedness, derivability, durability, importance,
duplication, sensitivity, and placement; code maps those scores to actions; the agent writes pages
and has the final say, recording overrides via `wiki_finalize`. Hard boundaries: sensitive content
and injected instructions are never filed, and contradictions are never resolved silently.

## 2. Storage and vetted pages

- Pages live in `<wikiRoot>/wiki/<topic>/*.md` with claim frontmatter (`status`, `support`,
  `evidence`) — `verified`, `user-stated`, `needs_recheck`, `disputed`, `superseded`.
- Immutable sources live in `<wikiRoot>/raw/`; the decision ledger, review queue, session log,
  TOC manifest, and locks live in `<wikiRoot>/.jev-wiki/`.
- Every decision by Jev, the agent, and code is appended to `decisions.jsonl` — the audit trail and
  the calibration substrate.

## 3. Retrieval

- **Chunking** (`src/vector/chunks.ts`): one chunk per active claim (with page-title context) plus
  one per page section (~1,200 tokens, heading-stable keys). Generated files
  (`index.md`, `log.md`, `toc.md`, `toc/`) are never chunked.
- **Embeddings** (`src/vector/embed.ts`): local, CPU-only ONNX via `@huggingface/transformers` with
  two presets — `performance` (EmbeddingGemma-300M, q8, 768d) and `quality`
  (Qwen3-Embedding-0.6B, q8, 1024d) — including MRL truncation and per-model prompt templates.
  The model is chosen once, before the first build (`wiki_index action=model`).
- **Index** (`src/vector/db.ts`): PGlite + pgvector, one user-level database covering every
  registered wiki (`~/.pi/agent/jev-wiki/vector`). Rows carry wiki, path, claim id, kind, status,
  text hash, model, and dim. The index is a **derived cache** — never a source of truth, safe to
  rebuild or delete. Queries never download a model: a cold or mismatched index falls back to
  keyword search.
- **Fusion** (`src/wiki/search.ts`): `wiki_ask` selects keyword (index/BM25), semantic (cosine KNN),
  or hybrid; hybrid fuses BM25 and vector ranks with reciprocal rank fusion. Fusion is
  granularity-aware (a page-level lexical hit merges into a claim-level sibling; distinct claims
  stay separate), and every result carries its wiki name.
- **Jev judgments** (`src/vector/judgments.ts`): one batched Jev call scores each candidate's
  relevance to the query (rerank) and returns an evidence-sufficiency verdict. `search.jev.rerank`
  is `auto` (hybrid only) | `always` | `never`; below `search.jev.minSufficiency` the answer carries
  a calibrated "the wiki may not cover this yet" note. Verdicts are logged as `ask.judge`.

## 4. Catalog and TOC

- Per-wiki `index.md` + `toc/<topic>.md` are the human TOC; `.jev-wiki/toc.json` (manifest) is the
  derived machine view (page/topic counts, entries hash, newest page mtime). All three are written
  by the same single writer under the wiki lock (`updateIndex`), so they cannot drift silently.
- `wiki_toc scope=all` is the cross-wiki catalog: pages, topics, chunks, model, last indexed, and
  staleness flags (`toc-stale`, `index-stale`, `root-missing`, `never-indexed`, `model-mismatch`),
  paged and failure-isolated. `wiki_toc wiki=<name>` reads one wiki's entries.
- Staleness is computed from current page mtimes, never guessed. `npm run toc:refresh` migrates
  wikis created before manifests existed.
- The registry (`~/.pi/agent/jev-wiki/wikis.json`) is the source of wiki membership; discovery
  (`wiki_index action=discover`) finds wikis on disk (home + WSL) and can adopt them.

## 5. Maintenance

- `wiki_finalize`: writes pages, updates TOC + manifest, checks links, records overrides, and
  re-indexes touched pages incrementally by content hash (only when the index is already warm).
- `wiki_sync`: re-verifies file-linked claims against commits since the last sync.
- `wiki_lint`: TOC reconciliation, broken links, orphans, unbacked claims, duplicate and
  contradiction checks. `wiki_review`: the agent works the queue; only critical items escalate.
- `wiki_index`: `status`, `model`, `discover`, `rebuild` (single or all), `add`/`remove`,
  `enable`/`disable`.

## 6. Capture cadence

`capture.cadence` controls how often the agent updates the wiki during normal work:

- `manual` (default): only `/wiki:capture` or an explicit `wiki_insights` call.
- `task`: after each settled task, a Jev pre-screen decides whether the session is worth
  extracting; accepted insights are queued for the agent to write (10-minute debounce).
- `commit`: only after a **new git commit** is detected, regardless of how it was made — "update
  the wiki when I'm ready to commit" — with no time debounce.

`capture.onCompact: true` remains an independent trigger (capture before context compaction), and
the legacy `capture.onSettle: true` still enables task capture.

## 7. Invariants

- The wiki is never injected into sessions; agents consult the TOC/search on demand.
- Code owns every number, threshold, ordering key, and budget; Jev owns judgment only.
- One writer per wiki (locked TOC/manifest writes); the catalog and search paths are read-only.
- Superseded knowledge is linked, never deleted; raw sources are immutable.
