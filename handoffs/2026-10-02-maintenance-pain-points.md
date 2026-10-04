# Handoff — maintenance pain points, 2026-10-02

**Date:** 2026-10-02 · **Repo:** `C:\Coding\pi-jev-wiki` (maintenance also touched `discord-assistant`) ·
**Context:** Andrei — *"begin fixing the semantic index for all wikis"*, then *"run wiki sync and document any
pain points"* · **Status:** notes only; nothing here is started

## What this maintenance did

- Landed the screenshot capability in discord-assistant: `3367373` (script, skill, wiring, tests),
  `2eca739` (wiki).
- Found the user-level vector store unopenable, deleted it, rebuilt all seven registered wikis
  (1,385 chunks; `wiki_index status` → `database: ok`).
- Ran `wiki_sync` (`fd88e40 → 12a88a3`): 103 changed files, 26 file-linked claims, 10 applied as
  `needs_recheck`, the rest `no_impact`.

## P1 — A preservation instruction lived only in a page, and maintenance deleted the artefact

**Observed.** `gotcha-silent-search-degradation.md` carried, since 2026-10-01: *"It is deliberately
preserved … Do not rebuild it before that diagnosis."* On 2026-10-02 the store no longer opened
(`PANIC: could not locate a valid checkpoint record at 0/246FC18`), and it was deleted and rebuilt.
`wiki_ask` had surfaced the page — its snippet did not carry the instruction, and the page was not read
before acting. The deeper toast diagnosis the store was kept for is now impossible.

**Fix direction.** Preserved artefacts need a marker where maintenance reads state, not only in a page
body: `wiki_index status` could report `store preserved for diagnosis (see gotcha-silent-search-degradation.md)`.
A cheap first version: a `PRESERVED.md` convention inside the data directory, checked by status.

**Priority** medium · **Size** small · **Irreversible loss already occurred** (only the panic text
survives, in `gotcha-corrupt-vector-store-recovery.md` and the session raws).

## P2 — `wiki_ask` silently ignores a nonexistent scope parameter

**Observed.** `wiki_ask` takes `wikis: [...]`, not `wiki: "<name>"`. Passing `wiki:` answers from the
local wiki, tagged and scored like a real result set (2026-10-02: a query meant for
`discord-assistant` returned three local pages at 0.44–0.48; the same query with
`wikis: ["discord-assistant"]` returned the intended page at 0.65). This is the same failure shape as
the swallowed-fallback gotcha, through a different door.

**Fix direction.** Reject unknown parameters, or accept `wiki` as an alias for `wikis: [name]`.
Documented for now in `gotcha-silent-search-degradation.md`.

**Priority** low · **Size** trivial.

## P3 — Cross-wiki `wiki_finalize` paths are not the project path

**Observed.** For `wiki: "discord-assistant"`, `docs/wiki/wiki/architecture/x.md` fails with
`Broken links: … (missing)`; the path must be relative to the target wiki root
(`wiki/architecture/x.md`). The error reads as a broken link, not a convention mismatch. Already
documented in discord-assistant's working-in-this-repo page; it still cost a call.

**Fix direction.** Accept both forms, or say "path is outside the wiki — expected wiki/<topic>/<page>.md".

**Priority** low · **Size** small.

## P4 — Incident claims cannot be grounded by command output

**Observed.** Two submissions of the vector-store recovery claim were rejected `reject_unsupported`
with grounded 0.48 and 0.64, derivable ~0.2. Triage's fix hint asks for a `source`, `commit`, `file`
or `user` quote; `invariants/claim-evidence.md` admits only raw source / file / commit / test. The
session raw is an admissible `source` and contains the captured trace, so the recipe is
`kind: "source", ref: "raw/sessions/<file>.md", quote: "<trace line>"` — but nothing says so at
capture time, and the page was filed with a recorded override instead.

**Fix direction.** (a) Have the capture pipeline map command evidence into a source quote from the
session raw automatically; (b) mention the source-from-raw recipe in the reject hint. Clarified for
now in `invariants/claim-evidence.md`.

**Priority** medium · **Size** small.

## P5 — `wiki_index rebuild` blocks with no intermediate output

**Observed.** Rebuilding one wiki took 33–238 s; `all=true` would have been one silent ~10-minute
call. Per-wiki calls were used instead, which kept the 60–240 s check-in cadence the project asks for.
`memory`, `discord-assistant` and `pi-jev-wiki` root their indexes at directories containing raw
session transcripts, so their chunks are large and slow (196 chunks in 238 s, 319 in 181 s, 248 in 98 s
versus 126 in 33 s for home).

**Fix direction.** Per-wiki progress lines (or a background mode) from `rebuild all=true`.

**Priority** low · **Size** small.

## P6 — `wiki_sync` backlog turns one batch into ten rechecks

**Observed.** 21 commits since the last baseline → 103 changed files → 26 matched claims → 10
`needs_recheck` queued in one pass. Every claim in `gotcha-eval-harness-leaks.md` about the pre-fix
harness now needs reading against the fixes.

**Fix direction.** Run sync after each substantive batch of commits; treat the queue as a sitting
rather than a side effect. The 10 items are open.

**Priority** low · **Size** none (process).

## Cross-references

- The dead store's last open (2026-10-01 ~09:47) overlaps the failed-upsert window in
  `handoffs/2026-10-01-index-upsert-conflict-and-ignored-file-excerpts.md` (I1). The fresh
  discord-assistant rebuild succeeded on 2026-10-02, so I1 did not reproduce against the new store;
  I2 there (credentials copied into file evidence sent to Jev) is untouched by this maintenance and
  still open.
- Recovery procedure and panic evidence: `docs/wiki/wiki/architecture/gotcha-corrupt-vector-store-recovery.md`.
- Silent-degradation mechanics and the new current state:
  `docs/wiki/wiki/architecture/gotcha-silent-search-degradation.md`.
