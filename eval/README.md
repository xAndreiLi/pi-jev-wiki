# eval — the A/B harness

Answers the question the instrument alone cannot: **does the wiki change what the agent does?**

One task, up to four arms, each in a throwaway copy of the repository:

| Arm | Environment | Represents |
|---|---|---|
| `off` | Wiki package removed from a private agent dir; wiki files absent from the checkout | A user without the wiki |
| `brief` | Same as `off`, plus the wiki's index (`index.md` at the base commit) pasted into the prompt | Knowledge without retrieval |
| `wiki` | The full setup, wiki as of the base commit | A user with the package |
| `wiki-nocapture` | `wiki` with automatic capture off and every wiki *write* tool withheld (`--exclude-tools`) | Retrieval without upkeep |

`brief` separates *"structured knowledge helps"* from *"our retrieval reaches it"*: if it beats
`wiki`, the bottleneck is search. `wiki-nocapture` separates retrieval from upkeep: if it matches `wiki`
on outcome at lower cost, upkeep is pure overhead.

## How fairness is enforced

Each item exists because the naive version was unfair in a way that was invisible in the results.
Several were found only by auditing a real run (`docs/wiki/wiki/architecture/gotcha-eval-harness-leaks.md`):
every helper passed its own check while the composed runner handed every arm its grader.
`node eval/selftest.mjs` verifies all of it with no model calls, **including from the agent's side**: it
drives the real runner and judge with a stub pi (`stub-pi.mjs`) that records what an agent standing in
its working directory can see.

1. **The arms differ in exactly one thing.** `pi --no-extensions` disables *every* extension, so the old
   control also lost the web tools and MCP servers. Instead each run gets its own agent directory: the
   user's settings, auth, package store and model cache, with **one package removed**. The runner
   compares the tool loadouts and refuses to run unless they match apart from `wiki_*`.
2. **No arm inherits machine-wide knowledge.** The agent dir carries no wiki registry (in R1 the wiki
   arm could list the live testbed wiki, this repository's notes about the experiment, and the life
   wiki) and, by default, no user context file (`--user-context real` keeps it).
3. **The agent cannot find the harness or its own arm.** The copy and the agent dir live under neutral
   temp paths (`%TEMP%/ws-*/<repo>`, `%TEMP%/ag-*`). In R1 the copy lived at
   `eval/runs/<run>/copies/<task>-<arm>-rep1`: its path named the arm, and two directories up held the
   results, the diffs and the judge's files.
4. **The answer is unreachable.** Clone, detach at base, **remove the remotes**, delete every ref, expire
   reflogs, garbage-collect, and assert the target commit is gone.
5. **The grader is hidden until the agent is done.** Hidden graders and restored target tests are
   installed only after the agent exits, and the runner refuses to start if a grader is already in the
   copy. Each card has a `canary` that every grader contains; a session that ever saw it is flagged.
6. **The testbed's notes about the experiment are left out.** A card's `excludePaths` are sparse-checked
   out of every arm, and the runner refuses to start if any file in the copy still names the task.
7. **Every session is scanned afterwards.** A tool call reaching the harness, the source repository,
   another wiki or the user's sessions — or any tool result carrying the canary — marks the run
   **contaminated**: recorded, reported, and left out of the statistics.
8. **Invalid runs are not results.** A run whose arm loaded the wrong tools, wrote no session, could not
   be measured, or saw the shared dependencies change is recorded with `valid: false`, stops the run,
   and is run again by `--resume`.
9. **Both arms are graded identically.** Dependencies are linked (or `--copy-deps`), the patch and the
   project's own type-check/lint are taken *before* any grader is in the tree, then graders go in.
10. **One model, one reasoning level.** `--model` is required; the thinking level is read back out of
    each session.

## Usage

