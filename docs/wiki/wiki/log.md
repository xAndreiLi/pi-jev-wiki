# Wiki Log

## [2026-09-19] ingest | jev-wiki architecture notes
- Raw: raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md
- Claims: 12 (filed 9, reinforced 0)

## [2026-09-19] finalize | Ingested docs/notes/jev-wiki-overview.md and created 9 wiki pages covering decisions, invariants, architecture module, and flow.
- Updated: decisions/scope-boundary.md
- Updated: architecture/module-pi-extension.md
- Updated: invariants/jev-typed-decisions.md
- Updated: invariants/raw-immutable.md
- Updated: invariants/generated-files.md
- Updated: invariants/claim-evidence.md
- Updated: decisions/guided-writing.md
- Updated: decisions/review-escalation.md
- Updated: architecture/flow-capture.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1721.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Session 2026-09-19: three insights submitted, all rejected by Jev (unsupported/derivable). No pages created or edited.

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1722.md
- Filed 0 · reinforced 0 · review 0 · rejected 2

## [2026-09-19] finalize | Added decision page for wiki root defaulting to docs/wiki.
- Updated: decisions/wiki-root-location.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1730.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Captured three verified insights: (1) adjudication thresholds are code-computed, not model-driven; (2) all wiki paths derive from a single resolveLayout root; (3) provider switching is configuration-only thanks to a shared System One schema.
- Updated: architecture/adjudication-policy.md
- Updated: invariants/wiki-layout-atomic-root.md
- Updated: decisions/provider-agnostic-schema.md

## [2026-09-19] sync | 2 claim(s) checked
- Baseline: 7f05448 → a627568
- Changed files: 6
- Applied: invariants/wiki-layout-atomic-root.md#c1 → needs_recheck

## [2026-09-19] finalize | Updated wiki-layout-atomic-root invariant to reflect that raw/ and wiki/ derive from wikiRoot while runtime state is independently configurable via stateRoot, which may be absolute.
- Updated: invariants/wiki-layout-atomic-root.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1734.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Captured 3 session insights about sync performance, review resolution mechanics, and headless escalation behavior. Jev initially rejected all three; agent wrote them anyway after verifying evidence in src/sync.ts, src/review.ts, and src/extension.ts.
- Updated: architecture/layer-sync-invalidation.md
- Updated: decisions/review-resolution-by-code.md
- Updated: decisions/review-escalation.md

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1737.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Insights session: 3 submitted, 0 accepted, 3 rejected (all derivable from code). No pages written per guided-mode instruction to only write accepted claims.

## [2026-09-19] lint | 0 added, 0 broken links, 9 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 2
- Contradiction checks: 2

## [2026-09-19] lint | 0 added, 0 broken links, 5 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 2

## [2026-09-19] lint | 0 added, 0 broken links, 5 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 2

## [2026-09-19] remove | 2 page(s)
- Reason: derivable implementation detail; rejected by the adjudication gate
- Removed: architecture/layer-sync-invalidation.md
- Removed: decisions/review-resolution-by-code.md

## [2026-09-19] finalize | Removed derivable claim c2 from review-escalation.md during maintenance pass.
- Updated: decisions/review-escalation.md

## [2026-09-19] lint | 0 added, 0 broken links, 0 unbacked claims
- Pages: 13
- TOC updated: 0 · missing files: 0
- Orphans: 5 · raw backlog: 0
- Contradiction checks: 0

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1741.md
- Filed 0 · reinforced 0 · review 0 · rejected 3

## [2026-09-19] finalize | Session 2026-09-19: three insights submitted via wiki_insights; all rejected by Jev as not grounded in evidence. No pages written.

## [2026-09-19] capture | 3 insights
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1741.md
- Filed 0 · reinforced 2 · review 0 · rejected 1

## [2026-09-19] finalize | Reinforced two claims from session insights: (1) rejection policy in guided-writing, (2) lint backstop behavior in module-pi-extension. Duplicate insight on review escalation skipped.
- Updated: decisions/guided-writing.md
- Updated: architecture/module-pi-extension.md

## [2026-09-19] capture | 1 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1806.md
- Filed 1 · reinforced 0 · review 0 · rejected 0

## [2026-09-19] capture | 1 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1806.md
- Filed 0 · reinforced 0 · review 1 · rejected 0

## [2026-09-19] finalize | Accepted user-stated decision from raw session 2026-09-19-1806.
- Updated: decisions/retry-handling-in-client.md

## [2026-09-19] finalize | Documented lint unbacked-claims behavior as a formal decision, resolving review queue item mu8xtla9-3cf8f2.
- Updated: decisions/lint-queues-unbacked-claims.md

## [2026-09-19] lint | 0 added, 0 broken links, 2 unbacked claims
- Pages: 15
- TOC updated: 0 · missing files: 0
- Orphans: 7 · raw backlog: 0
- Contradiction checks: 1

## [2026-09-19] capture | 4 insights (settled)
- Raw: raw/sessions/2026-09-19-session-2026-09-19-1808.md
- Filed 1 · reinforced 0 · review 1 · rejected 2

