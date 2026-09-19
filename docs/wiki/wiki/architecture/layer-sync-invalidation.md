---
title: Change-driven invalidation is O(diff)
type: architecture/layer
topic: architecture
summary: wiki_sync intersects changed paths with file-linked claims before any model call, so commits that touch nothing linked cost nothing.
tags: [sync, performance, invalidation, claims]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1734.md]
claims:
  - id: c1
    text: "wiki_sync intersects changed paths with each claim's linked files before any model call, so commits that touch nothing linked cost nothing."
    status: verified
    support: 0.95
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1734.md]
files: [src/sync.ts]
---

# Change-driven invalidation is O(diff)

**Responsibility.** The sync layer keeps the wiki consistent with code by diffing the repo since the last synced commit and checking only file-linked claims.

**Public surface.** `wiki_sync` tool; `SyncReport` with `changedFiles`, `matchedClaims`, and `impacts`.

**Dependencies.** Git helper (`changedFiles`, `diffForFiles`), page loader (`collectMappedClaims`), Jev client.

**Key files.** `src/sync.ts`

## Invariants

- If `changedFiles.length === 0`, sync returns immediately without model calls.
- Only claims whose `files` patterns intersect the diff are sent to Jev for impact assessment.
- The baseline is initialized on first run; subsequent runs diff from `lastSyncCommit` to `HEAD`.

## Failure modes

- If a claim omits `files`, it will never be matched by sync and can silently go stale.
- If `maxClaims` is exceeded, later-matched claims are silently skipped.

## Change impact

- Changes to `fileMatches` logic affect which claims are considered affected.
- Changes to `maxDiffChars` affect how much diff context Jev sees per claim.

## See also

- [pi extension module](module-pi-extension.md)
