---
title: Raw sources are immutable
type: invariant
topic: invariants
summary: "Raw sources under raw/ are immutable: the wiki never edits or overwrites them, append-only naming keeps same-day collisions from clobbering a source, and ingest normalizes line endings before hashing so dedup stays stable."
tags: [raw, immutability, evidence, hashing]
updated: 2026-09-26
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md, raw/sessions/2026-09-26-session-2026-09-26-0025.md]
claims:
  - id: c1
    text: "Raw sources under raw/ are immutable; the wiki only ever reads them."
    status: verified
    support: 0.98
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
    last_checked: 2026-09-19
  - id: c2
    text: "Raw sources are append-only: a same-day/same-title ingest or same-minute session capture gets a content-hash suffix instead of overwriting the earlier file, and ingest normalizes CRLF/CR to LF before hashing and storing so Windows line endings cannot break dedup or raw-index matching."
    status: verified
    support: 0.92
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0025.md, "c5e5f62"]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/wiki/layout.ts, src/extension.ts]
---

# Raw sources are immutable

**Statement.** Files placed under `docs/wiki/raw/` must never be edited after ingestion, and a new source must never overwrite an existing one.

**Why it exists.** Guarantees that claims cited in wiki pages remain traceable to their original evidence. Mutable or clobbered sources would invalidate historical citations and the raw-index hash map.

**Where it is enforced.** `wiki_ingest` writes once; `writeRawSource` appends a short content hash when the target name already exists (same-day titles, same-minute session captures); ingest hashes and stores LF-normalized text, so line endings do not change a source's identity. `wiki_doctor` re-hashes every indexed source (`raw sources` check) and reports drift instead of repairing it silently. Social convention still applies during agent sessions.

**What breaks if violated.** Historical claims could lose their evidence base, making it impossible to verify or dispute them; dedup would stop matching re-ingested copies.

**How to verify.** Run `wiki_doctor` and confirm `raw sources` reports all hashes match; check that raw file modification timestamps never change after creation.

## Related

- [Load-bearing claims require evidence](../invariants/claim-evidence.md)
