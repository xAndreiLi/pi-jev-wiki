---
title: pi-wiki-eval — the measurement package
type: architecture/module
topic: architecture
summary: "A separate npm package that measures where an agent's context went and whether the wiki replaced codebase discovery: it derives episodes, cost, tool buckets, and the rediscovery join entirely from pi's session JSONL and the wiki's on-disk state, with no dependency on this extension."
tags: [evaluation, measurement, package, sessions, benchmark]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-020321.md]
claims:
  - id: c1
    text: "Three pi session-format facts decide how any session analysis must be written: assistant messages carry no `endTurn` field, so a task boundary is the first message after a prompt whose `stopReason` is not `toolUse`; wiki briefs enter the transcript as `custom_message` entries and must not be counted as user prompts; and `nestedCalls` on a tool result is an object `{ calls: [...] }` whose entries carry names and arguments, so tool calls made inside codemode are recoverable and counting only the top-level `codemode` call would hide most of a codemode-heavy session's work."
    status: verified
    support: 0.6
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-020321.md, packages/pi-wiki-eval/src/core/episodes.ts, packages/pi-wiki-eval/src/core/sessions.ts]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
files: [packages/pi-wiki-eval]
---


# pi-wiki-eval — the measurement package

**Status.** working, unpublished (0.1.0). Plan and rationale: `docs/plans/EFFICACY.md` §9.

## Purpose

Answer three questions about a project's own history, from local files only: what a task episode
cost, where its tool calls went, and whether the wiki replaced codebase discovery. It exists because
the package's value hypothesis had no instrument — see `decisions/eval-separate-package.md` for why
it is a separate package rather than one of this extension's tools.

## Surfaces

| Surface | Entry point | Notes |
|---|---|---|
| pi tool | `wiki_eval` | Report for the session's project; result truncated at 14k characters |
| pi command | `/wiki-eval` | One-line summary via `ui.notify` |
| CLI | `npx pi-wiki-eval --project .` | Full report, `--json`, `--out`, `--since`, `--episodes` |

All three call the same core, so a number from the tool and a number from the CLI are the same
number. `dist/` is built by `tsc` and is what both surfaces load; `prepublishOnly` builds and tests.

## Pipeline

`sessions.ts` → `activePath` → `episodes.ts` → `classify.ts` → `retrieval.ts` → `report.ts`.

- **Active branch.** Sessions are trees; the evaluator walks `parentId` back from the last entry so
  an abandoned branch is not counted as work that happened, and reports when it dropped entries.
- **Cost.** Summed from the provider's `usage` on each assistant message, so the system prompt,
  history, tool results, and compaction are all included. Cache reads are reported separately:
  they dominate token counts at a fraction of the price.
- **Tool buckets.** explore / wiki / act / verify / other, by tool name and argument path, with
  shell commands classified by their effective head (`npx tsc` is verify, `git log` is explore,
  `git commit` is act).
- **Retrieval.** `wiki_ask` outcomes are read from `<wikiRoot>/.jev-wiki/metrics.jsonl` and joined
  with page frontmatter `files:` links to produce the rediscovery rate.

## Session-format constraints

- Assistant messages carry **no `endTurn` field** (0 of 234 in the largest session on this
  machine). The boundary of a task episode is the first assistant message after a prompt whose
  `stopReason` is not `toolUse`.
- Wiki briefs arrive as `custom_message` entries with `customType: "jev-wiki"`; they are injected
  content and must not be counted as user prompts.
- `nestedCalls` is `{ calls: [...] }`, not an array. Its entries carry `name`, `arguments`, and
  `status`, so calls made inside `codemode` are recoverable — 90 in one session here, including 52
  `bash` and 15 `read`. Counting only the top-level `codemode` call would under-report discovery by
  more than half in a codemode-heavy session.
- Entry timestamps are ISO strings; `message.timestamp` is epoch milliseconds. Durations use the
  entries.

## Invariants

- **Read-only and offline.** No network, no model calls, no writes to the session, the project, or
  the wiki. Prompts and query text are excluded from reports unless explicitly requested.
- **No dependency on this extension.** It reads pi's files and the wiki's files, so the wiki-off
  arm is measured by the same code path as the wiki-on arm.
- **Zero runtime dependencies**, so it installs anywhere pi runs.

## Caveat on rediscovery

The denominator is every file declared by every page retrieved in the episode, including files the
task never needed, so retrieving a broad page for a narrow task lowers the rate for reasons
unrelated to whether the agent was helped. It is a per-episode signal to investigate, not an
efficacy score, and it is sharpest on episodes where the agent edited code. This caveat is printed
in the report itself.

## Verification (2026-10-01)

57 tests (`npm test`). R0 (`docs/studies/R0-retrospective.md`) ran the instrument across nine
projects and 212 episodes; its findings changed the tool as much as the projects: consultation had
been counting wiki *maintenance* (capture, review, sync) as reading, so the reported rate for this
repository was 93% when the honest figure is 30%. The tool was also exercised inside pi with `-ne`
(this extension disabled), which is the control-arm shape it exists to measure.

## Related

- `decisions/eval-separate-package.md` — why it is not a tool in this package.
- `architecture/gotcha-silent-search-degradation.md` — why the retrieval numbers from this machine
  before 2026-10-01 are suspect.
