---
title: Generated files are never hand-edited
type: invariant
topic: invariants
summary: wiki/index.md and wiki/log.md are generated files and must never be hand-edited.
tags: [generated, toc, log]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "wiki/index.md and wiki/log.md are generated files and are never hand-edited."
    status: verified
    support: 0.99
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Generated files are never hand-edited

**Statement.** `docs/wiki/wiki/index.md` and `docs/wiki/wiki/log.md` must only be modified by `wiki_finalize`.

**Why it exists.** Prevents drift between the TOC/log and the actual page set. Hand edits would be overwritten and could introduce broken links.

**Where it is enforced.** `wiki_finalize` regenerates both files; agents must not write to them directly.

**What breaks if violated.** TOC becomes inconsistent with the filesystem; log entries may be lost or duplicated.

**How to verify.** Run `wiki_finalize` and confirm no diff other than expected updates; check file headers for "generated" warnings.

## Related

- [Raw sources are immutable](../invariants/raw-immutable.md)
