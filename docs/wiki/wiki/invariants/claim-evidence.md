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

## Incident claims

Reproduced command output is not one of the four admissible kinds, so an incident claim whose only
support is a captured trace needs the session raw as a `source` with the verbatim excerpt — the raw
is itself a raw source, and the trace is inside it. With command-kind evidence alone, the 2026-10-02
vector-store recovery claims scored grounded 0.48–0.64 and the adjudicator advised rejection; the
page was filed with a recorded override. Prefer `source` whenever the evidence is something that
happened rather than something that is written down.

## Related

- [Raw sources are immutable](../invariants/raw-immutable.md)
- [Scope boundary](../decisions/scope-boundary.md)
