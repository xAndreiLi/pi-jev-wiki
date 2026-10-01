# pi-wiki-eval

Measure where an agent's context actually went — and whether a project wiki replaced codebase
discovery.

Answers three questions about a project's own session history, entirely from local files:

- **What did it cost?** Billed cost and tokens per task episode, cache-aware, summed from the usage
  pi recorded on every provider response.
- **Where did the calls go?** Discovery (`read`, `rg`, `git log`) versus wiki consultation versus
  doing the work versus verifying it — including tool calls made inside `codemode` scripts, which
  pi records with their real names.
- **Did the wiki help?** The **rediscovery rate**: of the files declared by the wiki pages the agent
  retrieved, how many did it read anyway? Low means the page answered the question well enough that
  the agent stopped digging. High means the wiki was visited on the way to the answer rather than
  instead of it.

## Install

```bash
pi install npm:pi-wiki-eval
```

Then, in a session: the `wiki_eval` tool, or `/wiki-eval` for a one-line summary.

Or use the CLI directly — it needs no pi session:

```bash
npx pi-wiki-eval --project .            # markdown report
npx pi-wiki-eval --project . --json     # raw analysis
npx pi-wiki-eval --since 30 --episodes 40 --out report.md
```

## What it reads

| Source | Why |
|---|---|
| `~/.pi/agent/sessions/<project>/*.jsonl` | Episodes, tool calls, provider usage — the whole accounting |
| `<project>/docs/wiki/` | Page frontmatter `files:` links, for the rediscovery join |
| `<project>/docs/wiki/.jev-wiki/metrics.jsonl` | Which pages each `wiki_ask` returned |

**Read-only and local.** No network calls, no model calls, no telemetry, and nothing is written to
your project or your wiki. It works whether or not `pi-jev-wiki` is installed — on a project with
no wiki it reports discovery and cost with zero wiki metrics, which is exactly what a control
measurement looks like.

Prompt text and wiki query text are excluded by default. `--include-queries` adds them, because a
report is easy to share by accident.

## How the numbers are derived

- **Task episode** — one user prompt through to the agent settling. Pi records no explicit settle
  marker, so the boundary is the first assistant message whose `stopReason` is not `toolUse`; a
  second prompt mid-turn closes the previous episode as `steered`.
- **Cost** — summed over the assistant messages in the episode. The system prompt, the accumulated
  history, tool results, and compaction all land in the message that carries them, so an episode's
  cost is what was actually billed. Cache reads are reported separately: they dominate token counts
  while costing a fraction as much, so tokens alone mislead.
- **Active branch** — sessions are trees. The evaluator follows `parentId` from the last entry so
  that an abandoned branch is not counted as work that happened, and says so when it does.
- **Retrieval** — attributed to episodes by timestamp from `metrics.jsonl`, then joined with page
  frontmatter to get declared files, then joined with what the agent read.

## What it cannot tell you

- **Nothing about answer quality.** This measures cost and behaviour, not correctness. Pair it with
  an outcome measure — tests, rework, review — before concluding anything about efficacy.
- **It measures one project.** No comparison between projects, users, or models.
- **Rediscovery is a population statistic, not a verdict.** An agent may open a file for reasons
  unrelated to the page it just retrieved, and the denominator includes every file every retrieved
  page declares — including files the task never needed. A low rate is a signal to look at an
  episode, not a score.
- **Shell reads are approximated.** `cat src/x.ts` counts as discovery, but only `read` tool calls
  contribute to the file and character totals.
- **A wiki miss costs more than a hit saves.** Consultation is not automatically good: a page that
  cannot answer the question still spends a call and context.

For the comparison design these metrics are meant to serve — wiki-on versus wiki-off arms, history
replay with the wiki rewound in git, and the statistics for deciding whether an effect is real — see
`docs/plans/EFFICACY.md` in the [pi-jev-wiki repository](https://github.com/xAndreiLi/pi-jev-wiki).

## Development

```bash
npm run build      # tsc → dist/
npm test           # build + run the test suite
npm run typecheck
```

The CLI and the pi extension are thin shells over `src/core/`, so both surfaces are measured by the
same code path and the tests exercise the core directly.