```bash
node eval/pipeline.mjs --tasks eval/tasks/ds-*.json --model <id>   # checks → pilot → report (costs money)
node eval/selftest.mjs                      # the fairness machinery, end to end (free, ~15 s)
node eval/grade-check.mjs --tasks ...       # every grader fails on the untouched base (free)
node eval/run.mjs ... --dry-run             # print the plan without executing (free)
node eval/report.mjs --run <run-id>         # free
node eval/judge.mjs --run <run-id> --model <judge-model> [--samples 3]   # costs money

node eval/candidates.mjs --repo <repo> --limit 20 --write eval/tasks    # replay candidates (read-only)
```

Print mode is silent until the agent finishes, so the harness prints a line per arm, a heartbeat every
15s, and a result line per run. Default budget per arm is **5 minutes** (cards set `timeoutMinutes`).

## Task cards

```json
{
  "id": "ds-001",
  "repo": "C:/Coding/discord-assistant",
  "base": "<parent commit>",
  "target": "<the commit that solved it, or null>",
  "prompt": "What the requester asked for",
  "testCommand": "npx vitest run tests/ds-001.test.ts",
  "graderFiles": [{ "from": "C:/Coding/pi-jev-wiki/eval/graders/ds-001.test.ts", "to": "tests/ds-001.test.ts" }],
  "canary": "EVAL-CANARY-ds001-<random>",
  "excludePaths": ["handoffs"],
  "qualityCommands": { "typecheck": "npm run typecheck" },
  "wikiRoot": "docs/wiki",
  "timeoutMinutes": 10,
  "linkDirs": ["node_modules", "web/node_modules", ".venv"]
}
```

- `target` is used for the leak check and for restoring the grader — never shown to the agent.
- `graderFiles` are copied in **after** the agent finishes. The prompt may state an interface, never the
  assertions. Every grader must contain the card's `canary` (the runner refuses otherwise).
- `excludePaths` removes notes about the experiment from every arm. Better still: never put them in the
  testbed. The runner refuses to start if the copy names the task id or carries the canary.
- `prompt` must state the goal without revealing the solution, the files, or the approach.

## Results

`eval/runs/<run-id>/` (gitignored):

| Path | Contents |
|---|---|
| `results.jsonl` | One row per attempt: validity, contamination, cost, Jev usage, upkeep, grading, diff stats, environment |
| `diffs/<task>-<arm>-rep<n>.patch` | The agent's work, taken before any grader was installed |
| `logs/` | The agent's output, the grader's and the quality commands' |
| `sessions/<task>/<arm>/rep<n>-<attempt>/` | The pi session, which `pi-wiki-eval` measures |
| `judgements.jsonl` | One row per arm per judge sample |
| `preflight/` | Evidence that each arm's tool loadout was correct |

## Reading the report

- **Integrity first.** Invalid and contaminated runs are listed and left out; nothing else is trusted
  until that list is understood.
- **Costs are per-task log ratios** against `off` (and `wiki` against `wiki-nocapture`): the median
  ratio, its bootstrap CI, Wilcoxon, and the paired SD of the log ratio with the pairs needed to detect
  10/20/30/50%.
- **Model cost excludes the wiki's own Jev calls**, which are reported beside it (`jev` in each row).
  **Upkeep** is the cost of turns that called a wiki write tool — a lower bound.
- **Success is a guardrail.** An arm that is cheaper because it did less, and failed more, is not a win.
- **Quality** is the blind judge's mean per arm, next to the judge's own spread across samples.

## Limitations

- One model, one repository, one week. Nothing generalises on its own.
- **No noise floor until an arm is repeated.** With one repeat per arm, run-to-run variation and the
  treatment effect are indistinguishable.
- Every wiki run starts with a cold vector index; a real user's index is warm.
- Containment is detection, not a sandbox: an agent can still read anything the user can. Signposts are
  removed and every session is scanned; an OS-level sandbox is the upgrade if contamination recurs.
- Dependency linking shares the source repo's `node_modules`; an arm that installs packages changes it
  for everyone, which the runner now detects and stops on. `--copy-deps` avoids it at the cost of time.
- The grader is a contract the card author wrote; anything it does not cover is invisible to it.
