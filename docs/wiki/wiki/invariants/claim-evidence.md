---
title: Load-bearing claims require verbatim evidence
type: invariant
topic: invariants
summary: Every load-bearing claim must point at verbatim evidence in a raw source or a file/commit/test.
tags: [claims, evidence, quality]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "Every load-bearing claim must point at verbatim evidence in a raw source or a file/commit/test."
    status: verified
    support: 0.99
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Load-bearing claims require verbatim evidence

**Statement.** Every claim in a wiki page that affects architecture, behavior, or policy must cite verbatim evidence from a raw source, file, commit, or test.

**Why it exists.** Without traceability, the wiki becomes folklore. Verbatim citations let future agents verify or dispute claims efficiently.

**Where it is enforced.** Page frontmatter schema (`claims[].evidence`); Jev grounding checks during ingest and insight capture.

**What breaks if violated.** Claims become unverifiable, leading to silent drift between wiki and codebase. Disputes cannot be resolved by evidence.

**How to verify.** Audit page frontmatter for non-empty `evidence` arrays; spot-check that quoted text exists in the cited raw source.

## Related

- [Raw sources are immutable](../invariants/raw-immutable.md)
- [Scope boundary](../decisions/scope-boundary.md)
