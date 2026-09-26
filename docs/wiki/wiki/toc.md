# Wiki TOC

> 26 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 7 | [toc/architecture.md](toc/architecture.md) |
| decisions | 9 | [toc/decisions.md](toc/decisions.md) |
| invariants | 9 | [toc/invariants.md](toc/invariants.md) |
| pi | 1 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Adjudication policy computed in code](architecture/adjudication-policy.md) — Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free. (2026-09-26)
- [Capture flow](architecture/flow-capture.md) — At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates. Capture runs on a configurable cadence (manual, task, or commit), with onCompact as an independent trigger. (2026-09-26)
- [Table of contents hierarchy](architecture/table-of-contents.md) — The wiki maintains coordinated catalog artifacts: index.md is the complete machine catalog, toc.md plus toc/<topic>.md the compact agent-facing view, and .jev-wiki/toc.json the derived machine manifest — all written by one locked writer, with a cross-wiki catalog over the registry. (2026-09-26)
- [Agent-managed review with user escalation for critical items](decisions/review-escalation.md) — Review work is agent-managed. The user is only escalated for critical items such as security, breaking API changes, or data loss. (2026-09-26)
- [Decision ledger retention](decisions/decision-rejected-claims-stay-visible-in.md) — Rejected claims remain visible in the decision ledger to support future threshold tuning audit. (2026-09-26)
