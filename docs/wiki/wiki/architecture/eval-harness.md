---
title: The A/B evaluation harness
type: architecture/flow
topic: architecture
summary: "The controlled wiki-on/wiki-off experiment: task cards run in throwaway clones under neutral temp paths, with the answer pruned, graders installed only after the agent, each arm's tool loadout verified, every session scanned for contamination, and fairness self-tested from the agent's side with a stub pi."
tags: [evaluation, measurement, harness, benchmark, experiment]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-021352.md, raw/sessions/2026-10-01-session-2026-10-01-032158.md, raw/sessions/2026-10-01-session-2026-10-01-070617.md]
claims:
  - id: c1
    text: "The A/B harness refuses to measure an experiment it cannot verify: it clones the repository and prunes every ref so the target commit is unreachable (a worktree would expose the answer through the shared object database), reads the tool loadout pi persists in the session's first system message to prove each arm had the tools it should, and runs a preflight that aborts the whole run when the wiki arm would have no wiki tools."
    status: verified
    support: 0.85
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-032158.md, eval/run.mjs, eval/README.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c2
    text: "Each eval run (one task, arm and repeat) gets a fresh agent directory and a fresh copy under neutral temp paths (%TEMP%/ag-*, %TEMP%/ws-*/<repo>). The agent directory has no wiki registry and, by default, no user-level AGENTS.md; --user-context real keeps the user's context. The reason is R1: the copy's path named the arm and sat inside the run directory, the inherited registry exposed the live testbed wiki and this repository's notes on the experiment, and the user's AGENTS.md told every arm to keep the wiki current and to consult a life wiki."
    status: verified
    evidence: [eval/run.mjs, eval/arms.mjs, raw/sessions/2026-10-01-session-2026-10-01-070617.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c3
    text: "The wiki-nocapture eval arm is a read-only wiki. Capture cadence is set to manual, and the arm runs with pi's --exclude-tools for every wiki write tool the treatment's preflight loadout shows. The cadence flag alone left agent-initiated capture in place: 4–10 wiki writes per run in R1."
    status: verified
    support: 0.41
    evidence: [eval/run.mjs, "pi docs/cli.md: --exclude-tools <list> disables comma-separated tool names after all other selection options", raw/sessions/2026-10-01-session-2026-10-01-070617.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c4
    text: "The eval quality judge sees only code-only diffs pasted inline under arbitrary labels: paths under the wiki root and .pi/ are stripped, and no file names or test results are shown. It runs with --no-tools --no-context-files in an empty temp directory, and is sampled several times with a fresh label order each time, so the spread between samples is reported next to the mean. R1's judge saw the arm in each patch's file name and read results.jsonl."
    status: verified
    evidence: [eval/judge.mjs, raw/sessions/2026-10-01-session-2026-10-01-070617.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c5
    text: "Eval fairness is verified from the agent's side. eval/selftest.mjs drives the real run.mjs, report.mjs and judge.mjs with a stub pi (eval/stub-pi.mjs), which calls no model and records what an agent in its working directory can see: files on disk, remotes, git status, registry, user context, the path names, and the judge's prompt. Reintroducing three R1 defects in a scratch copy fails 10 checks (graders installed before the agent), 4 (copies inside the run directory) and 1 (patch paths in the judge prompt)."
    status: verified
    evidence: [eval/selftest.mjs, eval/stub-pi.mjs, raw/sessions/2026-10-01-session-2026-10-01-070617.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
  - id: c6
    text: "Eval runs are checked for contamination after the fact rather than sandboxed. Each card has a canary that every one of its graders contains. A run is recorded as contaminated, and kept out of the statistics, if any tool output carries that canary, or if any tool call's arguments name the harness, the source repository, a registered wiki, or the user's sessions, AGENTS.md or registry. An OS-level sandbox is the upgrade if contamination keeps recurring."
    status: verified
    evidence: [eval/arms.mjs, eval/README.md, raw/sessions/2026-10-01-session-2026-10-01-070617.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-01
files: [eval/run.mjs, eval/arms.mjs, eval/lib.mjs, eval/judge.mjs, eval/candidates.mjs, eval/report.mjs, eval/grade-check.mjs, eval/selftest.mjs, eval/stub-pi.mjs]
---

# The A/B evaluation harness

**Status.** working prototype (`eval/`), verified end to end on a scratch repository on 2026-10-01.
Plan and rationale: `docs/plans/EFFICACY.md`; measurement instrument: `architecture/module-pi-wiki-eval.md`.

> **Known leaks (audit 2026-10-01), and their fixes.** The original guarantees held for each helper on
> its own, but not in the runner that composed them: every arm could read its hidden grader, the copy's
> path named the arm and the harness, and the judge could see which arm wrote each diff. E1 and R1
> numbers are therefore not evidence about the wiki
> ([the leaks](gotcha-eval-harness-leaks.md)). The harness was hardened the same day: claims c2–c6 and
> the fairness list below describe it. (At the time of writing these fixes sit in the working tree,
> after commit `77b33da`.)

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

**2. The treatment must be present.** Each arm runs from its own agent directory with only
`pi-jev-wiki` removed for the controls (originally `pi --no-extensions`, which stripped every other
tool too — see fairness item 1). Because a broken arm looks exactly like a negative result, the harness
reads the tool loadout pi persists in the session's first system message, aborts when an arm does not
have the tools it should, and records that run as invalid so `--resume` runs it again.

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

Each guarantee fixes a way the naive comparison was unfair in a direction invisible in the results. The
first five existed before the R1 audit; the rest came from it. `eval/selftest.mjs` verifies all of them
with no model calls, including from the agent's side (c5). Operator detail: `eval/README.md`.

1. **The arms differ in exactly one thing.** `pi --no-extensions` disables *every* extension, so the
   control also loses the web tools and MCP servers — a less capable agent, which flatters the wiki.
   Each arm runs from its own agent directory with only `pi-jev-wiki` removed, and the runner refuses to
   run unless the tool loadouts match apart from `wiki_*` (first measured: 10 shared tools, 15 wiki).
2. **The checkout is clean.** Sparse checkout removes the wiki (controls) and the card's `excludePaths`
   (every arm) without leaving deleted files in `git status`; the harness's own config edit in the
   read-only arm is hidden with `assume-unchanged` ([why not skip-worktree](gotcha-sparse-checkout-skip-worktree.md)).
3. **The answer is unreachable.** Remotes removed, every ref deleted, reflogs expired, garbage collected,
   the target asserted gone.
4. **The grader appears only after the agent.** Hidden graders and restored target tests are installed
   once the agent exits; the patch and quality signals are taken before. The runner refuses to start if
   a grader is already in the copy or a file names the task.
5. **One model, one reasoning level**, required and read back from each session.
6. **No machine-wide knowledge, no signposts** (c2): neutral temp paths, no registry, no user context.
7. **Contamination is detected and excluded** (c6): canaries and a forbidden-location scan per session.
8. **The judge is blind and repeated** (c4).
9. **The read-only arm is read-only** (c3).

## What the pilot measures

Not the effect — the **paired SD of the per-task cost log ratio**, which decides how many tasks a real
experiment needs. The first rehearsal (`docs/studies/E1-pilot-2026-10-01.md`, three tasks) measured a
paired SD of **0.24× the mean off-arm cost** and suggested about 12 task-instances for a 20% effect.
Both E1 and R1 were later found to show every arm its grader, so their numbers are rough at best:
re-reading R1's 8 tasks as log ratios gives SDs of 0.27–0.42 depending on the contrast — roughly
18–42 pairs for a 20% effect, not 12. Re-measure on the hardened harness, with one arm repeated to get
a noise floor, before sizing anything.

E1 also found **every arm passed every task**, but with the graders visible that says nothing about
difficulty. Tasks for a real run have to be ones the control arm sometimes fails *without* seeing the
grader.

A pilot that shows no significant difference is still a success if it yields a usable paired SD, and the
report prints the task counts implied for detecting 10/20/30/50% effects. Success rate is a guardrail:
cheaper because it did less is not a win.

## Limits

- The `off` arm lacks the skill as well as the tools — deliberate: the treatment is *tool plus
  instruction*. The `brief` arm (the base commit's `index.md` in the prompt) separates the knowledge.
- Every wiki run starts with a cold vector index; a real user's is warm.
- Containment is detection, not a sandbox (c6).
- The grader is a contract the card author wrote, so anything it does not cover is invisible.
- One repository, one model, one week proves nothing on its own.
