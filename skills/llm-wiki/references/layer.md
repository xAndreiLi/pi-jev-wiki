---
title: <Layer name>
type: architecture/layer
topic: architecture
summary: <The boundary this layer draws, in one sentence.>
tags: [<tag>]
updated: YYYY-MM-DD
sources: [<raw source>]
claims:
  - id: c1
    text: "<atomic claim>"
    status: verified
    support: 0.0
    evidence: [<raw source>]
files: [src/<layer>/]
---

# <Layer name>

**Boundary.** What this layer separates, and why the boundary exists.

**Members.** Modules in the layer, and what they are allowed to import.

**Dependency direction.** Which way dependencies point; what a violation looks like.

**Key files.** Pointers only, no code.

## Invariants

- Rules that must always hold; each linked to evidence in the claim frontmatter.

## Change impact

- What breaks when the boundary or its members move.

## See also

- Related module, flow, and decision pages.
