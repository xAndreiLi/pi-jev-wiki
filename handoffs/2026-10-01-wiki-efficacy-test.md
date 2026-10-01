# Handoff — the wiki efficacy test

**Date:** 2026-10-01 · **Repo:** `C:/Coding/pi-jev-wiki` (the harness) · **Testbed:** `C:/Coding/discord-assistant`
**Status:** a run is **in flight** — see §3. Everything below is committed; nothing is left uncommitted except the run's own artefacts.

Read this first if you are picking the work up in a new session. It covers what the test is, how to run
and resume it, what has been found, every harness guarantee, and the mistakes already made so they are not
repeated.

---

## 1. What the test is

**Question:** does having the project wiki installed change what an agent does — cost, behaviour, and the
quality of the code it writes?

**Method:** the same task, run in four arms, in throwaway copies of the repository, graded automatically
and then scored by a blinded subagent.

| Arm | Environment | Represents |
|---|---|---|
| `off` | wiki package removed from a private agent dir; no wiki files | a user without the wiki |
| `brief` | same, plus the wiki's table of contents pasted into the prompt, read from the **base commit** | knowledge without retrieval |
| `wiki` | full setup, wiki as of the base commit | a real user |
| `wiki-nocapture` | `wiki` with capture cadence forced to `manual` | retrieval without upkeep |

**Why those four:** the first pilot showed the wiki's cost premium is mostly *upkeep* (capture, review,
finalize at settle) rather than reading, so `wiki-nocapture` separates upkeep cost from retrieval benefit,
and `brief` separates "structured knowledge helps" from "our retrieval reaches it".

---

## 2. Where everything lives

| Thing | Path |
|---|---|
| Measurement instrument | `packages/pi-wiki-eval/` (standalone package, unpublished by decision) |
| The pipeline (one command) | `eval/pipeline.mjs` |
| Runner · statistics · helpers | `eval/run.mjs` · `eval/report.mjs` · `eval/lib.mjs` · `eval/arms.mjs` |
| Task candidates from git | `eval/candidates.mjs` |
| Grader discrimination check | `eval/grade-check.mjs` (a grader must **fail on the untouched base**) |
| Blinded quality judge | `eval/judge.mjs` + rubric `eval/rubrics/code-quality.md` |
| Harness self-test | `eval/selftest.mjs` — **43 checks**, no model calls |
| Task cards | `eval/tasks/ds-001…ds-008.json` |
| Hidden graders | `eval/graders/*.test.ts` (copied into the task copy only after the agent finishes) |
| Run artefacts (gitignored) | `eval/runs/<run-id>/` — `results.jsonl`, `report.md`, `judgements.jsonl`, `diffs/`, `logs/`, `sessions/`, `agent/`, `pipeline.log` |
| Operator manual | `docs/procedures/run-the-wiki-experiment.md` |
| Study documents | `docs/studies/R0-retrospective.md`, `docs/studies/E1-pilot-2026-10-01.md` |
| Testbed handoff (task landscape) | `C:/Coding/discord-assistant/handoffs/2026-10-01-next-agent-implementation.md` |

---

## 3. The run in flight

```
run id:   r1-run-2026-10-01T08-44-45
command:  node eval/pipeline.mjs --tasks <ds-001…008> --arms off,brief,wiki,wiki-nocapture \
             --repeats 1 --model deepseek-flash --runs r1-run-2026-10-01T08-44-45 --resume --judge
shape:    8 tasks × 4 arms = 32 runs, then a blinded judge session per task
```

**Check on it:**

```bash
tail -f /tmp/watch.log          # progress line every 30s, stops when the pipeline finishes
tail -20 /tmp/r1.log            # the pipeline's own stream
tail -5 /tmp/judge-loop-watch.log   # the incremental judge loop
```

**If it died, continue it** (completed arms are kept, never re-paid):

