---
title: Finalize leaves TOC shards that git reports as modified
type: gotcha
topic: architecture
summary: "A tool that rewrites a tracked file with bytes a checkout would not produce — the wiki writer creating a TOC shard with LF while git expects CRLF — leaves it reported as modified in git status while git diff is empty and the blob hashes match. .gitattributes now pins checkouts to LF; a file still cached as CRLF trips once and a re-checkout clears it."
tags: [git, crlf, eol, autocrlf, toc, finalize, gotcha]
updated: 2026-10-09
sources: [raw/sessions/2026-10-09-session-2026-10-09-045702.md, raw/sessions/2026-10-09-session-2026-10-09-045526.md]
claims:
  - id: c1
    text: "A tracked file rewritten by a tool with bytes that differ from what a checkout would produce is reported as modified by `git status` while `git diff` is empty and the HEAD and index blob hashes are equal. With `core.autocrlf=true` and no `.gitattributes` that happens whenever the wiki writer creates a TOC shard with LF, because a checkout would have produced CRLF — git names the mismatch in its warning 'LF will be replaced by CRLF the next time Git touches it' — and `git checkout -- <file>` clears it."
    status: verified
    support: 0.92
    evidence: ["command: git status --porcelain docs/wiki/wiki/toc/architecture.md → 1 .M N... 100644 100644 100644 42377f4 42377f4 (HEAD and index blob hashes equal), while git diff -- <file> printed nothing and git diff --exit-code returned 0", "command: reproducing it on CHANGELOG.md without .gitattributes — tr -d '\\r' into the file, then git status --porcelain printed ' M CHANGELOG.md' on two consecutive calls, git diff printed 0 lines, git status --porcelain=v2 showed '1 .M N... 100644 100644 100644 4672d74 4672d74', and git warned 'in the working copy of CHANGELOG.md, LF will be replaced by CRLF the next time Git touches it'", "command: git checkout -- docs/wiki/wiki/toc/{architecture,decisions,invariants}.md → git status --porcelain printed nothing and the shards stayed clean", "commit: eee2ff5 — .gitattributes pins '* text=auto eol=lf', so a checkout writes LF and matches what the writer produces; a file git cached as CRLF before that change still reports .M once and clears on re-checkout", "file: .gitattributes — the attributes that now make the worktree deterministic across Windows, macOS and Linux"]
    reviewed: 2026-10-09
    last_checked: 2026-10-09
files: [.gitattributes, src/wiki/toc.ts]
---

# Finalize leaves TOC shards that git reports as modified

**Symptom.** After a `wiki_finalize` — or any TOC refresh — `git status` lists shards under
`docs/wiki/wiki/toc/` as modified although the edit changed no page content. `git diff` prints
nothing for them, and `git diff --exit-code` exits 0. The shards keep showing as modified no matter
how many times `git status` or `git update-index --refresh` runs.

**Cause.** The file on disk differs from what a checkout would write, even though its *content*
matches the index. `git status --porcelain=v2 <shard>` shows it plainly: a `1 .M` line whose HEAD
and index blob hashes are identical. `git diff` applies the clean filter, sees the bytes it already
has, and stays silent. The wiki writer creates the shards with LF, and under `core.autocrlf=true`
(a checkout would have produced CRLF) that mismatch is the normal way to hit it — git says so in
its own warning: `LF will be replaced by CRLF the next time Git touches it`. A file whose byte
length differs from the cached stat, written by any tool rather than by a checkout, behaves the
same way; a file already sitting at the endings git expects stays clean, which is why the trap
appears intermittently rather than on every finalize.

**Avoidance.** `.gitattributes` (`* text=auto eol=lf`, added 2026-10-09) pins every checkout to LF,
so what a checkout writes is what the writer writes, on every platform. A file git cached as CRLF
from before that change still trips once. Restore what git expects before staging — the index is
untouched, so nothing is lost:

```bash
git checkout -- docs/wiki/wiki/toc/
```

Then stage only the shards whose content actually changed.

**Detection.** `git status --porcelain=v2 <path>` reports `.M` with equal HEAD and index hashes
while `git diff -- <path>` is empty. A genuine change always produces a diff, so trust the diff and
re-checkout the rest.

**Related.** [The table of contents hierarchy](table-of-contents.md) explains which artifacts the
writer produces and which of them are derived.
