---
title: The A/B harness leaked the grader, the arm identity and the experiment (audit 2026-10-01)
type: gotcha
topic: architecture
summary: "An audit of r1-run-2026-10-01T08-44-45 and the E1 pilot found that every arm could read its hidden grader. The task copy's path named the harness, the run and the arm, the judge could see which arm wrote each diff, the brief arm got almost no knowledge, and wiki-nocapture still captured. E1 and R1 numbers therefore do not support conclusions about the wiki."
tags: [evaluation, harness, validity, leak, blinding, gotcha]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-060004.md]
claims:
  - id: c1
    text: "Since commit 6f2786e, eval/run.mjs calls protectGrader and installGraders before runArm starts the agent, although installGraders' own doc comment, the operator procedure and the 2026-10-01 handoff all say hidden graders are copied in after the agent finishes. Every session checked read its own grader file, usually within its first three turns: 9 of 9 in the E1 pilot and 16 of 16 in r1-run-2026-10-01T08-44-45. Pass rates from those runs therefore measure 'make the visible test pass', and E1's conclusion that the tasks were too easy is unsupported."
    status: verified
    support: 0.39
    evidence: [eval/run.mjs, eval/arms.mjs, "commit 6f2786e", raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c2
    text: "The A/B harness creates each task copy inside its own run directory (eval/runs/<run>/copies/<task>-<arm>-rep<n>), so the agent's working directory names the harness, the run and its own arm, and two levels up are diffs/, results.jsonl, pipeline.log and the judge's files. In r1-run-2026-10-01T08-44-45 agents read the task cards (ds-003 off and wiki). One diffed eval/graders/ds-005-config-consistency.test.ts against its copy and printed IDENTICAL, then parsed results.jsonl (ds-005 off). The clone also keeps its origin remote pointing at the live source repository, so a git fetch would bring back every ref the leak check pruned."
    status: verified
    support: 0.62
    evidence: [eval/run.mjs, eval/arms.mjs, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c3
    text: "The quality judge in eval/judge.mjs is not blind. Each label's 'Patch file:' line is diffs/<task>-<arm>-rep<n>.patch, so the arm name is in the prompt. The judge runs with bash, with its working directory set to the run directory; in r1-run-2026-10-01T08-44-45 it read results.jsonl and entered task copies, including one from the in-flight pilot. And wiki-family patches carry docs/wiki/** and .pi/jev-wiki.json, which would identify the arm even under neutral file names."
    status: verified
    support: 0.51
    evidence: [eval/judge.mjs, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c4
    text: "buildBrief in eval/arms.mjs lists every .md file under the wiki root, raw/sessions captures included. On discord-assistant's task bases, 21 of the 37 'pages' it counts are 'Session capture 2026-10-01 (...)' lines; they fill the 2000-character budget and cut the real pages off after the first one. The brief arm in both E1 and R1 therefore received almost no structured knowledge, so E1's brief-arm hypothesis rests on an arm that had nothing to use."
    status: verified
    support: 0.7
    evidence: [eval/arms.mjs, docs/studies/E1-pilot-2026-10-01.md, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c5
    text: "The wiki-nocapture eval arm (capture.cadence set to manual in the task copy) does not remove upkeep. Agents still call wiki_insights, wiki_review and wiki_finalize on their own, so in r1-run-2026-10-01T08-44-45 the arm's runs made 4–10 wiki writes against 9–14 for the wiki arm, and its patches contain newly written wiki pages and ledger entries. What it measures is 'no automatic capture', not 'retrieval without upkeep'."
    status: verified
    support: 0.88
    evidence: [eval/arms.mjs, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c6
    text: "The A/B harness's cost figure is pi's model usage alone, read from the session JSONL; the wiki extension's own Jev calls never appear in it. In r1-run-2026-10-01T08-44-45 each wiki-arm run made 9–19 Jev calls (30–51k input tokens). Those calls can be recovered afterwards from the added lines of docs/wiki/.jev-wiki/decisions.jsonl in each preserved patch, but the ledger records only tokens, with no price."
    status: verified
    support: 0.55
    evidence: [eval/run.mjs, src/ledger.ts, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c7
    text: "The eval's per-run agent directory copies the user's real jev-wiki/wikis.json. The wiki arms can therefore list and query every registered wiki on the machine: the live discord-assistant wiki at its working tree (20 pages, against 16 at the task bases, while a concurrent session was editing it), the pi-jev-wiki wiki that documents the experiment, and the life wiki. Because wiki and wiki-nocapture share one agent directory per pipeline run, the registry also gathers every earlier task's copy. In r1, ds-004's wiki arm called wiki_toc scope=all and saw all of it."
    status: verified
    support: 0.69
    evidence: [eval/arms.mjs, eval/run.mjs, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c8
    text: "eval/run.mjs appends a run's row to results.jsonl before checking that the arm loaded the expected tools, and --resume skips every recorded row, so an invalid run outlives a resume. In r1-run-2026-10-01T08-44-45 the ds-001 wiki-nocapture row has expectedWikiTools true, observedWikiTools false and 10 tools. It was skipped on resume, and its 17/18 quality score is quoted in the 2026-10-01 handoff as the wiki-nocapture result."
    status: verified
    support: 0.71
    evidence: [eval/run.mjs, handoffs/2026-10-01-wiki-efficacy-test.md, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c9
    text: "discord-assistant's eval task copies include handoffs/2026-10-01-next-agent-implementation.md, which at the task bases lists the eval cards and roughly what each grader checks. 14 of 17 sessions in r1-run-2026-10-01T08-44-45 touched it, the control arms as often as the wiki arms, so the no-wiki condition had a crib sheet on the tasks. Notes about the experiment must stay out of the testbed repository, or out of the copies."
    status: verified
    support: 0.25
    evidence: ["git show ae2f59bc:handoffs/2026-10-01-next-agent-implementation.md (in C:/Coding/discord-assistant)", raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c10
    text: "In r1-run-2026-10-01T08-44-45 every ds-004 and ds-005 run reported typecheck:FAIL, and the errors are in the hidden grader files themselves, not in the arms' code. The graders are already in tests/ when the quality commands run, and they do not satisfy the project's strict type-check. The collected type-check signal is therefore a harness artefact, and the judge is shown it as a failure for every diff."
    status: verified
    support: 0.7
    evidence: [eval/judge.mjs, eval/arms.mjs, raw/sessions/2026-10-01-session-2026-10-01-060004.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
files: [eval/run.mjs, eval/arms.mjs, eval/judge.mjs, eval/report.mjs, eval/selftest.mjs, src/ledger.ts]
---

# The A/B harness leaked the grader, the arm identity and the experiment

**Status (2026-10-01, at commit `77b33da`).** Found by auditing `r1-run-2026-10-01T08-44-45`, which was
still in flight at 17/32 runs, and the E1 pilot. Each item below was confirmed against the run
artefacts: sessions, patches, logs and `results.jsonl`. Those artefacts are gitignored, which is why
some grounding scores are low. **No number from E1 or R1 supports a conclusion about the wiki.** The
upkeep *behaviour* (wiki arms making many write calls and few reads) is still a real observation;
its cost figures need re-measuring once the harness is fixed.

## Why the self-test did not catch any of it

`eval/selftest.mjs` checks each helper in isolation: `installGraders`, `buildBrief`, `blindOrder` and
`prepareAgentDir`. It never checks the order the runner composes them in, or what the agent can see
when it starts. It even asserts that the registry *is* carried over, which turned out to be a leak
channel. Composition is where every one of these broke.

## The leaks

| # | Channel | Arms affected | Seen in the run |
|---|---|---|---|
| c1 | Hidden grader installed **before** the agent runs | all | every session read its grader |
| c2 | Copy lives inside `eval/runs/<run>/`; cwd names the arm; `origin` remote kept | all | agents read the cards, the graders and `results.jsonl` |
| c3 | Judge sees the arm in each patch's file name, and can run bash in the run directory | judge | the judge parsed `results.jsonl` |
| c4 | Brief built from `raw/` captures | brief | 21 of 37 brief lines are "Session capture" |
| c5 | `capture.cadence: manual` leaves agent-driven capture in place | wiki-nocapture | 4–10 writes per run |
| c6 | Jev spend missing from the cost figure | wiki arms | 9–19 Jev calls per run, unpriced |
| c7 | The user's real wiki registry, shared across tasks and both wiki arms | wiki arms | `wiki_toc scope=all` listed the live testbed wiki and pi-jev-wiki |
| c8 | Invalid row written before the guard throws; `--resume` keeps it | any | ds-001 wiki-nocapture ran with no wiki tools |
| c9 | Testbed handoff describes the cards and their graders | all | 14 of 17 sessions touched it |
| c10 | Type-check run with the grader files in place | all | `typecheck:FAIL` everywhere, from the grader files |

## Fixes (2026-10-01, in the working tree after `77b33da`)

| # | Fix |
|---|---|
| c1 | Graders and restored tests installed after the agent; refuse to start if one is already in the copy |
| c2 | Copy and agent dir under neutral temp paths; remotes removed; forbidden-location scan per session |
| c3 | Judge gets code-only diffs inline, `--no-tools --no-context-files`, empty cwd, several shuffled samples |
| c4 | Brief is the base commit's `index.md` |
| c5 | `wiki-nocapture` also withholds every wiki write tool (`--exclude-tools`) |
| c6 | Jev tokens read from the ledger lines each run added; upkeep turns costed |
| c7 | No registry in an arm's agent dir; fresh agent dir per run |
| c8 | Rows carry `valid` and reasons; `--resume` re-runs invalid rows; the report leaves them out |
| c9 | Cards' `excludePaths` (sparse) for every arm; refuse to start if a file names the task |
| c10 | Quality commands run before graders are installed |

The self-test now drives the real runner and judge with a stub pi and checks what each arm could see
(111 checks). Reintroducing c1, c2 or c3 in a scratch copy fails 10, 4 and 1 of them respectively. The
claims above stay as the record of the defect; `wiki_sync` will flag them once the fixes are committed.

## The rule these add up to

The agent must not be able to reach the harness, the answer, or its own arm label, and **"must not"
has to be checked from the agent's side**. Assert at agent start that no grader path exists in the
copy. Scan every session afterwards for paths outside the copy, git remote access, and canary strings
planted in the graders and cards. Exclude contaminated runs instead of reporting them.

## See also

- [The A/B evaluation harness](eval-harness.md) — the design these leaks break.
- [Wiki maintenance is not wiki consultation](gotcha-wiki-consultation-vs-maintenance.md) — its
  controlled evidence comes from E1.
