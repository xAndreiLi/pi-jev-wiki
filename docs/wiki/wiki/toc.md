# Wiki TOC

> 31 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 9 | [toc/architecture.md](toc/architecture.md) |
| decisions | 9 | [toc/decisions.md](toc/decisions.md) |
| invariants | 11 | [toc/invariants.md](toc/invariants.md) |
| pi | 2 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Adjudication policy computed in code](architecture/adjudication-policy.md) — Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free. (2026-09-26)
- [Capture evidence resolves from the session cwd](architecture/gotcha-capture-evidence-resolution.md) — Insight evidence refs are read relative to the capture session's working directory — files via resolve(cwd, ref), commits via git show in cwd — so a capture session outside the project reads no evidence and Jev grounds verifiable file/commit claims at 0.03–0.05 instead of ~0.9. (2026-09-26)
- [Capture flow](architecture/flow-capture.md) — At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates. Capture runs on a configurable cadence (manual, task, or commit), with onCompact as an independent trigger. (2026-09-26)
- [Retrieval pipeline](architecture/flow-retrieval.md) — wiki_ask retrieves knowledge from a derived vector index: claim and section chunks, local embedding presets, hybrid BM25+vector rank fusion (RRF), and batched Jev rerank and sufficiency judgments, with keyword fallback when the index is cold. (2026-09-26)
- [Table of contents hierarchy](architecture/table-of-contents.md) — The wiki maintains coordinated catalog artifacts: index.md is the complete machine catalog, toc.md plus toc/<topic>.md the compact agent-facing view, and .jev-wiki/toc.json the derived machine manifest — all written by one locked writer, with a cross-wiki catalog over the registry. (2026-09-26)
