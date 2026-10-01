# R0 — Retrospective measurement across nine projects

**Date:** 2026-10-01
**Instrument:** `pi-wiki-eval` 0.1.0 (`packages/pi-wiki-eval`), 57 tests passing
**Status:** complete — this is calibration, not evidence
**Plan:** `docs/plans/EFFICACY.md` §9 item 7

## 1. Purpose and method

R0 exists to answer three questions before any controlled experiment is designed: does the
instrument work on real history, how much variance is there in the numbers it produces, and is the
effect we are looking for large enough to measure at all. It is explicitly **not** evidence that the
wiki works — there is no counterfactual here, and a cross-project comparison is confounded by
everything that differs between projects.

One command:

```bash
node packages/pi-wiki-eval/dist/cli.js --all-projects \
  --roots "C:/Users/liand/.pi/agent/sessions,//wsl.localhost/Ubuntu/home/liand/.pi/agent/sessions"
```

A **task episode** runs from one user prompt to the agent settling (`stopReason` other than
`toolUse`). Cost, tokens, and cache reads come from the provider usage recorded on each assistant
message. **Consult** counts episodes where the agent *read* the wiki (`wiki_ask`, `wiki_toc`,
`wiki_status`). **Rediscovery** is the share of files declared by retrieved pages that the agent read
anyway.

## 2. Projects

