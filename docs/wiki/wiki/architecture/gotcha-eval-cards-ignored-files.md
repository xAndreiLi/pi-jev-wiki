---
title: Eval cards must target committed files — a gitignored AGENTS.md is absent from every arm
type: gotcha
topic: architecture
summary: "Every eval arm's working tree is a git clone checked out at the base commit, so files the testbed gitignores — discord-assistant's AGENTS.md, memory/, .env — exist in no arm. A card that requires changing a gitignored file, or a grader that reads one, is unsatisfiable; anchor on committed files, and on AGENTS.example.md where the live file is ignored."
tags: [evaluation, harness, cards, grader, gitignore, gotcha]
updated: 2026-10-02
sources: [raw/sessions/2026-10-02-session-2026-10-02-233340.md]
claims:
  - id: c1
    text: "Each eval arm is a fresh clone checked out at the base commit (`git clone --no-hardlinks --no-checkout` then `checkout --detach <base>`), never a copy of the user's working tree, so files the testbed repo gitignores are absent from every arm. Task cards and graders may therefore only require changes to tracked files. In discord-assistant, AGENTS.md is deliberately gitignored — her instructions live on this machine only, with AGENTS.example.md committed as the template — so a card asking the agent to keep AGENTS.md current, or a grader reading it, cannot pass; the ds-009 card and grader were anchored on skills/, scripts/, src/ and the committed example instead."
    status: verified
    support: 0.65
    evidence: [eval/arms.mjs, "C:/Coding/discord-assistant/.gitignore", "commit 0b9df48 (discord-assistant): the .gitignore rule that ignores AGENTS.md"]
    reviewed: 2026-10-02
    last_checked: 2026-10-09
files: [eval/arms.mjs, eval/tasks/ds-009.json, eval/graders/ds-009-screenshot.test.ts]
---



# Eval cards must target committed files

**Status.** verified 2026-10-02 while authoring `ds-009`, the screenshot-capability card for
discord-assistant. Found by cloning the base and finding the file the card was about to require
missing from the copy.

## What happened

The first draft of `ds-009` ended with "keep the overview in `AGENTS.md` current", and its grader
asserted that `AGENTS.md` mentioned the new skill. The reference check — clone the repo at the card's
base and run the grader — failed: `AGENTS.md` was not in the clone at all.

discord-assistant gitignores it on purpose (`.gitignore`, since the scaffold commit `0b9df48`):

```
# Ling's memory and her instructions live on this machine only. An example of the
# instructions is committed as AGENTS.example.md; copy it to AGENTS.md to change her behaviour.
memory/
AGENTS.md
```

## Why it matters for the harness

`prepareTaskCopy` in `eval/arms.mjs` builds each arm with:

```js
await git(dirname(dir), ["clone", "--no-hardlinks", "--no-checkout", "--quiet", task.repo, dir]);
await git(dir, ["checkout", "--detach", "--quiet", task.base]);
```

The working tree is the commit's tracked files and nothing else. Gitignored files are not "removed by
sparse checkout" and not "left out by the harness" — they were never there. That cuts both ways:

- A card may only require changes to **tracked** files. Requiring work on `AGENTS.md`, `memory/`,
  `.env` or any build output makes the grader unsatisfiable in every arm, which looks exactly like a
  hard task until the reference check says otherwise.
- An agent that only ever ran in an arm can never see those files, however central they are to the
  live setup. A capability documented only there is, for eval purposes, undocumented.

## What to do instead

- Anchor the requirement and the grader on committed files: `skills/`, `scripts/`, `src/`, `tests/`,
  `web/`, and on `AGENTS.example.md` where the live file is ignored.
- If a task genuinely depends on a machine-local file, the card needs the file committed at the base
  (a `*.example.md` is the usual home) or the dependency moved into tracked code.
- Run the reference implementation against the grader before spending model money on the card; the
  missing file shows up in the first run, not in a reported statistic.
