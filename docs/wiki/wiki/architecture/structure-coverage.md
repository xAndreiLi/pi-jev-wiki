---
title: Structure coverage check
type: architecture/layer
topic: architecture
summary: "How the structure scanner decides whether a module is documented in the wiki, using both name matching and file references to avoid false undocumented reports."
tags: [structure, coverage, wiki, documentation]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1813.md]
claims:
  - id: sc1
    text: "The structure coverage check counts a module as documented when an architecture page references files under it, because name matching alone produced false undocumented reports."
    status: verified
    support: 0.89
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1813.md, src/structure.ts]
    corroborations: 2
    last_confirmed: 2026-09-19
    last_checked: 2026-09-19
files: [src/structure.ts]
---



# Structure coverage check

During a `wiki_structure` scan, the tool lists modules that lack an architecture page. A module is considered **documented** when either:

1. **Name matching** — an architecture page title, summary, or path includes the module name.
2. **File references** — an architecture page lists `files` in its frontmatter that reside under the module directory (`${module.dir}/...`).

The second check exists because name matching alone produced false undocumented reports. Adding explicit `files` references to architecture pages resolves these false negatives.

## Key files

- `src/structure.ts` — `scanStructure()` computes `documentedText` (name matching) and `documentedFiles` (file references), then combines them with `||`.

## Change impact

- Adding or removing `files` entries from architecture pages can change which modules appear as undocumented.
- Renaming a module without updating its architecture page may still be caught by file-reference matching if the paths remain valid.

## See also

- [pi extension module](./module-pi-extension.md)
