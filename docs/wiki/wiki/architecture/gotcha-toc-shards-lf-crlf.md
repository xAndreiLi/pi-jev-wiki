---
title: Finalize leaves TOC shards that git reports as modified
type: gotcha
topic: architecture
summary: "The wiki writer creates the table-of-contents shards with LF, but the repository runs with core.autocrlf=true and no .gitattributes, so a shard whose content did not change still shows up as modified in git status while git diff prints nothing and the blob hashes match; re-checkout the shard to clear it."
tags: [git, crlf, autocrlf, toc, finalize, gotcha]
updated: 2026-10-09
sources: [raw/sessions/2026-10-09-session-2026-10-09-045702.md]
claims:
  - id: c1
    text: "The wiki writer rewrites the table-of-contents shards under `docs/wiki/wiki/toc/` with LF, but the repository has `core.autocrlf=true` and no `.gitattributes`. A shard the writer rewrote with unchanged content therefore stays reported as modified in `git status` even though `git diff` is empty and the blob hashes match; `git checkout -- <shard>` clears it until the next finalize."
    status: verified
    support: 0.92
    evidence: ["command: git status --porcelain docs/wiki/wiki/toc/architecture.md → 1 .M N... 100644 100644 100644 42377f4 42377f4 (HEAD and index blob hashes equal), while git diff -- <file> printed nothing and git diff --exit-code returned 0", "command: wc -c docs/wiki/wiki/toc/architecture.md → 11204 bytes (LF) before the re-checkout and 11232 bytes (CRLF) after it, a 28-byte difference for 28 lines", "command: git config core.autocrlf → true, and .gitattributes is absent from the repository", "command: git checkout -- docs/wiki/wiki/toc/{architecture,decisions,invariants}.md → git status --porcelain then printed nothing and the shards stayed clean"]
    reviewed: 2026-10-09
    last_checked: 2026-10-09
files: [src/wiki/toc.ts]
---

# Finalize leaves TOC shards that git reports as modified

**Symptom.** After a `wiki_finalize` — or any TOC refresh — `git status` lists shards under
`docs/wiki/wiki/toc/` as modified although the edit changed no page content. `git diff` prints
nothing for them, and `git diff --exit-code` exits 0. The shards keep showing as modified no matter
how many times `git status` or `git update-index --refresh` runs.

**Cause.** The writer creates the shards with LF line endings, while the repository is checked out
under `core.autocrlf=true` with no `.gitattributes`. The working-tree bytes therefore never match
what a checkout would produce, and git reports the file as modified even though the *content*
matches: `git status --porcelain=v2 <shard>` shows a `1 .M` line whose HEAD and index blob hashes
are identical, which is the signature of an ending mismatch rather than an edit. `git diff` applies
the clean filter, sees the same bytes it already has, and stays silent.

**Avoidance.** Restore what git expects before you stage anything. The index is untouched, so
nothing is lost:

```bash
git checkout -- docs/wiki/wiki/toc/
```

Then stage only the shards whose content actually changed. The trap disappears at the source with a
`.gitattributes` (`* text=auto`) plus a one-off `git add --renormalize .`, at the cost of a
repository-wide line-ending commit.

**Detection.** `git status --porcelain=v2 <shard>` reports `.M` with equal HEAD and index hashes
while `git diff -- <shard>` is empty. A genuine change always produces a diff, so trust the diff and
re-checkout the rest.

**Related.** [The table of contents hierarchy](table-of-contents.md) explains which artifacts the
writer produces and which of them are derived.
