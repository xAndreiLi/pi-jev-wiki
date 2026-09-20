---
title: <Module name>
type: architecture/module
topic: architecture
summary: <What this module owns, in one sentence.>
tags: [<tag>]
updated: YYYY-MM-DD
sources: [<raw source>]
claims:
  - id: c1
    text: "<atomic claim>"
    status: verified
    support: 0.0
    evidence: [<raw source>]
files: [src/<module>/index.ts]
---

# <Module name>

**Responsibility.** What this module owns, in one or two sentences.

**Public surface.** The contracts other parts of the system rely on.

**Dependencies.** What it depends on, and the direction (never the reverse).

**Key files.** `src/...` — pointers only, no code.

## Invariants

- Rules that must always hold; each linked to evidence in the claim frontmatter.

## Failure modes

- What breaks, how it surfaces, and what to do.

## Change impact

- If you change X, these parts are affected; tests/owners to consult.

## See also

- Relative links to related pages.
