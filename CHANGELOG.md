# Changelog

## 1.0.4 — 2026-10-09

### Added

- Repository infrastructure for a second contributor: `main` now takes changes through a pull
  request with the `test` check green and refuses force-pushes and deletions, while admins bypass
  the pull-request rule so release commits still work. `.gitattributes` pins every checkout to LF,
  so a contributor on Windows, macOS or Linux sees the same bytes as CI.

### Changed

- The README names the published package as the supported install — `pi install npm:pi-jev-wiki` —
  and no longer offers a repository clone as an equal option, because a clone is a development tree;
  agents are told the same where they read it. The update note now describes 1.x: pi's npm store
  pins `^1.0.0`, so `pi update --extension npm:pi-jev-wiki@latest` reaches later minors and patches.
- The README gains a Contributing section and a Status section that names the current release; it
  had been advertising 0.8.1 as the published version since that release.

## 1.0.3 — 2026-10-09

### Added

- CI enforces the suites that used to be manual. `ci.yml` now runs the integration, vector and
  installed-copy tests on every push and pull request (it previously ran typecheck, unit and scale
  only), and `publish.yml` runs the installed-copy test before publishing, so a tag cannot ship an
  artifact that fails to run where it lands. The embedding model is cached between runs.

### Fixed

- Every page link in a per-topic table (`toc/<topic>.md`) was broken: the table reused the
  wiki-root-relative paths written into `index.md`, so from inside `toc/` a link to
  `decisions/x.md` pointed at `toc/decisions/x.md`. Shard links now carry the `../` prefix and
  resolve. `wiki_toc topic=<t>` used to return the shard verbatim; it now renders the same table
  with wiki-root paths, so tool output is unchanged. Existing shards are rewritten by the next
  TOC update (`wiki_finalize`, `wiki_remove`, or `npm run toc:refresh` from a checkout).

