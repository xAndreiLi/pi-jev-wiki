# Wiki TOC

> 18 pages across 3 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 5 | [toc/architecture.md](toc/architecture.md) |
| decisions | 8 | [toc/decisions.md](toc/decisions.md) |
| invariants | 5 | [toc/invariants.md](toc/invariants.md) |

## Recently updated
- [Adjudication policy computed in code](architecture/adjudication-policy.md) — Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free. (2026-09-19)
- [Capture flow](architecture/flow-capture.md) — At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates. (2026-09-19)
- [pi extension module](architecture/module-pi-extension.md) — Owns staging, Jev adjudication, placement, and TOC/log bookkeeping for the project wiki. (2026-09-19)
- [Structure coverage check](architecture/structure-coverage.md) — How the structure scanner decides whether a module is documented in the wiki, using both name matching and file references to avoid false undocumented reports. (2026-09-19)
- [Agent-managed review with user escalation for critical items](decisions/review-escalation.md) — Review work is agent-managed. The user is only escalated for critical items such as security, breaking API changes, or data loss. (2026-09-19)
