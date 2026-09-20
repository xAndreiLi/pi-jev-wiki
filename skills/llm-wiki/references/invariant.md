---
title: <Invariant statement>
type: invariant
topic: invariants
summary: <The rule, in one sentence.>
tags: [<tag>]
updated: YYYY-MM-DD
sources: [<raw source>]
claims:
  - id: c1
    text: "<the rule, testable>"
    status: verified
    support: 0.0
    evidence: [<raw source>]
files: [src/<enforcing file>.ts]
---

# <Invariant statement>

**Statement.** One sentence, testable, ideally in "must / must never" form.

**Why it exists.** The failure it prevents; the decision that created it.

**Where it is enforced.** Code locations, tests, checks (pointers only).

**What breaks if violated.** Symptoms and blast radius.

**How to verify.** The test or command that proves it holds.

## See also

- Decisions, modules, and gotchas that interact with this invariant.
