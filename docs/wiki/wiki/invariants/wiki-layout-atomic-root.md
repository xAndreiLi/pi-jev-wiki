---
title: Wiki layout derives from a single root
type: invariant
topic: invariants
summary: "raw/ and wiki/ derive from wikiRoot, while runtime state is independently configurable via stateRoot, which may be absolute."
tags: [filesystem, layout, atomic, paths]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
claims:
  - id: c1
    text: "raw/ and wiki/ derive from wikiRoot, while runtime state is independently configurable via stateRoot, which may be absolute."
    status: verified
    support: 0.98
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
    last_checked: 2026-09-19
    reviewed: 2026-09-19
files: [src/wiki/layout.ts]
---



# Wiki layout derives from a single root

**Statement.** The `raw/` and `wiki/` directories always derive from `wikiRoot` via a single `resolveLayout` call. Runtime state (ledger, review queue, session log) is placed under `stateRoot`, which may be an absolute path or relative to `wikiRoot`.

**Why it exists.** This keeps content paths (raw sources and generated pages) coupled to `wikiRoot` for portability, while allowing runtime state to live independently—e.g., on a local filesystem outside version control or on a different mount point.

**Where it is enforced.** `src/wiki/layout.ts` — `resolveLayout(cwd, wikiRoot, stateRoot)` produces `root = resolve(cwd, wikiRoot)`, then `rawDir` and `wikiDir` are subpaths of `root`. `stateDir` is `stateRoot` when absolute, otherwise `join(root, stateRoot)`. All ledger and queue paths derive from `stateDir`.

**What breaks if violated.** If `rawDir` or `wikiDir` were computed independently of `wikiRoot`, renaming the wiki directory would orphan content. If `stateRoot` were forced inside `root` without an escape hatch, users could not keep volatile runtime state outside the project tree.

**How to verify.** Read `resolveLayout` and confirm:
1. `rawDir` and `wikiDir` are always `join(root, "raw")` and `join(root, "wiki")`.
2. `stateDir` uses `isAbsolute(stateRoot) ? stateRoot : join(root, stateRoot)`.
3. No hard-coded paths exist outside the returned layout.

## Related

- [Wiki root defaults to docs/wiki](../decisions/wiki-root-location.md)
