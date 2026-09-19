---
name: architecture-page
description: Template for architecture module/flow/layer wiki pages.
---

# <Subject>

**Responsibility.** What this module/flow/layer owns, in one or two sentences.

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
