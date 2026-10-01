# Run the wiki efficacy experiment

How to answer "does the project wiki change what the agent does?" on a real repository, end to end, and
how to tell whether the answer is trustworthy.

The whole cycle we have actually run is: **pick tasks → run them in three or four arms → read the paired
report → write it up**. One command does the middle of it.

## 1. Prerequisites

| | |
|---|---|
| Harness | this repository, `eval/` — driven from `C:/Coding/pi-jev-wiki` |
| Node | 22+ |
| pi | the **installed** one (the harness prefers it and preflights the tool loadout) |
| Target repo | must be a git repository **with commits** — a base commit is what freezes the task |
| Model | pinned with `--model`; the harness refuses to run without it |

If the target project's wiki pages do not declare `files: [...]` in their frontmatter, rediscovery will
read `n/a`. Adding those links is a wiki-only commit and must land **before** the first task's base, since
it changes the artifact under test.

## 2. One command

```bash
cd C:/Coding/pi-jev-wiki
node eval/pipeline.mjs --tasks eval/tasks/ds-*.json --model deepseek-flash \
     --arms off,brief,wiki,wiki-nocapture --repeats 1 --label r1
```

Runs in the **foreground**, streaming every stage to the terminal and to
`eval/runs/<id>/pipeline.log`. It stops at the first stage that fails, and finishes with the report in
`eval/runs/<id>/report.md`. Nothing needs to be polled or babysat.

| Stage | Cost | What it proves |
|---|---|---|
| 1. build | free | the measurement package's output exists |
| 2. `selftest.mjs` | free, ~15 s | the fairness machinery holds — unit checks, plus the real runner and judge driven by a stub pi that records what an agent can see (111 checks) |
| 3. `grade-check.mjs` | free, ~1 min | every grader **fails on the untouched base** — otherwise it measures nothing |
| 4. `run.mjs` | **money** | the pilot: N tasks × arms × repeats |
| 5. `report.mjs` | free | paired table, Wilcoxon p, and the paired SD that sizes the next run |
| 6. `judge.mjs` (`--judge`) | money | a blind judge (code-only diffs, no tools, several samples) scores each arm against a rubric — the quality the grader cannot see |

Skip stages 2–3 with `--skip-checks` only when you have just run them. Stage 6 is off unless you pass
`--judge`, because it spends money and is a review rather than a measurement.

## 3. The arms

| Arm | Environment | Represents |
|---|---|---|
| `off` | wiki package removed from a private agent dir; no wiki files | a user without the wiki |
| `brief` | same, plus the wiki's table of contents in the prompt, read from the **base commit** | knowledge without retrieval |
| `wiki` | the full setup, wiki as of the base commit | a real user |
| `wiki-nocapture` | `wiki` with capture cadence `manual` and every wiki write tool withheld | retrieval without upkeep |

`wiki-nocapture` exists because the first pilot showed the wiki's cost premium is mostly **upkeep** —
capture, review, finalize at settle — rather than reading. It separates "upkeep costs this much" from
"retrieval helps this much". A cadence flag alone did not do that: in R1 agents still filed knowledge on
their own (4–10 wiki writes per run), so the arm now also runs with `--exclude-tools` for every wiki
write tool the treatment loads.

Every arm runs from a fresh agent directory and a fresh copy under neutral temp paths, with no wiki
registry and, by default, no user context file (`--user-context real` keeps your `AGENTS.md`, which
measures your setup rather than the package).

## 4. Task cards

```json
{
  "id": "ds-001",
  "repo": "C:/Coding/discord-assistant",
  "base": "<sha>",
  "target": null,
  "prompt": "goal, in a requester's words — never the diff, the files, or the approach",
  "testCommand": "npm --workspace web run test -- ds-001-actions",
  "graderFiles": [{ "from": "C:/Coding/pi-jev-wiki/eval/graders/ds-001-actions.test.ts", "to": "web/lib/ds-001-actions.test.ts" }],
  "wikiRoot": "docs/wiki",
  "timeoutMinutes": 10,
  "linkDirs": ["node_modules", "web/node_modules", ".venv"]
}
```

- **Replay card** (`target` set): the work already exists as a commit; base is its parent; the grader can
  be the target's own test files, restored automatically. Best measurement — ground truth comes free.
- **Forward card** (`target: null`): the harness spawns the agent to implement the prompt. Needs a hidden
  grader you write, and there is no ground-truth diff. Fastest to start, weakest evidence.
- `graderFiles` are copied in **after** the agent finishes, so the prompt may state an interface but never
  the assertions. (Until 2026-10-01 they were installed *before* the agent ran, and every E1 and R1
  session read its grader.)
- `canary`: a unique string every grader contains. The runner refuses a card without it, and flags any
  session whose tool output ever carried it.
- `excludePaths`: testbed paths left out of every arm — for notes about the experiment that live in the
  testbed. The runner refuses to start if any file in the copy still names the task. The real rule:
  **notes about the experiment never go into the testbed.**
- Find replay candidates with `node eval/candidates.mjs --repo <dir> --limit 20`.

## 5. Reading the report

- **The preserved diffs are the raw material for quality review.** Every run writes
  `diffs/<task>-<arm>-rep<n>.patch`, because the interesting artefact otherwise disappears with the copy —
  which is exactly what happened to the first pilot, and why quality judgements can only start from the
  next run.
- **Objective quality signals are collected while the copy exists**: the project's own type-checker and
  linter over what the arm wrote, declared per card as
  `"qualityCommands": { "typecheck": "npm run typecheck", "lint": "npx biome check ." }`. A test can pass
  while leaving the code untypeable.
