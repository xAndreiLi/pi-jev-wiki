# Handoff — vector index upsert conflict, and evidence excerpts of gitignored files

**Date:** 2026-10-01 · **Repo:** `C:\Coding\pi-jev-wiki` · **Version:** 0.8.1 (the installed copy matches the
repo; lines read at `12a88a3`, re-grep before editing) · **Requester:** Andrei, from a discord-assistant session
— *"Just make a quick note of this wiki issue … I will solve this later."* · **Status:** not started

## How to read it

- **I1 — the ask.** A wiki's semantic index cannot be rebuilt: the chunk upsert conflicts with itself.
  Priority medium (search silently goes stale), size small.
- **I2 — fix first.** `file` evidence copies up to 3,500 characters of the cited file into the ledger *and into
  what is sent to Jev*, gitignored files included, and `redact()` misses environment-style secrets. A Discord bot
  token left the machine this way. Priority **high (credentials)**, size small. Found on the way; not what was
  asked about.

## I1 — `ON CONFLICT DO UPDATE command cannot affect row a second time`

**The ask.** Rebuilding a wiki in which one page yields the same chunk key twice succeeds, and the collision is
reported with its page and key instead of aborting the batch.

**Why.** The discord-assistant index has been stale since 2026-10-01 ~09:35 local. `wiki_finalize` reports
`Semantic reindex skipped: ON CONFLICT DO UPDATE command cannot affect row a second time`, and
`wiki_index action=rebuild wiki=discord-assistant` fails with the same message. Earlier finalizes that day
reindexed normally.

**Current behaviour, with evidence.**

- `src/vector/db.ts:176–185` — all rows go into one multi-row `INSERT INTO wiki_chunks … VALUES (…), (…)
  ON CONFLICT (wiki, path, key) DO UPDATE …`. Postgres/PGlite rejects a statement that would update the same
  conflict key twice (SQLSTATE 21000), so one duplicate fails the whole batch.
- `src/vector/chunks.ts:44` — claim key `claim:${claim.id ?? slugify(text).slice(0, 48)}`; `:59` — section key
  `section:${section.slug}`. Two claims with one id, two id-less claims whose first 48 slug characters match, or
  two headings that slugify alike in one page produce the duplicate.
- A real duplicate existed: `docs/wiki/wiki/architecture/architecture-speaker-attribution.md` held two `c6`
  claims, written by two sessions (renumbered to `c15` in discord-assistant `c4f795a`). **The rebuild still fails
  after that fix**, so another duplicate remains — not located. A candidate to rule in or out:
  `docs/wiki/wiki/log.md` repeats headings verbatim (several `## [2026-10-01] capture | 6 insights (tool)`), but
  those repeats existed while indexing still worked.

**Implementation plan.** Dedupe `rows` by `path + key` before building the placeholders (last wins) and log what
collided — or make keys unique per page in `chunks.ts` (`#2`, `#3` on repeats). Duplicate claim ids are a real
authoring error, so `wiki_lint` (or `wiki_finalize`) flagging them would catch the case at its source.

**The wrong turn.** Catching the error and skipping the reindex — what finalize does now — leaves every page of
the wiki stale without saying which one is at fault.

**Tests.** A page with two `c6` claims and two identical headings indexes without error, and chunks that did not
change keep their keys (so they are not re-embedded).

**Verification.** `wiki_index action=rebuild wiki=discord-assistant` succeeds; finalize stops printing
`Semantic reindex skipped`.

## I2 — `file` evidence copies gitignored files, secrets included, into the ledger and to Jev

**What happens.** `src/extension.ts:160` `buildInsightEvidence` — for each `file` evidence item it reads the file
(~line 172) and appends `excerptAroundTerms(content, insight.text, 3500)` (~173). That text is stored in
`.jev-wiki/decisions.jsonl`, which discord-assistant tracks in git. `redact()` (~189) strips secrets, not private
content, and nothing checks whether the cited file is ignored.

**Incident.** discord-assistant's assistant persona runs its own pi session, which filed insights citing its
private memory files (`memory/wiki/people/*.md` — gitignored because they hold other people's details). The
ledger received excerpts of those files, and two unpushed commits (`63892fc`, `136a47f`) carried them before
anyone noticed — the page diffs were clean. The content is not repeated here.

**It reaches credentials too.** Two insights cited `.env` as `file` evidence (one filed by an agent, one by task
capture citing a file the session had edited). The excerpt carried `DISCORD_TOKEN=<the token>`, which went into
the ledger — caught before any push — and, because `evidenceText` is what `adjudicateClaim` and `chooseTarget`
receive (`src/extension.ts:646` onward), to the Jev API in at least two submissions (2026-10-01 12:52 and 13:40
UTC). The token is being rotated in discord-assistant.

**Why `redact()` missed it.** `src/redact.ts:29` —
`/\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]…/gi`. The `\b` needs a word boundary before `token`,
and in `DISCORD_TOKEN=` the underscore is a word character, so there is none: every `PREFIX_TOKEN=`,
`PREFIX_API_KEY=` or `PREFIX_SECRET=` line — i.e. most `.env` files — passes unredacted. A prefix-tolerant
form such as `/\b[A-Z0-9_]*(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN)\s*[:=]…/gi` closes that; a test with
`DISCORD_TOKEN=` and `OPENROUTER_API_KEY=` lines should pin it.

**Suggestion.** Never excerpt `.env*` files; for a `file` item whose path is gitignored (`git check-ignore`) or
outside the tracked tree, store the path and a content hash, not an excerpt — or make excerpting opt-in per
wiki. Excerpts go to a third-party API, so this is about more than git.

**Stopgap in discord-assistant.** Its `.pi/jev-wiki.json` capture cadence is `manual` until this is fixed;
switch it back to `task` afterwards.

## Out of scope

- Cleaning discord-assistant's history — that decision is Andrei's, in that project.
- discord-assistant has since stopped the persona's writes into its developer wiki (its session now runs in its
  own memory wiki); I2 still matters for any wiki whose evidence can cite ignored files.

## Provenance

Written by the discord-assistant pi session on 2026-10-01. **Verified:** the upsert statement and the key formats
(source at `12a88a3`, 0.8.1), the excerpting in `buildInsightEvidence` and its use in `adjudicateClaim` /
`chooseTarget`, the `redact.ts:29` pattern, the token's presence in two ledger entries (checked by value, never
printed), and both index error messages (from `wiki_finalize` and `wiki_index rebuild` in discord-assistant).
**Not verified:** whether TypeSafe retains request bodies. **Not verified:** which page still carries a
duplicate key, whether `log.md` is chunked at all, and whether other wikis hit I1.