- A daemon that failed to start left no trace: the client spawns it through the `daemon.mjs` shim
  with stdio ignored, and the shim reported a startup failure only on stderr (the log-file fallback
  lives in `server.ts`'s own entry guard, which the shim bypasses). The tools then said "See
  embedder.log" about a file that did not exist. The shim now appends the same `failed to start:`
  line to the log.

- A daemon that died without shutting down (SIGKILL, OOM, a crash) left its Unix socket file behind,
  and every later start failed with `EADDRINUSE` until someone deleted it by hand, so semantic
  search stayed unavailable. On `EADDRINUSE` the daemon now probes the socket: if the connection is
  refused, it replaces the stale file and listens. A socket that still answers is left alone, so a
  live daemon keeps its pipe. Windows named pipes leave no file and are unchanged.

- `wiki_index action=rebuild` could not download the model if anything in the same session had
  touched the embedder first, for example `wiki_index action=status`. Shared clients were cached per
  embedder identity only, so the rebuild got the earlier client, which spawns its daemon with
  downloads disabled. On a machine without the model, that daemon failed and the rebuild reported
  that the embedder did not start. Download permission is now part of the client key; both clients
  attach to the same daemon.

## 1.0.2 — 2026-10-08

### Fixed

- `wiki_index action=stop` reported "No shared embedder was running" from any session that had not
  searched or indexed yet: `stopEmbedder` sent its shutdown request through a socket it had never
  opened, so the one session state where stopping the daemon matters most was the one where it could
  not. It now attaches first — without spawning a daemon — and reports nothing only when nothing is
  listening.

## 1.0.1 — 2026-10-08

### Fixed

- **The shared embedder could not start from an installed copy.** Node refuses to strip TypeScript
  for files under `node_modules`, so spawning `.../src/vector/embedder/server.ts` failed with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`: on any npm install of 1.0.0 the daemon never came up
  and semantic search was unavailable, while a checkout worked fine (which is why the suite never saw
  it). The daemon now starts through `src/vector/embedder/daemon.mjs`, a plain-JavaScript shim that
  loads the TypeScript daemon with jiti — the loader pi itself uses — so the spawn works from any
  location. `jiti` moved from `devDependencies` to `dependencies`.
- `npm run test:install` is the gate for this class of defect: it packs the package, installs the
  tarball into a throwaway project, indexes a two-page wiki with *that* copy, and requires a
  semantic hit. Run it before a release; `npm run test:all` runs from the checkout and cannot see an
  installed-package failure.

## 1.0.0 — 2026-10-08

First stable release. The index is no longer embedded Postgres: it is SQLite, and the embedding model
lives in one shared local process.

### Breaking

- `engines.node` is now `>=22.13` (the built-in `node:sqlite` module must be available without a flag).
- The optional dependencies `@electric-sql/pglite` and `@electric-sql/pglite-pgvector` are gone, along
  with the never-read `search.vector.db` and `search.vector.url` config fields. An existing index
  built with PGlite is not migrated: run `wiki_index action=reset` (or delete
  `<agent dir>/jev-wiki/vector`) and `wiki_index action=rebuild all=true`.
- A project-level preset that differs from the global one is refused with a warning naming both,
  instead of being indexed under a second embedder identity.
- `wiki_index status` no longer reports a `database:` line; it reports the store path, the embedder
  identity and the live embedder process.

### Changed

- **The index store is SQLite now** (built-in `node:sqlite`), replacing embedded Postgres with
  pgvector. Every operation opens and closes its own connection, so several pi sessions share one
  store safely, a corrupt or unwanted index is removed with `wiki_index action=reset` while pi is
  running, and a store that disappears mid-session reads as "not indexed yet" instead of failing.
  Vectors are normalized BLOBs and KNN is an exact cosine scan — 9 ms per query at 1,385×1024
  against 12.6 ms for pgvector, 0.8 ms to open instead of 1,683 ms of WASM boot, and a 7.8 MB file
  instead of a 67 MB data directory. `engines.node` is now `>=22.13`.
- **Every chunk row carries an embedder fingerprint** (`preset@version:dtype:dimensions`) and queries
  filter on it, so changing dtype, dimensions, pooling or a prompt template forces a rebuild instead
  of silently comparing vectors produced by two different embedders. `wiki_index status` reports the
  stored identity against the live embedder's and names the wikis that need a rebuild; `wiki_ask`
  states why when no vectors can be compared. Presets gained a `version` that must be bumped with
  their templates.
- **The embedding model lives in one shared local process.** Sessions no longer load it (measured
  ~800 MB RSS per session before, ~70 MB after); it starts on demand over a local pipe, survives the
  session that started it, exits after `search.vector.embedder.idleExitMs` (default 30 minutes) with
  no clients, and logs to `<agent dir>/jev-wiki/embedder.log`. There is deliberately no inline mode —
  a second embedder is exactly what parity cannot survive — and when it cannot start, semantic
  search reports the reason and keyword search continues.
- Indexing, querying and status all read the embedder identity from one shared mapping, so the index
  and the query path can no longer disagree about dtype or dimensions (the indexer used to ignore
  `search.vector.dtype` entirely).

### Added

- `wiki_index` actions `reset` (delete the store), `stop` and `restart` (the shared embedder), and
  `search.vector.embedder` (`idleExitMs`, `logMaxBytes`).
- `wiki_index action=rebuild all=true` re-embeds every registered wiki — the migration and recovery
  path. From a checkout, `npm run rebuild [wiki...]` does the same and prints per-wiki progress.
- Tests: the store's ranking against an independent cosine scan, byte-exact vector round-trip,
  identity isolation, a reset under a live handle, and two processes writing one store at once.

### Removed

- `@electric-sql/pglite` and `@electric-sql/pglite-pgvector`, and the never-read
  `search.vector.db` / `search.vector.url` config fields.

### Added

- Automatic prompt-time retrieval (`hooks.autoRetrieve`, `mode: "inject"` by default). On every
  prompt the session wiki is searched, Jev judges the candidates, and a short `<auto-retrieval>`
  brief is injected with the prompt — after the user message, before the first provider request —
  when the evidence is sufficient. Fail-closed: no verdict, low sufficiency, or `budgetMs` expiry
  injects nothing. Session wiki only (other wikis stay a manual `wiki_ask`); the embedding model is
  warmed at `session_start` but never downloaded by a prompt; logged as `op: "auto"`, deliberately
  not `ask`. Design and measurement: `docs/plans/AUTO-RETRIEVAL.md`.

## 0.8.1 — 2026-09-26

### Fixed

- Auto-capture no longer starts a model turn of its own. The settle hook writes the brief and
  `pending-capture.md` and delivers the brief when the next turn begins, instead of forcing a
  follow-up turn that repeated wiki maintenance and a second answer after every finished response.
  `capture.triggerTurn: true` restores the forced-turn behaviour. The compact-capture path already
  delivered this way.
- `wiki_review` resolutions verify the page after the serializer round-trip: the affected claim's
  status is re-read and a warning is returned when it did not survive (`accept`, `reject`,
  `supersede`). Frontmatter is re-serialized on every write, so drift is now detected instead of
  assumed away.

### Docs

- `skills/llm-wiki/SKILL.md`: **Finalize before the final response** — complete every wiki write and
  `wiki_finalize` before the task-ending response, keep the decisions section last, and dispose of
  any pending capture at the start of a turn; notes the advisory capture delivery.
- `README.md`: capture delivery is advisory by default; `capture.triggerTurn` documented.

## 0.8.0 — 2026-09-26

### Added

- Cross-wiki writes: `wiki_ingest`, `wiki_insights`, `wiki_finalize`, `wiki_sync`, `wiki_review`,
  `wiki_remove`, and `wiki_lint` accept `wiki: "<registered name>"` and operate on that wiki's
  pages, raw sources, TOC/log, ledger, and review queue — one wiki per call, session wiki by
  default. Cross-wiki page paths and ingest sources resolve against the target project (never the
  session workspace), and `wiki_sync wiki=<name>` diffs the target project's repository.
- Subject-aware auto-capture routing: `capture.route` (default `subject`) files a capture into the
  registered wiki that owns the files the session edited, when exactly one does; otherwise the
  capture stays on the session wiki and the brief carries a visible warning naming the wiki the
  evidence points at. `capture.route: "session"` restores working-directory routing. Each decision
  lands in the ledger as `capture.route` (`routed` / `warned` / `session`).
- `wiki_review` `limit` (default 50, max 200) with a "showing N of M" header, and the
  `out_of_scope` disposition plus `target` for correct claims that belong to another wiki.
- `wiki_ingest` cost preflight (source size ≈ input tokens, up to 2 Jev calls per claim) and a
  `compact` brief; `reject_unsupported` claims carry the closest matching passage with an overlap
  score, and briefs with 3+ rejections point at `wiki_triage`.
- `wiki_doctor` re-hashes indexed raw sources against `.jev-wiki/raw-index.json` and reports stale
  `*.tmp-*` files left by interrupted atomic writes.
- An offline integration test (`scripts/integration-test.ts`, part of `test:all`) drives the real
  tool handlers through the extension with a sandboxed `PI_CODING_AGENT_DIR` registry, asserting
  that cross-wiki finalize/remove/review calls affect only the target wiki and cannot fall back to
  the session workspace.

### Changed

- Ingest hashing and storage normalize `\r\n`/`\r` to `\n`, so Windows line endings no longer
  break dedup or raw-index matching.
- Ingest evidence now sends the excerpt around the claim's terms instead of the first 6 KB of the
  source, improving groundedness for claims synthesized from headings and lists.
- Raw sources are append-only: a same-day/same-title (or same-minute session) capture gets a
  content-hash suffix instead of overwriting the earlier file, and session capture filenames
  include seconds.
- A `user`-kind evidence item that does not appear in a user turn is rendered to Jev as
  `agent-stated (unverified)`, so the agent's own recommendation can no longer win the
  `user_stated` trust tier (see `docs/wiki/wiki/architecture/gotcha-capture-proposals.md`).
- Contradiction checks skip near-identical claim pairs (two revisions of one source) before
  spending a Jev call.
- `wiki_doctor` no longer fails the env-file check when the key file lives outside the repository.
- Capture evidence validation uses the transcript of the entries the capture actually read (compact
  captures summarize a subset), and edited-file tracking is capped per session.

### Docs

- `skills/llm-wiki/SKILL.md`: cross-wiki writes, `capture.route`, `out_of_scope`, the cost/compact
  brief, and frontmatter re-serialization on write (`support: "0.90"` → `support: 0.90`;
  re-read a page after any tool write before editing it).
- `README.md`: write- and capture-side cross-wiki story; tool table refreshed.
- `SKILL.md` + README: **use Jev liberally** — Jev tokens are cheap relative to model context, so
  prefer an extra Jev call (placement, relevance, contradiction, sync, triage) over a guess.

## 0.7.1 — 2026-09-26

### Fixed

- Removing the last page of a topic no longer leaves a stale agent-facing TOC shard: `writeIndex`
  prunes `toc/<topic>.md` files whose topic has no entries left. Previously `wiki_remove` (or any
  deletion/move) left that shard listing a deleted page while `index.md` and `toc.md` were already
  correct. Covered by the unit test "prunes topic shards whose last page was removed".
- Embedding-model load progress no longer floods the terminal. `indexWiki` takes an `onProgress`
  sink; the extension renders it as one throttled footer status entry (`ctx.ui.setStatus`, 250 ms,
  cleared after indexing), and non-interactive modes print a single stable line. The local model
  emits progress callbacks while loading **from cache** too (~180 events in ~1.3 s for the `quality`
  preset), so printing each event produced a wall of lines on every reindex.

## 0.7.0 — 2026-09-26

### Added

- Configurable capture cadence: `capture.cadence` = `manual` (default; explicit capture only) |
  `task` (after each settled task, debounced) | `commit` (after a new git commit is observed,
  however it was made). `capture.onCompact` stays an independent trigger and the legacy
  `capture.onSettle: true` still enables task capture.

## 0.6.0 — 2026-09-26

### Added

- Cross-wiki catalog: `wiki_toc scope=all` lists every registered wiki with page/topic counts, chunk
  counts, index model, last-indexed time, and staleness flags (`toc-stale`, `index-stale`,
  `root-missing`, `never-indexed`, `model-mismatch`, `disabled`); `wiki_toc wiki=<name>` reads one
  wiki's entries. Paged (`limit`/`offset`) and failure-isolated (concurrency 4, 750 ms per wiki).
- Per-wiki TOC manifests (`.jev-wiki/toc.json`), written by the same single writer as `index.md`,
  carrying page/topic counts and an entries hash so drift is detectable; staleness is computed from
  the current newest page mtime, never guessed.
- Jev retrieval judgments in `wiki_ask`: one batched call returns a relevance score per candidate
  (rerank) plus an evidence-sufficiency verdict. `search.jev.rerank` = `auto` (hybrid only) |
  `always` | `never`; `search.jev.sufficiency` adds a calibrated "may not cover this yet" note below
  `minSufficiency`. Verdicts land in the ledger (`ask.judge`) for the retrieval benchmark.
- `npm run toc:refresh`: refreshes every registered wiki's TOC and derived manifest — the migration
  path for wikis last written before manifests existed (rewrites `index.md`/`toc/`/`toc.json` only;
  no content changes).

### Fixed

- Lexical (index/BM25) results now carry their wiki name, so hybrid answers always show provenance
  (`[home]`, `[pi-jev-wiki]`, …); global-vault hits are stamped `global-vault` internally while host
  results still render as `[global vault]`.
- Fusion is granularity-aware: a page-level lexical hit and a claim-level vector hit for the same page
  merge into one entry (the anchored one wins), while distinct claims on one page stay separate —
  removing the duplicate page/claim listings seen in cross-wiki queries.
- Empty search results now name any scoped wiki that has no indexed content yet and point at
  `wiki_index action=rebuild`, instead of reporting a generic "no pages match".
- Generated `toc.md` files are excluded from the index alongside `index.md`/`log.md`/`toc/`, so
  table-of-contents boilerplate no longer competes with real claims in retrieval.
- Discovery resolves page counts with the configured `stateRoot` instead of a hardcoded one.

## 0.5.0 — 2026-09-26

### Added

- Cross-wiki semantic search: a local PGlite + pgvector index over claim- and section-level chunks,
  with `performance` (EmbeddingGemma-300M, 768d) and `quality` (Qwen3-Embedding-0.6B, 1024d)
  presets, MRL truncation, and per-model prompt templates.
- `wiki_index` tool: `status`, `model`, `discover`, `rebuild` (single wiki or `all`), `add`,
  `remove`, `enable`, `disable`; `wiki_finalize` refreshes touched pages incrementally by content
  hash.
- Wiki discovery: scans the home directory and WSL distros, reconciles the user-level registry
  (including registered-but-missing roots), and adopts found wikis with `register=true`.
- Embedding-model selection: `wiki_index action=model` reports the effective preset and its source
  and persists the choice to the user-level config; the first rebuild without a recorded choice
  stops and asks instead of downloading silently.
- Hybrid retrieval: reciprocal rank fusion of BM25 and vector ranks behind `wiki_ask`
  (`auto` / `keyword` / `semantic` / `hybrid`, `scope: local|all`, explicit wiki lists), tagging
  results with wiki name, claim id, kind, and status.
- Bulk review resolution (`wiki_review ids=[...]`) and user-stated auto-accept
  (`review.autoAcceptUserStated`), keeping wiki upkeep agent-owned.
- Agent overrides recorded in the decision ledger via `wiki_finalize`'s `overrides` parameter; lint
  treats recorded overrides as accepted backing.
- `npm run release -- <version|major|minor|patch>`: verifies a clean tree, runs the full suite,
  bumps, commits, and tags.

### Changed

- Jev verdicts are advisory: the brief presents "Suggested not to add" reminders, the agent has the
  final say, and overrides are allowed with a recorded reason. Sensitive/injection content and silent
  contradiction resolution remain hard boundaries.
- `search.engine` defaults to `auto`: hybrid when an index exists, keyword fallback otherwise.
- Page-section anchors render as heading slugs; raw filenames and page slugs truncate at word
  boundaries; auto-registered wiki names skip generic path segments.
- The publish workflow runs the full suite (`npm run test:all`, now including the vector tests) in a
  single step, and `prepublishOnly` matches it.

### Fixed

- Headless/print sessions no longer hang after completing: cached PGlite handles close on session
  shutdown.
- `wiki_index add`/`rebuild` resolve project roots to the real wiki root and self-heal stale
  registry roots.
- Queries never trigger a model download; a cold or mismatched index falls back to keyword search.
- A built-but-empty wiki counts as warm, so `wiki_finalize` stops reprinting build guidance.
- `wiki_doctor` validates the vector configuration and registry and reports model-cache size.

### Docs

- README repositioned around the package purpose — a vetted, searchable knowledge graph for agents
  — with clarified naming, corrected install commands, and an explicit unreleased-status list.
- `docs/notes/semantic-search.md` records the design, decisions, phases, and known limitations.

## 0.4.0 — 2026-09-20

### Added

- Page templates for the remaining page types: `layer.md`, `concept.md`, and `summary.md`
  (source summaries).
- Claim frontmatter skeletons in every template, covering `reviewed`, `last_checked`,
  `needs_review`, and `superseded_by`/`superseded_at`.

### Changed

- The `llm-wiki` skill was restructured and cut from 240 to 160 lines while adding coverage:
  accurate claim statuses and fields, the restricted frontmatter YAML subset, merge and post-write
  rules, a worked rejected-vs-durable example, and the lifecycle tools (`wiki_sync`, `wiki_lint`,
  `wiki_remove`, `wiki_structure`, `wiki_doctor`, `wiki_status`, `wiki_setup`).
- `module.md` no longer claims to cover flow and layer pages, which now have their own templates.

## 0.3.0 — 2026-09-20

### Added

- `wiki_triage`: rejected-claim triage. Lists recent rejections with Jev scores, whether the
  problem is evidence or policy, a concrete remedy per claim, and the accepted-vs-rejected
  derivability ranges so miscalibrated thresholds are visible.

### Changed

- The `llm-wiki` skill now teaches the judgment criteria comprehensively: every score, the decision
  gates in order, the framing exception, which evidence kinds pass, phrasing rules, a pre-submission
  checklist, and threshold calibration.
- High-importance architecture, invariant, and decision framing that Jev rates derivable is queued
  for confirmation instead of rejected (`thresholds.framingImportance`, default 0.6).
- Rejection guidance treats a correctly rejected claim as a working system rather than a failure;
  `wiki_insights` guidelines point at the criteria and at `wiki_triage`.

## 0.2.0 — 2026-09-19

First public release. A pi package that builds and maintains a project mental-model wiki,
with [Jev](https://typesafe.ai) (TypeSafe System One) as the calibrated decision layer.

Published to npm as `pi-jev-wiki@0.2.0` on 2026-09-20 via an interactive publish, so this version
has no provenance attestation; the next CI-published release will carry provenance.

### Intake

- Research ingest (`wiki_ingest`): immutable raw sources, claim extraction with verbatim quote
  validation, Jev adjudication, and a placement brief.
- Agent insight capture (`wiki_insights`): agent-authored insight lists with evidence pointers,
  Jev-filtered and placed; sessions stored as ordinary raw sources.
- `derivable_from_code` gate: implementation detail visible in the repository is rejected rather
  than duplicated in the wiki.
- Trust tiers: `verified_in_repo`, `source_document`, `user_stated`, `inference`, `speculation`.
- Automated capture on `agent_settled` and `session_before_compact`, with a Jev pre-screen,
  turn-count minimum, debounce, and in-process guard; pending-capture handoff when no follow-up
  turn can run. Recurrence promotion from the session log.

### Maintenance

- `wiki_sync`: file-linked claims re-verified against commits since the last baseline; verdicts
  `no_impact`, `needs_recheck`, `supersede`, `contradict`, with review queueing.
- Two-way invalidation at ingest (new supersedes old, old supersedes new, conflicts).
- Corroboration counting on reinforcement and explicit supersession records.
- `wiki_review`: agent-managed queue with criticality-gated user escalation.
- `wiki_lint`: TOC reconciliation, broken links, age-gated orphans, raw backlog, unbacked claims,
  Jev contradiction checks, and duplicate/consolidation candidates.
- `wiki_remove` for retiring obsolete pages.

### Writing

- Guided (default), draft, and auto writer modes; autonomy downgrades as claim criticality rises.
- Nested-LLM writer returns prose only; code assembles frontmatter from adjudication results.
- Writer grounding check flags auto-written numbers/URLs absent from evidence.

### Retrieval and scale

- `wiki_toc`: compact agent-facing TOC above 60 pages, per-topic tables, complete `index.md`.
- Search engines: `index`, in-process BM25 with cache invalidation, and a qmd CLI adapter.
- Paged-choice tournament for placement beyond 255 candidates.
- Verified at 1,000 pages: BM25 first search ~170 ms, deterministic lint ~2.6 s.

### Safety and operations

- Cross-process wiki lock with stale takeover; shared-state mutations are atomic across sessions.
- Best-effort secret/PII redaction before content is written or sent to a model.
- `wiki_doctor`: config, endpoint, key, `.env` gitignore, layout, lock, ledger, queue, sync, search.
- `wiki_setup`: key status/guide/write-env/test for TypeSafe and OpenRouter; never echoes the key.
- Decision ledger (`.jev-wiki/decisions.jsonl`) recording agent, Jev, and code decisions.
- Offline unit tests with a fake Jev client, plus smoke, paging, and scale test scripts.
