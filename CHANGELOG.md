# Changelog

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