Nine projects have session history across two session roots (Windows, and WSL over UNC). Six have a
registered wiki; one (`jev-wiki`, the package's predecessor) never had one and is the only
"no wiki" data on the machine.

## 3. Results

| Project | Sessions | Episodes | Cost | Median $/ep | Explore | Wiki | Consult | Rediscovery |
|---|---|---|---|---|---|---|---|---|
| pi-jev-wiki | 7 | 30 | $1.74 | $0.04 | 29.2% | 41.5% | 30.0% | 13.2% |
| card-sorter | 6 | 44 | $3.68 | $0.07 | 52.6% | 17.4% | 11.4% | 3.3% |
| jev-wiki (no wiki) | 5 | 34 | $2.50 | $0.05 | 46.2% | — | — | — |
| liand (home wiki) | 3 | 49 | $2.63 | $0.03 | 36.6% | 11.3% | 4.1% | n/a |
| cultivation-game | 2 | 23 | $0.88 | $0.03 | 34.9% | 48.6% | 8.7% | n/a |
| airbnb-agent (no wiki) | 2 | 7 | $0.40 | $0.06 | 33.9% | 10.2% | 14.3% | n/a |
| calisthenics | 2 | 15 | $1.03 | $0.05 | 33.8% | 40.4% | 60.0% | n/a |
| discord-assistant | 1 | 10 | $0.61 | $0.04 | 23.9% | 32.5% | 30.0% | n/a |
| pi-wiki-eval | 1 | 1 | $0.001 | $0.001 | n/a | — | — | — |

The last row is an artefact of this work — a one-prompt session used to test that the extension
loads inside pi. Ignore it.

Total: 212 episodes across eight real projects, $13.5 billed.

## 4. What R0 found in the instrument itself

Four defects surfaced, three of them material. This was the point of running R0 before designing an
experiment.

### 4.1 Consultation was counting maintenance

The first run reported 93% consultation for `pi-jev-wiki`, 87% for `calisthenics`, 80% for
`discord-assistant`. Those numbers were wrong. `wiki_review`, `wiki_ingest`, `wiki_finalize`, and
`wiki_sync` are wiki *upkeep* — filing captures and working the review queue — and the original
bucket counted any `wiki_*` call as consultation. The tool histograms show how much upkeep there is:
`wiki_review` 80 calls in `cultivation-game`, 70 in `card-sorter`, 33 here.

After splitting read from write, consultation fell to 30%, 60%, and 30% respectively. **The wiki's
own maintenance is a large share of the calls attributed to it**, which is a cost the value
hypothesis has to pay for, and the earlier numbers would have made the wiki look far more consulted
than it is.

### 4.2 Cross-wiki and WSL errors

- `read` arguments that name a wiki page relatively (`docs/wiki/wiki/x.md`) never matched an
  absolute wiki root, so wiki reads were counted as discovery. Fixed; wiki calls on this repository
  went from 200 to 276.
- Sessions recorded under WSL carry Linux paths while anything registered from Windows carries UNC
  paths, so WSL-hosted projects could not be matched at all. Two of the nine projects are in that
  position.
- `npx tsc` classified as neither verify nor anything else because the wrapper command was not
  skipped.

### 4.3 Ambiguous episode identity

Episode indices are per session, so four different episodes in one report all rendered as `#0`. The
report now assigns chronological labels (`E01`…).

## 5. Variance, and what it means for the controlled experiment

Episode cost across 212 episodes: **P25 $0.017 · median $0.040 · P75 $0.083 · mean $0.064 ·
SD $0.068 · CV 1.08**. Per project the CV ranges from 0.64 to 1.34, so this is not an artefact of
pooling unrelated projects.

Cost is highly variable and roughly proportional to task size, which is exactly why the planned R1 is
**paired**: the same task, the same repository, the same model, both arms. Pairing removes
between-task variance, and the quantity that matters is the SD of the *paired differences*, which
observational data cannot give us.

Working from the observed SD, however, the unpaired comparison is out of reach: detecting a 30%
reduction on independent samples needs roughly 200 episodes per arm, and a 20% reduction roughly
450. Paired, the requirement collapses:

| Paired SD (as a fraction of episode SD) | Pairs for a 20% effect | Pairs for a 30% effect |
|---|---|---|
| 0.40 | 36 | 16 |
| 0.50 | 57 | 25 |
| 0.75 | 127 | 56 |
| 1.00 | 226 | 100 |

Equivalently, **15 tasks × 3 repetitions = 45 pairs** detects a 22% effect if pairing halves the
variance, a 34% effect if it removes only a quarter of it, and a 45% effect if pairing does nothing.
A 10% effect is not resolvable at any affordable size, and R1 should be pre-registered to say so.

Conclusion: **R1 is worth running for an effect of 25–30% or larger, and R1's first job is to
measure the paired SD**, not to prove the effect.

## 6. The rediscovery metric is limited by retrieval attribution, not by page links

Rediscovery is the metric the whole design turns on, and on this machine it is computable for two of
six wikis. Two different reasons, and one of them is not about pages:

| Wiki | Ask events recorded | Pages | With `files:` | Coverage | Rediscovery |
|---|---|---|---|---|---|
| pi-jev-wiki | 25 | 41 | 31 | 76% | 13.2% |
| card-sorter | 3 | 13 | 12 | 92% | 3.3% |
| cultivation-game | **0** | 11 | 8 | 73% | n/a |
| home | 21 | 9 | 1 | 11% | n/a |
| calisthenics | 5 | 8 | 0 | 0% | n/a |
| discord-assistant | 1 | 8 | 0 | 0% | n/a |
| **all** | 55 | **90** | **52** | **58%** | — |

- **`files:` coverage is 58%**, and it is bimodal: code wikis declare their files (`card-sorter` 92%,
  `pi-jev-wiki` 76%), prose wikis declare nothing (`calisthenics` 0%, `discord-assistant` 0%, `home`
  11%). Rediscovery is structurally unmeasurable on a wiki about a person or a training routine,
  because "the file this page describes" has no meaning there.
- **Retrieval events can be absent even where coverage is good.** `cultivation-game` has 73%
  coverage and no `ask` rows at all, because its sessions (2026-09-20) predate the wiki registry
  migration of 2026-09-26. Where `metrics.jsonl` is missing, rediscovery is *unmeasurable*, not
  zero, and the report says so.

The practical consequence: the rediscovery rate is a **code-wiki metric**. For prose wikis, efficacy
needs a different mechanism measure, and R1 should be scoped to code repositories with declared
`files:` — which is where the plan's C1/C2 claims live anyway.

## 7. Limitations

- **No outcome measure.** Nothing here says whether the work was correct. Cost and behaviour only.
- **No counterfactual.** Cross-project comparison is confounded; the single no-wiki project
  (`jev-wiki`) is a different repository in a different week, and it is the *predecessor* of this one.
- **Small N.** Eight projects, 212 episodes, 1–49 episodes each; medians rest on a handful of tasks.
- **History predates the wiki.** `card-sorter`'s sessions end 2026-09-23 and the registry was
  migrated 2026-09-26; several projects' episodes could not have consulted a registered wiki at all.
  This is why low consultation is not evidence of low value.
- **Cache reads dominate tokens** (98.6% on this repository), so raw token counts across projects
  are not comparable; only cost is.
- **Shell reads are approximated** — `cat src/x.ts` counts as discovery but contributes no file or
  character totals.

## 8. Follow-ups R0 produced

1. **Report retrieval-attribution coverage per project** — episodes that read the wiki but had no
   matching retrieval event. Today a missing `metrics.jsonl` and a genuinely empty retrieval look
   similar in the per-episode table.
2. **Scope R1 to code repositories** with declared `files:`, and pre-register the detectable effect
   from §5 once the paired SD is measured in the E1 pilot.
3. **Treat maintenance as a cost line in its own right.** It is now split out; the next question is
   whether it correlates with value (a wiki that is never maintained is a wiki that is never read).
4. Consider whether prose wikis need a different mechanism metric — "did a page's claim appear in the
   answer" rather than "did the agent stop reading code".

## 9. Reproduction

```bash
cd packages/pi-wiki-eval
npm test                                     # 57 tests
node dist/cli.js --all-projects --roots "<windows root>,<wsl root>"
node dist/cli.js --project <one project>     # full per-episode report
```

Token and cost figures come from the provider's recorded usage and will drift if the same sessions
are re-read with different models; episode boundaries and call classifications are deterministic.
