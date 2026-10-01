# Measuring efficacy — does the wiki make agents better?

> Written at the request: *"How can we accurately assess the efficacy of this package in a real
> project? I want to benchmark the agent performance of our users that use this package somehow,
> and I also want to compare it to users that are not using the package. Are we able to build a tool
> that somehow tracks context usage after using the wiki versus discovering the codebase for
> concepts?"*
>
> Verdict up front: **the cheap part is measuring where context goes; the hard part is the
> counterfactual.** Nearly everything needed for context accounting is already recorded in pi's
> session files, so an offline analyzer is a few days of work. Comparing wiki users to non-users as
> *people* is not interpretable — the comparison that works is the same agent, same repository,
> same task, wiki on versus off, with the wiki rewound in git to remove hindsight.

Companion docs: [`PLAN.md`](PLAN.md) §8 (decision ledger and measurements),
[`../CRITIQUE.md`](../CRITIQUE.md) (efficiency evaluation, value hypothesis unproven),
[`../DESIGN.md`](../DESIGN.md) §8.2 (retrieval judgments).

---

## 0. The claims under test

"Our users get more out of the agent with this package" is not testable. Four statements are.

| # | Claim | Falsified by |
|---|---|---|
| **C1** | For the same repository and task, an agent with a **warm wiki** reaches the same task outcome with fewer code-discovery tool calls and fewer billed tokens than the same agent with the package absent. | No difference, or a difference that disappears once caching is accounted for. |
| **C2** | With the package, agents produce fewer *documented-invariant violations* and less rework in touched areas. | Violation and rework rates indistinguishable between arms. |
| **C3** | The mechanism works as designed: when retrieval returns the right page, the agent stops re-deriving; when it misses, the agent re-derives. | Rediscovery rate is flat with respect to retrieval hit quality — retrieval is decoration. |
| **C4** | The effect grows with repository size and **wiki maturity**; on small or fresh repos the package is net overhead. | Effect is flat across repo size and wiki age, or uniformly negative. |

C4 is not a hedge — it is the honest shape of the value hypothesis, and it is the one that decides
product work (retrieval quality vs. capture quality vs. nothing).

## 1. Why naive telemetry cannot answer this

- **Self-selection.** Users who install a knowledge-wiki package are not a random sample: they are
  more systematic, work in bigger repos, or both. Comparing "users with the package" to "users
  without" measures *who installs it*, not *what it does*. The comparison must be within-user,
  within-repo, or better, within-agent-run.
- **Tokens are not cost.** With prompt caching, a wiki page read on turn 2 is re-read at cache-read
  prices on turns 3–40. A design that adds 3k tokens of context and saves 12 file reads is a large
  cost win that a raw token count hides. Report `billed_cost` and `raw_tokens` separately.
- **A miss costs more than a hit saves.** `wiki_ask` on a cold or wrong wiki spends a tool call, a
  Jev round trip, and context on excerpts before the agent goes looking anyway. The mean effect is a
  sum of two very different populations.
- **Maturity is confounded with the product.** The package is worth little on day one and more after
  fifty sessions — the accumulated artifact *is* the value. "Cold wiki" and "warm wiki" are separate
  arms, not noise.
- **The skill is part of the treatment.** The `llm-wiki` skill loads with the package and tells the
  agent to consult. Comparing "package" to "no package" mixes *instruction* with *knowledge*. Both
  matter, and they are separable with a third arm (§4.3).

## 2. Metric definitions

The unit of analysis is the **task episode**: from a user prompt to the agent settling, including
steering messages, ending at the next user prompt. Compaction happens *inside* an episode.

### Primary

