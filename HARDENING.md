# Hardening roadmap

Prioritized hardening for jev-wiki, with current status. Reviewed after each build phase.
Legend: **done**, **next**, **later**.

## Data integrity

| # | Item | Status |
|---|------|--------|
| 1 | Writer grounding check: auto-written numbers/URLs/versions must appear in the evidence, else the page is marked `needs_review` and queued | **done** |
| 2 | Unbacked-claim detection (pages without accepted ledger entries) + review-accept writes an accepted entry | **done** |
| 3 | Two-way reconciliation: report accepted claims that were never written (pending captures) | next |
| 4 | `wiki_merge` for consolidation: detection and Jev judgment exist, but merging two pages with a supersession record does not | next |
| 5 | Raw immutability re-check: compare each raw file's `sha256` frontmatter against its content during lint | later |
| 6 | Frontmatter corruption path: unparsable pages are skipped silently; lint should report them | later |
| 7 | Ledger/queue rotation: unbounded JSONL; archive-and-summarize rather than delete | later |

## Security and privacy

| # | Item | Status |
|---|------|--------|
| 8 | Best-effort secret/PII redaction applied to raw sources, session records, Jev evidence, writer excerpts, and ledger-visible flows | **done** |
| 9 | `.env` gitignore check in doctor | **done** |
| 10 | Multi-process wiki lock with stale takeover | **done** |
| 11 | Path containment: finalize and remove refuse pages outside the wiki root | **done** |
| 12 | Injection policy: the `injection` verdict should force guided mode and never auto-write | next |
| 13 | Redact ledger `subject`/`reason` fields (claim text is currently stored unredacted) | next |
| 14 | Realpath checks before writes to block symlink escapes | later |

## Reliability

| # | Item | Status |
|---|------|------|
| 15 | Cross-process locking: `withFileMutationQueue` is in-process only; index, log, queue, and raw-index mutations are now lock-protected, and model/Jev calls never hold the lock | **done** |
| 16 | Provider failover: fall back to a secondary endpoint when TypeSafe stays down | next |
| 17 | Nested-call budget: cap extraction/writer calls and tokens per session | next |
| 18 | Explicit deadlines and retry/backoff on `modelRegistry.complete` | later |
| 19 | Interrupted auto-write recovery marker (lint repairs TOC drift, but only when run) | later |

## Scale

| # | Item | Status |
|---|------|------|
| 20 | Hierarchical TOC: `index.md` stays a complete machine catalog; `toc.md` is the compact agent-facing view with per-topic tables under `toc/`. At 1,000 pages the agent-facing TOC is ~1 KB | **done** |
| 21 | Bound the lint pair explosion (O(n²) candidate generation) with shared-file buckets and caps | next |
| 22 | Measured Jev lint wall-clock at 1,000 pages | later |
| 23 | Session-log and session-raw rotation; incremental BM25 updates beyond ~2k pages | later |

## Testing

| # | Item | Status |
|---|------|------|
| 24 | Offline unit tests with a fake Jev client covering policy, placement tournament, writer mode, locks, review application, redaction, literals, paths, and frontmatter | **done** |
| 25 | Failure-injection tests: 429/529, malformed responses, corrupted JSONL, missing pages | next |
| 26 | Decision-quality eval harness (A/B sessions with and without wiki consultation) | later |

## Operability

| # | Item | Status |
|---|------|------|
| 27 | `wiki_doctor`: config, endpoint, key, env gitignore, layout, lock, ledger, queue, git/sync, search availability | **done** |
| 28 | `wiki_calibrate`: automate the threshold-separation report from the ledger (accepted max 0.49 vs derivable min 0.50) | next |
| 29 | Queue drain policy: auto-defer low-criticality items after N days | next |
| 30 | Packaging: `pi install` smoke test, npm `files`, LICENSE, runbook | next |

## Hygiene

| # | Item | Status |
|---|------|--------|
| 31 | Split `extension.ts` (~1,600 lines) into `src/tools/*` | next |
| 32 | Config schema validation with warnings instead of silent deep-merge of typos | later (doctor covers the common cases) |
