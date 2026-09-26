# Wiki TOC

> 37 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 10 | [toc/architecture.md](toc/architecture.md) |
| decisions | 13 | [toc/decisions.md](toc/decisions.md) |
| invariants | 11 | [toc/invariants.md](toc/invariants.md) |
| pi | 3 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Adjudication policy computed in code](architecture/adjudication-policy.md) — Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free. (2026-09-26)
- [Capture can file the agent's proposals as the user's words](architecture/gotcha-capture-proposals.md) — Historical: session extraction could label an assistant recommendation as `user:` evidence with no code check that the words came from a user turn, and Jev then scored trustTier user_stated; 0.8.0 closes the pathway by validating user evidence against actual user turns. (2026-09-26)
- [Capture evidence resolves from the session cwd](architecture/gotcha-capture-evidence-resolution.md) — Insight evidence refs are read relative to the capture session's working directory — files via resolve(cwd, ref), commits via git show in cwd — so a capture session outside the project reads no evidence and Jev grounds verifiable file/commit claims at 0.03–0.05 instead of ~0.9. (2026-09-26)
- [Capture flow](architecture/flow-capture.md) — At the end of work, the agent composes an insight list with evidence pointers; Jev filters and places each insight, and the agent writes the resulting updates. Capture runs on a configurable cadence (manual, task, or commit), with onCompact as an independent trigger. (2026-09-26)
- [Claim schema drift between the skill and code](architecture/gotcha-skill-schema-drift.md) — Historical: the llm-wiki skill was the only documentation of the page-claim schema and its status list had drifted from the code; SKILL.md now documents needs_recheck, reviewed, last_checked, needs_review, the YAML subset, and the rule to update it alongside the code. (2026-09-26)