| Metric | Definition | Why it is primary |
|---|---|---|
| `task_success` | Hidden acceptance tests pass, plus rubric score where tests cannot decide | Without an outcome term, token savings is just a measure of doing less |
| `cost_to_success` | Σ assistant-message cost over the episode (cache-aware, from pi's `usage.cost`) — reported over successful runs | The actual economic claim |
| `raw_tokens` | Σ input+output tokens for the same episode | Comparable across providers/models with different pricing |

### Mechanism (explains the primary result; does not replace it)

| Metric | Definition |
|---|---|
| `discovery_volume` | Distinct repository files read + total characters of file content entering context, excluding the wiki |
| `consultations` | `wiki_ask` / `wiki_toc` calls; distinct pages retrieved |
| `rediscovery_rate` | For each retrieved page with `files:` frontmatter, the fraction of those files the agent read or searched **after** retrieving the page, in the same episode |
| `time_to_first_edit` | Seconds from episode start to the first `edit`/`write` |
| `context_peak` / `compactions` | Max context tokens before a compaction; compaction count |
| `verification_effort` | Test, typecheck, and lint invocations |
| `consultation_rate` | Episodes with ≥1 wiki consultation ÷ episodes in a wiki-enabled repo |

`rediscovery_rate` is the crux metric: it is the only one that can distinguish *"the wiki answered
it"* from *"the wiki was read and the answer was still found in the code."* It is computable without
any model call, because pages already declare their `files:` links.

### Guardrails (must not regress while optimizing the above)

Fabricated or unverifiable citations in answers, documented-invariant violations, review-queue
growth per episode, Jev tokens spent per accepted claim, and capture overhead in wall time.

### Outcome proxies from git (secondary, cheap, noisy)

Rework within N days on touched lines, reverts, and test failures in the commit that follows. Useful
for R3 (real use); the controlled experiments use held-out tests instead.

## 3. Data inventory — what is already recorded

| Source | Contains | Missing for our purpose |
|---|---|---|
| Pi session JSONL `~/.pi/agent/sessions/<project>/<ts>_<id>.jsonl` | Every message; per-assistant-message `usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `cost`); tool calls with names, arguments and result content; compaction entries; timestamps; cwd | Task boundaries, arm label, outcome label |
| `.jev-wiki/metrics.jsonl` | `toc`/`catalog`/`ask`/`sync`/`review`/`lint` events, query text, pages returned | Nothing — it is already the consultation log |
| `.jev-wiki/decisions.jsonl` | Jev verdicts with per-candidate scores and token usage; agent actions; outcomes | Linkage to session episodes |
| `.jev-wiki/session-log.jsonl` | Capture candidates and verdicts | — |
| Wiki page frontmatter | `files:` links, `type`, `tags`, `status` | — |
| Repository git log | Commits, diffs, timestamps | Task↔episode linkage |

Two consequences:

1. **No runtime instrumentation is required** for context accounting. Everything in §2 except the
   arm label and the outcome label is derivable from files pi already writes. An analyzer can run
   retroactively over history the user already has.
2. **The wiki is in git**, so it can be rewound. This is the single most valuable property of the
   project for measurement purposes (§5).

Current reality check: this machine holds 19 session files across six project folders, and the
package's own repo accounts for the largest share. That is enough to **validate an analyzer and
calibrate variance**, not enough to conclude anything. The controlled harness, not the archive, is
the evidence path.

## 4. Instruments

### 4.1 I1 — the analyzer (offline, deterministic, no network)

`wiki_eval` — a script, runnable from the package and from a plain checkout, that:

1. Reads session JSONL files for a project (or all projects).
2. Segments episodes (user prompt → settle, with `endTurn`/settle boundaries) and attaches the
   `cwd` for project attribution.
3. Classifies every tool call into `explore` / `wiki` / `act` / `verify` / `other`.
   Classification is by tool name plus argument path: `read` under the wiki root is `wiki`; `read`
   or `grep`/`find` under the repo is `explore`; `bash` running `rg`/`git log` is `explore`,
   `npm test`/`tsc`/`pytest` is `verify`, `git commit` is `act`. Wiki tools are `wiki` by name.
4. Tracks context per request from `usage`, and compactions from compaction entries.
5. Joins retrieved pages to later discovery reads via frontmatter `files:` (`rediscovery_rate`).
6. Emits `episodes.jsonl` (one row per episode, schema versioned) and `report.md`.

**Invariant: the analyzer must not require the extension to be loaded.** It measures the `off` arm
too, so it reads only pi's files and the repository. Its cost is zero, and it can be committed and
run by users on their own history without sending anything anywhere.

Design notes: pure functions for segmentation, classification, and the rediscovery join, so they are
unit-testable without a session runtime; a rule-based classifier with a fixture round-trip test; no
LLM anywhere in the path.

### 4.2 I2 — the recorder (opt-in, live, tiny)

An extension hook on `agent_settled` that appends one row per episode to `.jev-wiki/eval/`:
`arm`, `model`, `thinkingLevel`, `contextPeak` from `ctx.getContextUsage()`, tool histogram, wiki
tool calls, and a hash of the first user message. It adds only what I1 cannot recover: **the arm
label** and **availability-without-use** (the wiki was installed and the agent never consulted it).
Local only; no prompt text, no file paths, no egress. The harness can also supply the arm label
itself, so I2 is optional for the controlled runs and only matters for real users.

### 4.3 I3 — the harness (`eval/`)

```
eval/
  tasks/<task-id>/task.yaml     # repo, base commit, wiki ref, prompt, timeout, rubric
  tasks/<task-id>/tests/        # hidden acceptance tests, applied after the run
  run.ts                        # worktree isolation, arm setup, headless pi runs
  grade.ts                      # tests + diff metrics + rubric
  report.ts                     # paired statistics + markdown
```

**Arms.** The control arm is a CLI switch, not a code change: `pi -ne` unloads the discovered
   extension and skill, and `--tools`/`--exclude-tools` leave an otherwise identical tool allowlist
   with the `wiki_*` tools removed. Named for what they isolate:

| Arm | Setup | Represents |
|---|---|---|
| `off` | `pi -ne` (extension and skill unloaded), repo at base commit | A user without the package |
| `cold` | Package installed, wiki present but empty of pages | A user on day one |
| `warm` | Package installed, wiki rewound to the base commit | A real, mature user |
| `brief` | Wiki absent, architecture summary pasted into the prompt (budget-matched to the `warm` retrieval payload) | Knowledge without retrieval — the ceiling |

`brief` is the most informative arm nobody runs: it separates *"structured knowledge helps"* from
*"our retrieval reaches that knowledge."* If `brief` beats `warm`, the bottleneck is retrieval and no
amount of capture polish will fix it.

**Run hygiene.** Fresh git worktree per run from the same base commit; fixed model and thinking
level; identical tool allowlists except for the wiki tools; the same task order shuffled per arm;
measured runs preceded by a cache-warmup turn or run with caching pinned cold, decided per
experiment and recorded; ≥3 repetitions per task×arm; infrastructure failures discarded and counted.

## 5. Task design — history replay with wiki time-travel

The cheapest source of well-graded tasks is the project's own past:

1. Pick a real commit that closed an issue or implemented a feature (`T`).
2. Reset code **and wiki** to `T`'s parent. Because `docs/wiki/` is committed, `git checkout` gives
   a wiki that cannot know the answer — hindsight contamination is removed by construction rather
   than by filtering.
3. Use the commit's own tests as the hidden grader, and its diff as the ground truth for "the same
   decision".
4. Ask the agent for the change in the original issue's words.

This yields tasks with objective grading, no synthetic-authoring cost, and a wiki that is neither
empty nor clairvoyant. It also lets the `warm` arm be *real*, which a hand-written play wiki never
is.

Contamination checks: exclude tasks whose solution is stated in the repo's README, and confirm that
the parent-commit wiki does not already contain the future change.

Task selection for difficulty: keep tasks where the `off` arm fails a meaningful fraction of the
time. If `off` always succeeds, the only possible difference is token count, and the experiment
measures preference for brevity.

## 6. Experiments

| # | Design | Answers | Cost |
|---|---|---|---|
| **R0** | Analyzer over all existing sessions on this machine | Does the instrument work? What is the per-episode variance? What is the consultation rate in practice? | Free, ~1 day |
| **R1** | Controlled A/B, `off` vs `warm`, 15 tasks × 3 reps | C1, C2 — the headline result | Days of machine time, low API cost |
| **R2** | `cold` vs `warm` vs `brief` on a subset | C3, C4, and whether retrieval or capture is the bottleneck | Same order as R1 |
| **R3** | Longitudinal analysis of real use with I1+I2 (opt-in) | Whether the effect persists outside the lab; where retrieval fails in the wild | Ongoing |

R0 first, and not because it is easy: it **measures the variance**, which decides whether R1 is
worth running at all and how many tasks it needs.

R3 must never be presented as causal. It is adoption and retrieval-health telemetry with the local
report as the product, and any cross-user aggregate requires the privacy decision in §8.

## 7. Threats to validity

| Threat | Severity | Mitigation |
|---|---|---|
| Wiki maturity drives the result, not the mechanism | High | `cold`/`warm`/`brief` arms; maturity (page count, coverage) as a covariate in R3 |
| Self-selection in any user-vs-user comparison | High | Never compare users; compare runs within one repo and one agent |
| Instruction effect mistaken for knowledge effect | High | `brief` arm; the skill text is identical across `cold`/`warm` |
| Prompt-cache asymmetry between arms | Medium | Pin cache state; report `billed_cost` and `raw_tokens`; measure episodes, not turns |
| Task difficulty ceiling | Medium | Pre-screen with `off`-arm failures; discard always-solvable tasks |
| Nondeterminism of the agent | Medium | Paired design, ≥3 reps, nonparametric tests, per-task breakdown published |
| The agent ignores the wiki and still wins | Medium | `consultation_rate` is an outcome, not an assumption; `off`-beat-`warm` is a real finding |
| Hindsight in replayed tasks | Medium | Git-rewound wiki at base commit; contamination checks |
| Provider/model drift mid-experiment | Low | Pin versions; record provider, model, and pi version per run |
| Graders that reward the wiki's style | Low | Hidden tests authored from the original commit, not from wiki pages |

## 8. Privacy and consent

- I1 reads the user's own files and writes its report locally. No network, no egress, ever.
- I2 is opt-in, local-only, and content-free: counts, durations, model identifiers, and a prompt
  hash — never prompt text, file paths, or file contents.
- Any future cross-user aggregation is a product decision, not a side effect: off by default, an
  explicit `wiki_telemetry` command showing exactly what would be sent, and an environment kill
  switch. Assume the honest consequence: aggregate real-user data will be small-N for a long time.

## 9. Work items

| # | Deliverable | Location | Size | Status |
|---|---|---|---|---|
| 1 | Episode segmentation, tool taxonomy, context accounting (pure, unit-tested) | `packages/pi-wiki-eval/src/core/` | M | **done** (2026-10-01) |
| 2 | Rediscovery join over frontmatter `files:` links | `packages/pi-wiki-eval/src/core/retrieval.ts` | S | **done** (2026-10-01) |
| 3 | `wiki_eval` tool + command + CLI, markdown report | `packages/pi-wiki-eval/` | M | **done** (2026-10-01) |
| 4 | Optional recorder hook (arm label, live context peak) | `packages/pi-wiki-eval/src/extension.ts` | S | not started |
| 5 | Task card format + worktree runner + arm setup | `eval/` | L | not started |
| 6 | Grader (hidden tests, diff metrics) + report with paired stats | `eval/` | M | not started |
| 7 | R0 retrospective report | `docs/studies/R0-retrospective.md` | S | **done** (2026-10-01) |

Items 1–3 shipped as a **separate npm package**, `packages/pi-wiki-eval`, because the instrument has to
work with pi-jev-wiki absent — it measures the wiki-off arm with the same code path. 57 tests, no
runtime dependencies, no network, read-only. Published status: packaged, deliberately unpublished
until validation is done (Andrei, 2026-10-01).

First real measurement (this repository, 2026-10-01, 7 sessions / 30 episodes): $1.74 billed,
107M tokens of which 98.6% cache reads, **30% of episodes reading the wiki**, rediscovery rate 13.2%.
A first run reported 93% consultation; that was a measurement defect, not a finding — the bucket was
counting wiki *maintenance* (capture, review, sync) as consultation. R0's full results, the corrected
per-project numbers, and the variance that sizes the controlled experiment are in
`docs/studies/R0-retrospective.md`.

The rediscovery denominator counts every file every retrieved page declares, including files the
task never needed, so a low rate is a signal to inspect an episode rather than a score — noted in
the report itself. R0 also found rediscovery is computable for only two of six wikis on this
machine: it is a code-wiki metric, and prose wikis need a different mechanism measure.

Ordering: 1 → 2 → 3 → 7 gives an answer to "where does our context go?" before any harness exists.
5 → 6 depend on 1's episode model so that both arms are measured identically.

## 10. Statistics

- **Unit:** the task. Repetitions are repeated measures within a task.
- **Primary test:** Wilcoxon signed-rank on per-task paired deltas, with a bootstrap CI on the
  median delta. Report the full per-task table — which tasks help and which hurt is the interesting
  part.
- **Success rate:** McNemar on paired success/failure.
- **Power:** for a paired design, roughly `n ≈ 8/d²` task pairs for 80% power (add ~10–15% for a
  rank test). That is ~15 pairs for a 0.7 SD effect and ~25 pairs for a 0.55 SD effect. **Do not
  guess `d`:** R0 measures the spread of `cost_to_success` at the episode level, and that number
  sets the task count. If the spread is wider than the plausible effect, the honest answer is that
  no affordable experiment will resolve it — say so rather than run a 6-task pilot and declare
  victory.
- **Pre-registration:** primary metric, task set, repetitions, and stopping rule written down before
  the first R1 run, in the task cards themselves.

## 11. Phases

| Phase | Deliverable | Acceptance criteria |
|---|---|---|
| **E0 — instrument** | I1 analyzer + R0 report | Runs over all 19 existing sessions with no LLM calls; deterministic byte-identical output; unit tests cover segmentation, classification, and the rediscovery join; consultation counts reconcile with `wiki_status` within 10% |
| **E1 — harness** | Pilot: 5 tasks × 2 arms × 2 reps | One command runs end to end in worktrees and prints a paired table; emptying the wiki changes only wiki-related metrics; re-running reproduces arm labels and grading |
| **E2 — experiment** | R1 (and R2 if R1 shows an effect worth explaining) | Pre-registered primary metric; per-task table; effect size with CI; nulls reported as nulls |
| **E3 — act** | Product decision | Findings turn into either retrieval work, capture work, or a published negative result |

## 12. Kill criteria (decide before, not after)

- If R0 shows `consultation_rate` below ~20% in wiki-enabled repos, the package is not being used
  enough for an efficacy question to matter — the problem is adoption, not effect size.
- If the paired effect is smaller than run-to-run noise at the affordable N, stop and report that
  the tool's value cannot be established this way.
- If `brief` beats `warm`, retrieval is the bottleneck: stop measuring the package and fix search.

## 13. Open questions

1. Scope: an internal measurement tool for this repo's own development, or a shipped `wiki_eval`
   that users run on their own projects? The analyzer is identical; only packaging and
   documentation differ.
2. Whether I2 (live recorder) ships at all, or the harness supplies arm labels and I1 stays purely
   retroactive.
3. Which repositories supply R1's tasks — this repo, `discord-assistant`, `card-sorter`,
   `cultivation-game` — and whether the `warm` wiki comes from real history or a curated seed.
4. Whether the retrieval benchmark already promised in `PLAN.md` (recall@5 / MRR for BM25 vs vector
   vs hybrid vs Jev-reranked) runs as a separate R-track. It answers *"does retrieval find the right
   page"*, not *"does the wiki make the agent better"*, and it is much cheaper.
