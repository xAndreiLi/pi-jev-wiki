---
title: Sparse checkout clears skip-worktree — hide harness edits with assume-unchanged
type: gotcha
topic: architecture
summary: "In a sparse checkout, git 2.37+ clears the skip-worktree bit of any file present in the working tree, so skip-worktree cannot hide a harness edit to a tracked file; assume-unchanged can — git status stays clean and git add -A leaves the file out."
tags: [git, sparse-checkout, evaluation, harness, gotcha]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-070617.md]
claims:
  - id: c1
    text: "In a sparse checkout, git (2.37+, observed on 2.43.0.windows.1) clears the skip-worktree bit of any file present in the working tree. So `git update-index --skip-worktree` cannot hide a harness edit to a tracked file there. `git update-index --assume-unchanged` can: git status stays clean, and `git add -A` stages the agent's own edits but not the hidden file."
    status: verified
    support: 0.86
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-070617.md, eval/arms.mjs]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
files: [eval/arms.mjs]
---


# Sparse checkout clears skip-worktree

**Symptom.** The eval harness writes `.pi/jev-wiki.json` into the read-only arm's copy (capture cadence
`manual`). It is the harness's edit, not the agent's, so it must not show in the agent's `git status`
or in the arm's patch — in R1 it did both, and the patch put it in front of the judge. Marking the file
`--skip-worktree` did nothing: `git ls-files -t` still showed `H`, and `git status` showed ` M`.

**Cause.** Every eval copy is a sparse checkout (it leaves out the wiki for control arms and the
card's `excludePaths` for all arms). Sparse checkout owns the skip-worktree bit, and since git 2.37 it
clears that bit from any file that is present in the working tree.

**Fix.** `git update-index --assume-unchanged <file>` is a separate bit and survives: status is clean,
and `git add -A` stages the agent's edits while leaving the harness's file out. `configureCapture` in
`eval/arms.mjs` uses it for a tracked file and `.git/info/exclude` for an untracked one; the self-test
asserts both the clean status and the patch.

**Caveat.** An assume-unchanged file's own changes are invisible to git — if an agent edited the hidden
config itself, the patch would not show it. For a harness-owned file that is the point.
