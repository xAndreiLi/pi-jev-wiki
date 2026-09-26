---
title: Capture evidence resolves from the session cwd
type: gotcha
topic: architecture
summary: "Insight evidence refs are read relative to the capture session's working directory — files via resolve(cwd, ref), commits via git show in cwd — so a capture session outside the project reads no evidence and Jev grounds verifiable file/commit claims at 0.03–0.05 instead of ~0.9."
tags: [capture, evidence, cwd, adjudication, gotcha]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-2308.md, docs/notes/handoff-2026-09-26.md]
claims:
  - id: c1
    text: "Insight evidence refs of kind file/commit are resolved against the capture session's working directory — file refs via resolve(cwd, item.ref) and commits via git show run in cwd — so a capture session outside the project cannot read repo-relative evidence and Jev grounds those claims at 0.03–0.05 instead of the ~0.9 a same-evidence in-repo session earns."
    status: verified
    support: 0.9
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-2308.md, docs/notes/handoff-2026-09-26.md, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c2
    text: "Capture loses file evidence twice when a ref cannot be resolved: buildInsightEvidence ignores a file-kind evidence item's own quote when the file cannot be read, and the extraction transcript drops tool results (sessionTextFromEntries keeps only user/assistant roles), so the extractor usually has no quoted passage to fall back on."
    status: verified
    support: 0.85
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-2308.md, src/extension.ts, src/pipeline/capture.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/extension.ts, src/pipeline/capture.ts]
---

# Capture evidence resolves from the session cwd

**Symptom.** A task-cadence capture from a session run outside the project (for example from `~`)
proposes claims that carry file/commit evidence pointers, yet Jev scores them grounded 0.03–0.05 and
advises rejection — even when the same evidence grounds at ~0.9 from a session running inside the
project.

**Cause.** `buildInsightEvidence` (`src/extension.ts`) reads each evidence item against the capture
session's working directory:

- `file` — `resolve(cwd, item.ref)`; a missing file becomes `file: <ref> (not found)`.
- `commit` — `git(cwd, ["show", …, ref])`; a cwd outside a git repository becomes
  `commit: <ref> (commit not found)`.
- `user`, `command`, and quoted `source` items need no file I/O and keep working (observed 0.84–0.94
  for the same capture that scored 0.03–0.05 on its file-backed claims).

The passage Jev receives is therefore empty exactly for the claims whose support lives in the
repository.

**Second loss path.** Even the fallback is missing: for `file` items the extractor's own `quote` is
never emitted (only non-file kinds use it), and the extraction transcript omits tool results
(`sessionTextFromEntries` keeps only `user`/`assistant` roles), so the extractor usually has no
quoted passage to supply.

**Consequence.** Foreign-cwd captures silently lose verifiable package knowledge. Observed
2026-09-26: a home-directory session proposed three true `pi-jev-wiki` claims (one-install source,
capture cadence semantics, legacy `onSettle` alias) whose file/commit evidence resolved to nothing,
while its user- and command-backed claims filed normally.

**Fix direction.** Resolve evidence refs against the session's registered project roots (or the git
top-level of a touched project) instead of `cwd` alone, and fall back to the item's quote when the
file cannot be read. This is Phase 1 of cross-wiki write routing; the same project-root map is what
per-claim routing needs.

**Detection.** Compare `grounded` for the same file-backed claim captured in-repo versus out-of-repo;
`insight.adjudicate` ledger entries record both scores.

**Related.**
- [Capture flow](flow-capture.md) — the pipeline this gotcha lives in.
- [Load-bearing claims require verbatim evidence](../invariants/claim-evidence.md)
- Handoff notes: `docs/notes/handoff-2026-09-26.md` §5.
