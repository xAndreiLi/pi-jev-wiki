---
title: <Gotcha>
type: gotcha
topic: <topic>
summary: <Symptom and cause, in one sentence.>
tags: [<tag>]
updated: YYYY-MM-DD
sources: [<raw source>]
claims:
  - id: c1
    text: "<the non-obvious failure mode>"
    status: verified
    support: 0.0
    evidence: [<file or commit>]
files: [src/<affected file>.ts]
---

# <Gotcha>

**Symptom.** What a developer observes when they hit this.

**Cause.** The non-obvious mechanism behind it.

**Avoidance.** What to do instead; the safe pattern.

**Detection.** How to tell you are about to hit it (tests, lints, logs).

**Related.** Invariants, decisions, or modules involved.
