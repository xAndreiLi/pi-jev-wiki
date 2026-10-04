---
title: Rediscovery rate as the efficacy mechanism metric
type: decision
topic: decisions
summary: "Efficacy measurement uses rediscovery rate — the share of a retrieved page's files: links that the agent still reads or searches afterwards — because cost and tool counts cannot separate a wiki that answered a question from a wiki that was visited before the answer was found in the code."
tags: [evaluation, measurement, retrieval, rediscovery, benchmark]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-014102.md, raw/sessions/2026-10-01-session-2026-10-01-021352.md]
claims:
  - id: c1
    text: "Efficacy measurement uses rediscovery rate (the share of a retrieved page's `files:` links that the agent still reads afterwards) as the mechanism metric, on the reasoning that cost and tool counts cannot separate a wiki that answered a question from a wiki that was visited before the answer was found in the code — and because the join needs no model call, it can be computed for both arms from the same analyzer."
    status: verified
    support: 0.89
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-014102.md, docs/plans/EFFICACY.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
  - id: c2
    text: "Rediscovery rate is a code-wiki metric: it is computable only where retrieved pages declare `files:` links and where retrieval was recorded, which on this machine is two of six wikis. Prose wikis (a person, a training routine) declare no files at all — 0% coverage on calisthenics and discord-assistant against 76–92% on the code wikis — so any efficacy measurement for them needs a different mechanism measure, and an absent metrics.jsonl makes retrieval unmeasurable rather than empty."
    status: verified
    support: 0.93
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-021352.md, docs/studies/R0-retrospective.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
files: [docs/plans/EFFICACY.md, docs/studies/R0-retrospective.md]
---


# Rediscovery rate as the efficacy mechanism metric

**Status.** implemented in `packages/pi-wiki-eval` (`src/core/retrieval.ts`); scope limited to code
wikis, see below.

**Date.** 2026-10-01

## Context

- The obvious outcome metrics — tokens, cost, tool calls, turns — are all satisfiable by an agent
  that simply does less. They cannot distinguish *"the wiki answered the question"* from *"the wiki
  was read on the way to finding the answer in the code"*, and those two cases carry opposite
  product implications (read it more vs. fix retrieval).
- A retrieval-quality benchmark (recall@5, MRR) answers *"does search return the right page"* but
  says nothing about whether the agent then stops working.

## Decision

- Use **rediscovery rate** as the mechanism metric: for each page retrieved in an episode, the
  fraction of that page's `files:` links that the agent reads or searches for **after** retrieval,
  within the same episode.
- Compute it by joining recorded tool calls against page frontmatter — no model call, no new
  runtime instrumentation, identical on both arms.
- Report it per task alongside cost and success, never instead of them.

## Consequences

- Low rediscovery with a correct outcome is the evidence that the wiki replaced discovery; high
  rediscovery flags either a retrieval miss or a page the agent does not trust.
- A page with no `files:` links yields no rediscovery signal — coverage of the `files:` field
  becomes a measurement-quality concern, not only a `wiki_sync` concern.
- The metric is blind to intent: an agent may read a file for a reason unrelated to the page.
  It is a population statistic, not a per-episode verdict.

## Scope limit (measured 2026-10-01)

R0 measured `files:` coverage and retrieval attribution across all six registered wikis, and the
metric turns out to be **usable on code wikis only**:

| Wiki | Ask events recorded | Pages | With `files:` | Coverage |
|---|---|---|---|---|
| pi-jev-wiki | 25 | 41 | 31 | 76% |
| card-sorter | 3 | 13 | 12 | 92% |
| cultivation-game | 0 | 11 | 8 | 73% |
| home | 21 | 9 | 1 | 11% |
| calisthenics | 5 | 8 | 0 | 0% |
| discord-assistant | 1 | 8 | 0 | 0% |

Two independent ways for the metric to be unmeasurable, and only one of them is about pages:

- **Prose wikis declare no files.** A page about a person or a training routine has no "file it
describes", so 0% coverage is structurally correct rather than a gap to be filled.
- **Retrieval may not be recorded.** `cultivation-game` has 73% coverage and no `ask` rows, because
its sessions predate the registry migration. Where `metrics.jsonl` is absent, retrieval is
*unmeasurable*, not empty — the tool reports that rather than a zero rate.

Consequences for the experiment: R1 must be scoped to code repositories with declared `files:`,
which is where the cost and decision-quality claims live anyway, and prose wikis need a different
mechanism measure (for example, whether a page's claim appears in the answer).

## Evidence

- `raw/sessions/2026-10-01-session-2026-10-01-014102.md` — the claim as filed, and its rationale.
- `raw/sessions/2026-10-01-session-2026-10-01-021352.md` — the scope-limit claim as filed.
- `docs/plans/EFFICACY.md` §2 (definition) and §4.1 (join implementation).
- `docs/studies/R0-retrospective.md` §6 — the coverage and attribution measurements.
