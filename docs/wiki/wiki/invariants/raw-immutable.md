---
title: Raw sources are immutable
type: invariant
topic: invariants
summary: Raw sources under raw/ are immutable; the wiki only ever reads them.
tags: [raw, immutability, evidence]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "Raw sources under raw/ are immutable; the wiki only ever reads them."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Raw sources are immutable

**Statement.** Files placed under `docs/wiki/raw/` must never be edited after ingestion.

**Why it exists.** Guarantees that claims cited in wiki pages remain traceable to their original evidence. Mutable sources would invalidate historical citations.

**Where it is enforced.** Tool-level policy (`wiki_ingest` writes once); social convention during agent sessions.

**What breaks if violated.** Historical claims could lose their evidence base, making it impossible to verify or dispute them.

**How to verify.** Check that raw file modification timestamps never change after creation; audit raw/ for edits.

## Related

- [Load-bearing claims require evidence](../invariants/claim-evidence.md)
