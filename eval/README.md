# eval — the A/B harness

Answers the question the instrument alone cannot: **does the wiki change what the agent does?**

One task, up to three arms, in throwaway copies of the repository:

| Arm | Environment | Represents |
|---|---|---|
| `off` | Wiki package removed from a private agent dir; wiki files absent from the checkout | A user without the wiki |
| `brief` | Same as `off`, plus the wiki's table of contents pasted into the prompt | Knowledge without retrieval |
| `wiki` | The full setup, wiki as of the base commit | A real user |

`brief` is the control that separates *"structured knowledge helps"* from *"our retrieval reaches
it"*: if it beats `wiki`, the bottleneck is search, not capture.

## How fairness is enforced

Every one of these exists because the naive version is unfair in a way that is invisible in the
results. `node eval/selftest.mjs` verifies all of them in seconds, with no model calls.

1. **The arms differ in exactly one thing.** `pi --no-extensions` disables *every* extension, so the
   old control also lost the web tools, the MCP servers, and unrelated skills — a strictly less
   capable agent. Instead each arm gets its own agent directory: the user's real settings, auth, user
   context (`AGENTS.md`), package store and model cache, with **one package removed from the list**.
   The runner then compares the two tool loadouts and refuses to run unless they are identical apart
   from `wiki_*`.
2. **The control checkout is clean.** Deleting the wiki directory from a clone leaves tracked files
   missing, so the agent's own `git status` shows a wall of deletions — a hint that something was
   removed, and noise for any task that inspects the tree. Sparse checkout removes the wiki without
   dirtying the working tree.
3. **The answer is unreachable.** A `git worktree` shares the object database, so `git show <sha>`
   would hand the agent the solution. The runner clones, detaches at base, deletes every ref, expires
   reflogs, garbage-collects, and **asserts the target commit is unreachable** before the agent
   starts. Verified for commits on `main` and on `eval/*` branches.
4. **Both arms can be graded, identically.** A clone has no `node_modules` and no `.venv`, so nothing
   would run. Dependencies are linked (or `--copy-deps` to copy) from the source repo into every arm.
   The test files the target commit touched are **restored from the source repo** before grading, so
   an arm cannot pass its own grader by editing the tests, and both arms face the same grader.
5. **One model, one reasoning level.** `--model` is required (the runner refuses without it and
   suggests your configured default); the thinking level is read out of each session and recorded, so
   an asymmetry is visible in the results rather than assumed away.

## Usage

```bash
node eval/pipeline.mjs --tasks eval/tasks/ds-*.json --model <id>   # everything: checks, pilot, report
node eval/selftest.mjs                      # just the fairness machinery (no cost)

# Split a project's history into candidate tasks (read-only)
node eval/candidates.mjs --repo <repo> --limit 20 --write eval/tasks

# Run a pilot — background it and watch the log
node eval/run.mjs --tasks eval/tasks/ds-*.json --arms off,brief,wiki --repeats 1 \
     --model <model-id> --runs-dir eval/runs > /tmp/eval.log 2>&1 &
tail -f /tmp/eval.log

node eval/report.mjs --run <run-id>
node eval/run.mjs ... --dry-run             # print the plan without executing
```

**Run it in the background and poll.** Print mode is silent until the agent finishes, so a foreground
run is indistinguishable from a hang. The harness prints a line per arm, a heartbeat every 15s, and a
result line per run. Default budget per arm is **5 minutes**.

## Task cards

```json
{
  "id": "ds-001",
  "repo": "C:/Coding/discord-assistant",
  "base": "<parent commit>",
  "target": "<the commit that solved it>",
  "prompt": "What the original author was asked to do",
  "testCommand": "npx vitest run tests/invite.test.ts",
  "wikiRoot": "docs/wiki",
  "timeoutMinutes": 5,
  "linkDirs": ["node_modules", "web/node_modules", ".venv"]
}
```

- `target` is used for the leak check and for restoring the grader — never shown to the agent. Use
  `null` for a task with no upstream answer.
- `testCommand` is the grader. Without it the run is recorded as ungraded. Keep it focused and fast.
- `linkDirs` defaults to `["node_modules", "web/node_modules", ".venv"]`; set it per repo.
- `prompt` must state the goal without revealing the solution, the files, or the approach.

## Results

`eval/runs/<run-id>/` (gitignored):

| Path | Contents |
|---|---|
| `results.jsonl` | One row per run: cost, tokens, buckets, grading, diff, arm verification, environment, leak check |
| `logs/<task>-<arm>-rep<n>.log` | The agent's streamed output |
| `logs/<task>-<arm>-rep<n>-grade.log` | The grader's output |
| `logs/<run>-grader-restored.txt` | Which grader files were restored, if any |
| `sessions/<task>/<arm>/…jsonl` | The pi session, which `pi-wiki-eval` measures |
| `agent/{off,wiki}/` | The per-arm agent directories used |
| `preflight/` | Evidence that each arm's tool loadout was correct |

## Reading the report

The pilot's purpose is **not** to prove an effect. It is to measure the **paired SD of the cost
difference**, which decides how many tasks the real experiment needs; the report prints it with the
task-instance counts for detecting 10/20/30/50% effects. A pilot that shows no significant difference
is still a success if it yields a usable paired SD.

Success rate is a guardrail: a wiki arm that is cheaper because it did less, and failed more, is not
a win.

## Limitations

- One model, one repository, one week. Nothing generalises on its own.
- `off` and `brief` remove the wiki *and* its skill, which is the honest "no package" condition; the
  `brief` arm is what separates the artifact from the instruction.
- The grader is the upstream test suite, so anything the tests do not cover is invisible.
- Dependency linking shares the source repo's `node_modules` by default. It is fast and identical for
  both arms, but an arm that runs `npm install` writes into that shared store; use `--copy-deps` when
  that matters more than time.
- Cost is compared, not quality, and the harness cannot tell whether the agent understood the task.
