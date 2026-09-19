---
name: invariant-page
description: Template for rules that must always hold.
---

# <Invariant statement>

**Statement.** One sentence, testable, ideally in "must / must never" form.

**Why it exists.** The failure it prevents; the decision that created it.

**Where it is enforced.** Code locations, tests, checks (pointers only).

**What breaks if violated.** Symptoms and blast radius.

**How to verify.** The test or command that proves it holds.

## Related

- Decisions, modules, and gotchas that interact with this invariant.
