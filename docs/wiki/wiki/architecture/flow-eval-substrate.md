---
title: Efficacy measurement substrate
type: architecture/flow
topic: architecture
summary: "Agent-side cost, context, and discovery accounting derives from pi's own session JSONL rather than from instrumenting the package, and because the wiki is committed alongside the code, code and knowledge can be rewound to the same commit for a hindsight-free comparison."
tags: [evaluation, measurement, sessions, benchmark, git, archaeology]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-014049.md, raw/sessions/2026-10-01-session-2026-10-01-014102.md, raw/sessions/2026-10-01-session-2026-10-01-014128.md]
claims:
  - id: c1
    text: "Agent-side context and cost accounting needs no runtime instrumentation: pi persists per-assistant-message usage (input, output, cacheRead, cacheWrite, cost) and every tool call with its arguments and result content in the session JSONL, so an offline analyzer that never loads the measured extension can compute per-episode cost, context growth, and discovery volume for both arms."
    status: verified
    support: 0.87
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-014102.md, docs/plans/EFFICACY.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
  - id: c2
    text: "The wiki-on/wiki-off control arm is a CLI switch rather than a code change: `pi --no-extensions` (-ne) disables extension discovery so the package's tools and skill never load, while `--tools` and `--exclude-tools` give an otherwise identical allowlist."
    status: verified
    support: 0.5
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-014128.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
  - id: c3
    text: "Wiki pages are committed to the repository alongside the code — only .jev-wiki/* runtime state is gitignored — so `git checkout` rewinds code and knowledge to the same instant, which removes hindsight from history-replay benchmarking by construction rather than by filtering."
    status: verified
    support: 0.57
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-014049.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
files: [docs/plans/EFFICACY.md]
---


# Efficacy measurement substrate

**Status.** proposed — the instrument design is settled; no experiment has been run yet.
Full design: [`docs/plans/EFFICACY.md`](../../../plans/EFFICACY.md).

## Shape

Measuring whether the wiki helps needs three things: what the agent spent, what it read, and a
comparison that is not biased by hindsight. Pi already records the first two, and git already
provides the third.

- **Account** — every assistant message in a session carries `usage` (`input`, `output`,
  `cacheRead`, `cacheWrite`, `cost`); every tool call is recorded with its name, arguments, and
  result content; compactions are their own entries. An offline analyzer can therefore compute
  per-episode cost, context growth, and discovery volume (files read, characters entering context)
  without the extension being loaded — which is what makes the same instrument usable on both arms.
- **Attribute** — tool calls classify by name and argument path into exploration (repository
  reads and searches), wiki consultation (`wiki_*` tools, reads under the wiki root), action
  (edits, commits), and verification (tests, typecheck). The unit of analysis is the task episode:
  one user prompt to the agent settling, compacting included.
- **Compare** — `pi --no-extensions` removes the package's tools and skill without touching the
  repository, so the control arm is a flag rather than a build. A `brief` arm (architecture
  summary pasted into the prompt, budget-matched to a retrieval payload) separates *knowledge
  helped* from *retrieval reached it*.

## Where the counterfactual comes from

Because wiki pages are committed with the code, **`git checkout` moves both together**. A task
replayed from the project's own history can therefore start from a commit whose wiki cannot know
the answer, which removes hindsight contamination by construction instead of by filtering pages
after the fact. The commit that closed the task supplies the hidden grader (its tests) and the
ground truth (its diff).

## Invariants

- **The analyzer must not require the extension to be loaded.** It reads pi's files, the wiki
  files, and git — nothing else — so it measures the `off` arm with the same code path as the `warm`
  arm.
- **No model calls in the measurement path.** Classification and the page-to-file join are rules
  over recorded data.
- **Cost and tokens are reported separately.** Cache-read tokens make raw token counts a misleading
  proxy for spend; an episode that adds context and removes file reads is a cost win that raw counts
  hide.

## Evidence

- `raw/sessions/2026-10-01-session-2026-10-01-014049.md` — the substrate, control-arm, and
  git-rewind claims as first filed.
- `raw/sessions/2026-10-01-session-2026-10-01-014128.md` — the control-arm claim, revised after
  Jev could not ground citations under `node_modules/`; verified directly with `pi --help`.
- Pi's own documentation is the authority for the session and CLI surfaces
  (`@earendil-works/pi-coding-agent` docs `message-types.md`, `session-format.md`, `cli.md`). Those
  installed-package paths were the first evidence cited and they did not resolve — the repo-local
  install's `docs/` does not contain `message-types.md`, and an unresolved ref is reported only as
  "not grounded in evidence". The checkable substitutes used instead are `pi --help` and the
  session files themselves. **Correction (2026-10-01):** an earlier revision of this page claimed
  Jev's grounding "cannot resolve installed packages". That was wrong; the refs pointed at paths
  that do not exist. See `handoffs/2026-10-01-search-fallback-and-evidence-diagnostics.md` §5.
- `git ls-files docs/wiki | wc -l` → 90 tracked wiki files; `.gitignore` ignores `**/.jev-wiki/*`
  except `decisions.jsonl`.

## Notes

`docs/plans/EFFICACY.md` §7 lists the threats this design does not remove — chiefly that wiki
maturity is confounded with the treatment, and that a comparison across *people* is not
interpretable.
