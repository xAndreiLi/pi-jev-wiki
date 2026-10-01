---
title: Wiki maintenance is not wiki consultation
type: gotcha
topic: architecture
summary: "Counting every `wiki_*` call as consultation overstates use badly, because capture and upkeep dominate: splitting reads from writes dropped the measured rate from 93% to 30% on this repository, 87% to 60% on calisthenics, and 80% to 30% on discord-assistant."
tags: [evaluation, measurement, consultation, maintenance, gotcha]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-021352.md, raw/sessions/2026-10-01-session-2026-10-01-041934.md, docs/studies/E1-pilot-2026-10-01.md]
claims:
  - id: c1
    text: "Counting any `wiki_*` call as wiki consultation overstates use badly, because capture and upkeep dominate: splitting read (`wiki_ask`, `wiki_toc`, `wiki_status`, `wiki_doctor`) from write (`wiki_review`, `wiki_ingest`, `wiki_finalize`, `wiki_sync`) dropped the measured consultation rate from 93% to 30% on this repository, 87% to 60% on calisthenics, and 80% to 30% on discord-assistant. Wiki maintenance is a real cost of the wiki and must not be read as evidence that the wiki answered anything."
    status: verified
    support: 0.95
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-021352.md, docs/studies/R0-retrospective.md, packages/pi-wiki-eval/src/core/classify.ts]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
files: [packages/pi-wiki-eval/src/core/classify.ts, packages/pi-wiki-eval/src/core/episodes.ts]
---

# Wiki maintenance is not wiki consultation

**Symptom.** A project looks intensively wiki-driven when measured by tool calls — 41% of all calls
in this repository are `wiki_*` — but almost none of that is the wiki answering anything. The first
R0 run reported that 93% of episodes here "consulted the wiki". The honest figure is 30%.

**Cause.** The two families of calls look identical to a name-prefix rule:

- **Reading the wiki** — `wiki_ask`, `wiki_toc`, `wiki_status`, `wiki_doctor`. The agent is looking
  something up.
- **Maintaining the wiki** — `wiki_review`, `wiki_ingest`, `wiki_finalize`, `wiki_sync`,
  `wiki_insights`, `wiki_remove`, `wiki_lint`, `wiki_index`. The agent is filing knowledge, working
  the review queue, or repairing claims.

Maintenance is not a side effect: it dominates the counts. In `cultivation-game` the agent made 80
`wiki_review` and 20 `wiki_ingest` calls; in `card-sorter`, 70 `wiki_review` calls. Classifying by
the `wiki_` prefix alone turns a project that files a lot into a project that reads a lot.

**Fix.** `wikiCallKind` in `packages/pi-wiki-eval/src/core/classify.ts` splits the two, episodes
carry `wikiReads`/`wikiWrites`, and consultation counts only episodes with at least one *read*.
Unknown `wiki_*` tools count as writes, so a new tool cannot silently inflate the rate.

**Consequence for the value hypothesis.** Maintenance is a cost the wiki imposes, and it belongs in
the ledger next to cost per episode — not folded into a headline "the wiki is used 93% of the time".
Whether maintenance correlates with value is now an open question worth asking: a wiki that is never
maintained is a wiki that is never read.

**Controlled evidence (2026-10-01).** The first A/B rehearsal — three tasks, three arms, nine runs in
the discord-assistant repository — put numbers on this. Every wiki-arm run made **5–15 wiki calls and
only 2–3 wiki reads**, and the wiki arm cost more than the control on two of the three tasks (+44%,
+62%, and 0%). The extra cost was upkeep: capture, review and finalize at settle, paid on every task
whether or not the wiki was ever read. So the wiki's standing cost is a property of having it
installed, not of using it, and an efficacy claim has to price it in. Full numbers:
`docs/studies/E1-pilot-2026-10-01.md` §5.

**Caveat (audit 2026-10-01).** E1 later turned out to expose each task's hidden grader to every arm
([the harness leaks](gotcha-eval-harness-leaks.md)). The upkeep *behaviour* stands, because the
leak does not create write calls. The cost deltas above need re-measuring on a fixed harness, and
they also leave out the wiki's own Jev spend.

**Evidence.** `docs/studies/R0-retrospective.md` §4.1 and §3; `docs/studies/E1-pilot-2026-10-01.md` §3
and §5; the tool histograms in its §9 reproduction command; `packages/pi-wiki-eval` (`classify.ts`,
`episodes.ts`).
