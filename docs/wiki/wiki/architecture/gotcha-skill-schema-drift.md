---
title: Claim schema drift between the skill and code
type: gotcha
topic: architecture
summary: "Historical: the llm-wiki skill was the only documentation of the page-claim schema and its status list had drifted from the code; SKILL.md now documents needs_recheck, reviewed, last_checked, needs_review, the YAML subset, and the rule to update it alongside the code."
tags: [skill, schema, claims, lifecycle, frontmatter]
updated: 2026-09-20
sources: [raw/sessions/2026-09-20-session-2026-09-20-2115.md]
claims:
  - id: c1
    text: "The jev-wiki skill is the sole schema documentation for wiki page claims, and it is stale: its status list omits needs_recheck (src/sync.ts:223), reviewed/last_checked (src/review.ts:140, src/sync.ts:215) and needs_review (src/pipeline/write.ts:224) never appear. Any change to claim lifecycle statuses must update SKILL.md or the schema goes undocumented."
    status: superseded
    support: 0.35
    evidence: [src/sync.ts, src/review.ts, src/pipeline/write.ts, skills/llm-wiki/SKILL.md]
    reviewed: 2026-09-20
    last_checked: 2026-09-20
    superseded_by: "SKILL.md page format now documents needs_recheck, reviewed, last_checked, needs_review, and the YAML subset"
    superseded_at: 2026-09-20
files: [skills/llm-wiki/SKILL.md, src/sync.ts, src/review.ts, src/pipeline/write.ts]
---

# Claim schema drift between the skill and code

**Resolved 2026-09-20.** `skills/llm-wiki/SKILL.md` now lists `needs_recheck` in the claim status
enum, documents `reviewed`/`last_checked`/`needs_review`, states the restricted YAML subset, and
carries the standing rule that lifecycle changes update the skill in the same change. The claim
below is closed but kept as history.

**Symptom (before the fix).** An agent that treats `skills/llm-wiki/SKILL.md` as the claim schema will not learn all of the lifecycle state the code writes. The page-format status list omits `needs_recheck`, and `reviewed`, `last_checked`, and `needs_review` do not appear in the skill at all.

**Cause.** SKILL.md is the only place the page-claim schema is documented, but the lifecycle is implemented in code. When a status or field changes in `src/sync.ts`, `src/review.ts`, or `src/pipeline/write.ts`, the skill only stays accurate if it is updated in the same change.

**Avoidance.** Treat the skill's page-format section as part of the schema: update it whenever a claim status or frontmatter field changes in the lifecycle code.

**Detection.** Compare the status literals and claim fields written by the code against the status list and frontmatter example in `skills/llm-wiki/SKILL.md`.

**Related.** [Guided writing as default mode](../decisions/guided-writing.md) · [Load-bearing claims require verbatim evidence](../invariants/claim-evidence.md)

## Evidence

- `raw/sessions/2026-09-20-session-2026-09-20-2115.md` — session capture in which the schema audit was adjudicated (Jev: file, grounded 0.35, trust tier `verified_in_repo`).
- `src/sync.ts:223` sets `status = "needs_recheck"`; `src/review.ts:140` and `src/sync.ts:215` write `reviewed`/`last_checked`; `src/pipeline/write.ts:224` writes `needs_review`; `skills/llm-wiki/SKILL.md` lists neither those fields nor all of those statuses.