- **The blind judge** (`node eval/judge.mjs --run <id> --model <id> [--samples 3]`, or `--judge
  [--judge-model <id>]` on the pipeline) pastes each arm's **code-only** diff into the prompt under an
  arbitrary label: no file names, no wiki or config files, no test results. It runs with no tools, no
  context files and an empty working directory, once per sample with a fresh label order. It scores six
  dimensions (correctness, conventions, scope, edge cases, clarity, restraint) on a 0–3 scale, gives a
  merge / merge-with-nits / rework verdict, and flags a diff that **weakened the tests**. Prefer a
  stronger model than the agents'. (R1's judge saw the arm in each patch's file name and read
  `results.jsonl`.)
- **Per-task cost log ratios against `off`** are the headline, for each arm, with the median ratio and
  its bootstrap CI. The wiki's own Jev calls are not in the model cost; they are reported beside it.
- **The paired SD of the log ratio** is the real deliverable of a pilot: it sets how many task-instances
  the next run needs (the report prints 10/20/30/50%). Re-measure it rather than reusing an old figure,
  and run one arm twice first: without a noise floor no difference can be read as an effect.
- **Success rate is a guardrail.** A wiki arm that is cheaper because it did less, and failed more, is not
  a win. If every arm passes every task, the tasks are too easy and only cost was compared.
- **Integrity section first.** Invalid runs (wrong tools, no session, unmeasured, dependencies changed)
  and contaminated runs (reached the harness, the source repo, another wiki, or a grader's canary) are
  listed there and **left out of the statistics**; timeouts and ungraded runs are listed too.

## 6. What invalidates a run

- **A wiki page about the change written before the run** — hands one arm a hint the others lack.
- **Notes about the experiment inside the testbed** — a handoff listing the cards and their graders was
  in every R1 copy; 14 of 17 sessions read it. Keep them in the harness, or in the card's `excludePaths`.
- **A contaminated run counted as a result** — the report leaves them out; never add them back by hand.
- **A base without the wiki committed** — the wiki arm then reads nothing and measures nothing.
- **Per-arm differences beyond the wiki** — the fairness gate refuses this, but `--pi-arg` can reintroduce
  it; use `--allow-unverified-arm` never, fix the environment instead.
- **Tests that cannot judge the work** — a grader that passes at base measures nothing; `grade-check`
  catches exactly that.
- **Too few tasks.** Three pairs detect only ~38%; a 20% effect needs about 12.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `cannot find module ../packages/pi-wiki-eval/dist/...` | package not built | `cd packages/pi-wiki-eval && npm run build`, or use `pipeline.mjs` which builds it |
| preflight finds **no** wiki tools | the harness is driving a pi without the extension | check `pi` resolution; the repo's own `node_modules` copy is an SDK build with no extensions |
| `the grader PASSES on the untouched base` | grader is vacuous, or the feature already exists | fix the grader before running anything |
| `the target commit is still reachable` | clone/ref pruning failed | do not run; report it, it is a harness bug |
| runs take the full timeout | task too large for the budget | raise `timeoutMinutes` (default 10; ds-003-class tasks used ~250s) |
| every arm passes | tasks too easy | pick harder tasks, ideally ones the control arm sometimes fails |

## 8. Friction worth remembering

Things that cost time in the first cycle, all now handled by the harness:

- Launching pi from a **detached** process made the run invisible; `pipeline.mjs` streams instead.
- The control arm originally ran `pi --no-extensions`, which also removed the web tools and MCP servers —
  a less capable agent, quietly flattering the wiki. Arms now differ by one package only, and the harness
  refuses to run unless the tool loadouts match apart from `wiki_*`.
- Deleting the wiki from the control left deleted tracked files in `git status`; sparse checkout removes it
  cleanly.
- The wiki's vector index was shared between runs, so retrieval could drift across a pilot in one arm
  only; each run now gets a fresh index.
- Graders that failed at import looked like failures while asserting nothing; they now load dynamically and
  fail with a readable message.
- `spawnCapture` aborted a whole run when its log directory was missing.

And the ones a full audit of R1 found, none visible in the numbers (details:
`docs/wiki/wiki/architecture/gotcha-eval-harness-leaks.md`):

- Hidden graders were installed **before** the agent ran; every session read its own grader.
- The copy's path named the arm and sat inside the run directory; agents read the task cards, the
  graders and `results.jsonl`. The clone kept a remote that could fetch the answer back.
- The wiki arm inherited the machine's wiki registry, including the live testbed wiki and this repo's
  notes about the experiment.
- The judge was told each patch's file name, which contained the arm, and could browse the run.
- The brief was mostly raw session captures; `wiki-nocapture` still captured; an arm that ran without
  wiki tools was kept by `--resume` and quoted as a result; type-check failures came from the graders.
- None of it was caught by 43 self-checks, because each checked a helper, not what the agent could see.

## 9. Sharing with other wiki users

The instrument (`packages/pi-wiki-eval`) is **local-only**: it reads pi's session files and the project's
wiki, sends nothing anywhere, makes no model calls, and never writes to the project. A user runs
`npx pi-wiki-eval --project .` (or the `/wiki-eval` command) and gets a markdown report for themselves;
whether any of it reaches anyone else is their decision, made per report.

Distribution is **closed for now** (Andrei, 2026-10-01): this stays internal until the pipeline itself is
trusted. The package therefore has no publishing story yet — a local path install, a git install or an
`npm pack` tarball handed over directly are the only options, and none of them require a registry.