```bash
cd C:/Coding/pi-jev-wiki
node eval/pipeline.mjs --tasks "eval/tasks/ds-001.json,…,eval/tasks/ds-008.json" \
  --arms off,brief,wiki,wiki-nocapture --repeats 1 --model deepseek-flash \
  --runs r1-run-2026-10-01T08-44-45 --resume --judge
```

**Re-score quality** after any rubric change (automatic — judgements carry a rubric hash, so a task judged
under an older rubric is re-scored, not skipped):

```bash
node eval/judge.mjs --run r1-run-2026-10-01T08-44-45 --model deepseek-flash
node eval/judge.mjs --run <id> --force ...     # to re-score regardless
```

**Note on the watchers**: `/tmp/watch-r1.sh` and `/tmp/judge-loop.sh` are operator conveniences written
for this run, not part of the harness. They are in `/tmp` and will not survive a reboot; the pipeline
itself does the same work at stage 6.

---

## 4. Results so far

### Cost — the first pilot (3 tasks, before the fourth arm existed)

| Task | off | brief | wiki | Δ (wiki − off) |
|---|---|---|---|---|
| ds-001 | $0.0271 | $0.0252 | $0.0390 | +44% |
| ds-002 | $0.0373 | $0.0460 | $0.0604 | +62% |
| ds-003 | $0.0822 | $0.0655 | $0.0822 | 0% |

Median Δ **+$0.01**, mean **+23.9%**, Wilcoxon **p = 0.25** (n=3), **paired SD 0.24× the off-arm mean**.
All 9 runs passed their grader, so outcomes carried no information — the tasks were too easy. Full write-up:
`docs/studies/E1-pilot-2026-10-01.md`.

### Quality — `ds-001` from the run in flight, under the **old** rubric

| Arm | Total /18 | Scope | Verdict |
|---|---|---|---|
| off | 18 | 3 | merge |
| wiki-nocapture | 17 | 3 | merge_with_nits |
| wiki | 15 | **1** | merge_with_nits |
| brief | 13 | 2 | merge_with_nits |

The wiki arm's only lost dimension was **scope**, because its diff also contains wiki pages written during
upkeep. **That was corrected after this score was taken** (see §6): the rubric now says wiki artefacts are
the tooling's output, not scope creep. `ds-001` and `ds-002` will therefore be **re-scored automatically**
under the new rubric; the older rows remain in `judgements.jsonl` with no `rubricHash` and should be
ignored when summarising.

### The finding that matters most

**The wiki's cost premium is maintenance, not consultation.** Every wiki-arm run made 5–15 wiki calls and
only 2–3 wiki *reads*; the calls are capture, review and finalize at settle, paid on every task whether or
not the wiki is ever read. That is a standing cost of having it installed, and it is the thing to attack
before claiming anything about value.

---

## 5. Harness guarantees (all verified, all in `eval/selftest.mjs`)

1. **The arms differ in exactly one thing.** Each arm runs from its own agent directory with the user's
   real settings minus `pi-jev-wiki`; the runner compares the two tool loadouts and **refuses to run**
   unless they match apart from `wiki_*`. (The naive `pi --no-extensions` control also removed the web
   tools and MCP servers — a less capable agent that flattered the wiki.)
2. **State does not leak between runs.** A fresh clone per run, `--session-dir` per task and arm, no
   `--continue`/`--resume` of pi sessions, and a **fresh vector index** per run (a shared one accumulated
   entries for deleted copies and drifted in one arm only).
3. **The answer is unreachable.** Clone, detach at base, delete every ref, expire reflogs, gc, then assert
   the target commit is gone — verified for commits on `main` and on `eval/*` branches.
4. **The control checkout is clean.** Sparse checkout removes the wiki without leaving deleted tracked
   files in `git status`.
5. **Both arms can be graded, identically.** Dependencies are linked (or copied with `--copy-deps`), and
   the test files the target commit touched are restored from the source repo before grading.
6. **The treatment is proven present.** A preflight reads each arm's tool loadout from the session's first
   system message and aborts when the wiki arm has no wiki tools.
