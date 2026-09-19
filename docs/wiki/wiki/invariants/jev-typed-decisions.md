---
title: Jev returns typed decisions, never text
type: invariant
topic: invariants
summary: The Jev decision model must return typed decisions (noul, choice, score) rather than free-form text.
tags: [jev, types, api]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "A separate Jev client speaks to TypeSafe's System One API; Jev returns typed decisions (noul, choice, score), never text."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Jev returns typed decisions, never text

**Statement.** The Jev client must return typed decisions (`noul`, `choice`, `score`) and must never emit free-form text responses.

**Why it exists.** Prevents prompt-injection-style manipulation of wiki placement and keeps adjudication deterministic and auditable.

**Where it is enforced.** In the Jev client integration layer and via the System One API contract.

**What breaks if violated.** Agent workflows could receive ambiguous placement guidance, undermining the wiki's reliability. Scores would become unparseable.

**How to verify.** Inspect Jev client responses; confirm they conform to the typed decision schema.

## Related

- [pi extension module](../architecture/module-pi-extension.md)
