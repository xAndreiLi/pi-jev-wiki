---
title: The A/B evaluation harness
type: architecture/flow
topic: architecture
summary: "The controlled wiki-on/wiki-off experiment: task cards replayed from a repository's own commits, run in throwaway clones whose target commit is pruned to be unreachable, with each arm's tool loadout verified from the session before any number is trusted."
tags: [evaluation, measurement, harness, benchmark, experiment]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-021352.md, raw/sessions/2026-10-01-session-2026-10-01-032158.md]
claims:
  - id: c1
    text: "The A/B harness refuses to measure an experiment it cannot verify: it clones the repository and prunes every ref so the target commit is unreachable (a worktree would expose the answer through the shared object database), reads the tool loadout pi persists in the session's first system message to prove each arm had the tools it should, and runs a preflight that aborts the whole run when the wiki arm would have no wiki tools."
    status: verified
    support: 0.85
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-032158.md, eval/run.mjs, eval/README.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
files: [eval/run.mjs, eval/lib.mjs, eval/candidates.mjs, eval/report.mjs, eval/grade-check.mjs, eval/selftest.mjs]
---

# The A/B evaluation harness

**Status.** working prototype (`eval/`), verified end to end on a scratch repository on 2026-10-01.
Plan and rationale: `docs/plans/EFFICACY.md`; measurement instrument: `architecture/module-pi-wiki-eval.md`.

## Why not just compare users

Comparing people who use the wiki to people who do not measures *who installs it*. The interpretable
comparison is the same repository, the same task, the same model, with and without the artifact — so
the harness replays tasks from a project's own history:

- **base** — the parent commit; the repository and its wiki are taken from there, so the wiki cannot
  know the answer.
- **target** — the commit that solved it: ground truth for the diff and the leak check, never shown
  to the agent.
- **grader** — the project's own test command, or the target commit's test files restored afterwards.

## Three invariants

**1. The answer must not be reachable.** `git worktree` shares the object database, so
`git show <target>` would hand the agent the solution. The harness makes a fresh clone, detaches at
base, deletes every ref, expires reflogs, garbage-collects, and asserts the target is unreachable
before the agent starts.

**2. The treatment must be present.** The controls arm runs `pi --no-extensions --no-skills` with the
wiki directory removed from the copy; the wiki arm runs default pi with the wiki present. Because a
broken arm looks exactly like a negative result, the harness reads the tool loadout pi persists in
the session's first system message and **aborts** when an arm does not have the tools it should.

**3. Silence must not be mistaken for progress.** Output streams to a per-run log with a heartbeat;
the default agent budget is five minutes, not twenty. Print mode is silent until the agent finishes,
so a foreground run is indistinguishable from a hang.

## The finding that made invariant 2 necessary

Driving pi from **this repository's** `node_modules` copy runs an agent with **zero tools** — it is an
SDK build, not a configured CLI. Measured directly by reading the tool declaration out of the
session:

```
LOCAL  pi: 0 tools, wiki: NONE
GLOBAL pi: 25 tools, wiki: wiki_status, wiki_toc, wiki_ask, wiki_ingest, wiki_insights,
           wiki_finalize, wiki_sync, wiki_review, wiki_lint, wiki_remove, wiki_structure,
           wiki_index, wiki_doctor, wiki_setup, wiki_triage
```

The first smoke run of the harness therefore ran its *treatment* arm as a second control arm and
reported a plausible-looking result. Automation must drive the installed pi and verify the loadout it
actually got.

## How tasks are produced

A task is one self-contained piece of work with a base and an answer. The convention agreed for the
first testbed (discord-assistant, 2026-10-01) is **one branch per task**, `eval/<task-id>`, cut from a
frozen base before the work starts, with `base` and `target` recorded in the task card at that moment —
`main` moves, and both runs of a pair must come from one frozen pair of SHAs. A plain commit on `main`
works the same way, and `"target": null` covers work with no upstream answer.

Branch commits survive the leak check: the runner deletes every ref and prunes, so a task commit on
`eval/*` becomes unreachable inside the task copy exactly as one on `main` does (verified 2026-10-01: 0
refs remaining, target pruned).

The hazard that convention does not solve is on the wiki side: **a page written about the change before
the run hands the wiki arm a hint the other arm lacks.** Wiki pages describing a task must be written
after it is measured, or the task measures reading rather than recall.

## How fairness is enforced

Five guarantees, each one a fix for a way the naive comparison was unfair in a direction invisible in
the results. `eval/selftest.mjs` verifies all five in seconds with no model calls.

1. **The arms differ in exactly one thing.** `pi --no-extensions` is the obvious way to build a
   control and it is wrong: it disables *every* extension, so the control also loses the web tools,
   the MCP servers and unrelated skills — a strictly less capable agent, which flatters the wiki.
   Instead each arm runs from its own agent directory: the user's real settings, auth, user context,
   package store and model cache, with only `pi-jev-wiki` removed from the package list. The runner
   compares the two tool loadouts and **refuses to run** unless they match apart from `wiki_*`. The
   first measured run under this rule: 10 shared tools, 15 wiki tools in the treatment only.
2. **The control checkout is clean.** Removing the wiki from a clone leaves tracked files missing, so
   the agent's own `git status` shows a wall of deletions — a hint that something was removed, and
   damage to any task that inspects the tree. Sparse checkout removes the wiki without dirtying it.
3. **The answer is unreachable.** Ref pruning plus garbage collection, asserted before the agent starts
   (verified for commits on `main` and on `eval/*` branches).
4. **Both arms can be graded, identically.** Dependencies are made available to every arm, and the test
   files the target commit touched are restored from the source repository before grading, so an arm
   cannot pass by editing its own grader.
5. **One model, one reasoning level.** `--model` is required and the thinking level is read back out of
   each session and recorded, so an asymmetry shows up in the results instead of hiding in them.

## What the pilot measures

Not the effect — the **paired SD of the cost difference**, which decides how many tasks a real
experiment needs. The first rehearsal (`docs/studies/E1-pilot-2026-10-01.md`, three tasks) measured a
paired SD of **0.24× the mean off-arm cost**, against a between-episode coefficient of variation near
1.1 in the observational data: pairing by task is what makes the comparison affordable at all. On that
figure a 20% effect needs about 12 task-instances, but the estimate rests on three pairs and is
provisional — re-measure it before sizing R1.

The same rehearsal showed the limit plainly: **every arm passed every task**, so the outcome guardrail
carried no information and only cost was comparable. Tasks for a real run have to be ones the control arm
sometimes fails.

A pilot that shows no significant difference is still a success if it yields a usable paired SD, and the
report prints the task counts implied for detecting 10/20/30/50% effects. Success rate is a guardrail:
cheaper because it did less is not a win.

## Limits

- The `off` arm lacks the skill as well as the tools — deliberate, but it means the treatment is
  *tool plus instruction*, not the artifact alone. A `brief` arm would separate them.
- The grader is the upstream test suite, so anything the tests do not cover is invisible.
- One repository, one model, one week proves nothing on its own.