7. **Graders discriminate.** `grade-check.mjs` requires each hidden grader to fail on the untouched base.
8. **One model, one reasoning level**, both required and recorded; arm order rotates per task so a fixed
   order cannot absorb drift.
9. **Diffs survive the copy** (`diffs/<task>-<arm>.patch`) along with the project's own type-check and lint
   over what each arm wrote — without this the artefact is deleted and quality can never be reviewed,
   which is exactly what happened to the first pilot.
10. **A failed pilot does not lose the test**: the pipeline reports and judges whatever completed and
    prints the resume command.

---

## 6. Mistakes already made — do not repeat

| Mistake | Consequence | Now |
|---|---|---|
| Launched a 9-run pilot without asking | Andrei's explicit rule: **consent in the turn before anything that spends money, runs unattended, spawns agent sessions, or touches another project** (now in `~/.pi/agent/AGENTS.md`) | Ask first; propose the exact command and cost |
| Ran it detached with `nohup` and no log to watch | He could not see it; checking on it required him to start something | `pipeline.mjs` streams in the foreground; when detached, watch `/tmp/*.log` and report |
| `pi --no-extensions` for the control | Also removed web tools and MCP — an unfair, weaker control | Per-arm agent directories |
| The wiki's vector index was linked wholesale | Retrieval drifted across a pilot in one arm only | Fresh index per run, model cache still linked |
| The brief's table of contents read from the working tree | Could contain pages written *after* the task — hindsight for one arm | Read from each task's base commit |
| `wiki-nocapture` had no agent dir | Ran as a second control; the per-run guard stopped the pipeline after a wasted arm | `agentDirFor` + a self-test assertion + a startup check |
| `--arms` handled as a string only in the pipeline | Silently dropped the fourth arm | Accepts both shapes |
| The scope score counted wiki pages | Penalised the wiki arm for the wiki doing its job | Rubric corrected; rubric hash forces a re-score |
| Two graders failed at *import*, not assertion | Looked like failures while asserting nothing | Graders import dynamically and fail readably |
| `spawnCapture` needed its log directory to exist | Aborted a run with an unhandled stream error | It creates the directory itself |
| An earlier wiki review item was resolved by a mis-clicked script | An unrelated claim was briefly "confirmed" | Corrected to `defer`; resolve by explicit id, never the first row |

---

## 7. Open items

1. **Finish the run in flight**, then write the results up as `docs/studies/R1-<date>.md` — including the
   re-scored quality table under the corrected rubric.
2. **Re-measure the paired SD** with the four arms and eight tasks, and size the real experiment from it.
   The old figure (0.24× the off-arm mean, 12 pairs for a 20% effect) rests on three pairs and is
   optimistic.
3. **Task difficulty is the open question.** `ds-001…ds-003` passed in every arm, so only cost was
   compared; `ds-004…ds-008` were written to be harder (capture-session state machine, cross-field config
   rules, audio retention, audit invariants, redaction) but their discrimination in practice is untested.
   Ten more candidates are listed in the testbed handoff.
4. **Replay cards are the better measurement** once the testbed has real work commits: the grader is that
   commit's own tests and there is a ground-truth diff.
5. **Distribution to other users is closed** (Andrei's decision, 2026-10-01) until the pipeline is trusted.
   Nothing is published; `npm pack` + a local install is the only sharing path if that changes.
6. **Consider splitting the scope dimension** in the rubric into "unrelated code churn" and "tooling
   artefacts" so the distinction is visible in the scores rather than in the judge's notes.

---

## 8. The one-paragraph version

The instrument works, the harness is fair in ten specific ways that are each verified for free, and the
first real reading says the wiki costs more per task than the control — not because agents read it more,
but because they maintain it. Quality scoring is new and already found something the cost numbers could
not: the wiki arm's diff spills outside the task. What is not yet known is whether any of that buys better
work on *hard* tasks, and that is what the eight-card run in flight is for.
