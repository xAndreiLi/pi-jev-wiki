---
title: Wiki layout derives from a single root
type: invariant
topic: invariants
summary: All wiki paths derive from one resolveLayout call, so changing wikiRoot atomically relocates raw sources, pages, and runtime state.
tags: [filesystem, layout, atomic, paths]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
claims:
  - id: c1
    text: "All wiki paths derive from a single resolveLayout call, so changing wikiRoot atomically relocates raw sources, pages, and runtime state."
    status: verified
    support: 0.98
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
files: [src/wiki/layout.ts]
---

# Wiki layout derives from a single root

**Statement.** Every filesystem path used by the wiki—raw sources, generated pages, runtime state, and ledger—must derive from a single `resolveLayout` call rooted in `wikiRoot`.

**Why it exists.** This prevents path drift where some artifacts live outside the configured root and ensures that moving or renaming the wiki directory is a single-configuration change.

**Where it is enforced.** `src/wiki/layout.ts` — `resolveLayout(cwd, wikiRoot)` produces `root`, then `rawDir`, `wikiDir`, `stateDir`, `ledgerPath`, `reviewQueuePath`, and `sessionLogPath` are all subpaths of `root`.

**What breaks if violated.** Raw sources, pages, or state files could scatter across the filesystem; renaming `wikiRoot` would orphan data and break `wiki_sync`.

**How to verify.** Read `resolveLayout` and confirm no hard-coded paths exist outside the returned layout.

## Related

- [Wiki root defaults to docs/wiki](../decisions/wiki-root-location.md)
