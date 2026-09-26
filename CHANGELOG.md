# Changelog

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
