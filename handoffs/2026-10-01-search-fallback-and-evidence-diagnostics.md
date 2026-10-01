# Handoff — silent search degradation, vector-index corruption, and evidence diagnostics

**Date:** 2026-10-01
**Repo:** `C:\Coding\pi-jev-wiki` @ 0.8.1 (working tree, not a release)
**Found by:** an agent session in this repo, while writing `docs/plans/EFFICACY.md`
**For:** Andrei, to triage when he has time — this is a bug report, not a work request
**Status:** not started — nothing below has been changed, fixed, or worked around. The corrupt
index is deliberately left in place; see §9.

**How to read this:**

- **§1** — the headline: semantic search is currently broken and every layer reports success.
  Three bugs stack here (§2, §3, §4); fixing only one of them will not restore search.
- **§5** — a separate diagnostic gap that cost this session four failed submissions and produced a
  wrong explanation in a wiki page. Independent of §1; cheap to fix.
- **§6** — a minor bookkeeping bug with a self-inflicted repro.
- **§7** — a friction log: what the tooling communicated versus what was true, in the order it cost
  this session time. Different in kind from the bugs above — these are usability defects, and some
  are consequences of §2–§6 rather than separate faults.
- **§8–§13** — evidence, settled decisions, suggested fixes, out of scope, verification.
- Line numbers are from the working tree on 2026-10-01 and will drift.

---

## 1. The headline

Right now, on this machine, **`wiki_ask` with the default engine cannot retrieve semantically, and
nothing in the tool output, the metrics, the ledger, or the doctor says so.**

The chain, each part verified separately below:

1. The PGlite vector database is corrupt — reads of some rows throw
   `missing chunk number 0 for toast value <n> in pg_toast_<n>` (§3).
2. `HybridSearchEngine` wraps both retrieval halves in `.catch(() => [])`
   (`src/wiki/search.ts:364-367`), so the vector half's exception becomes an empty candidate list
   and RRF returns lexical-only results — with **no note, no ledger entry, and no metric flag**
   (§2).
3. The lexical half searches the session wiki only, so `wikis: [...]` and `scope: "all"` are
   silently discarded along with the vector half (§4).
4. `wiki_index status` reports `database: ok`, `wiki_doctor` reports `16 ok · 0 warn · 0 fail`, and
   `metrics.jsonl` records `"engine":"bm25+vector"` for the runs that were actually lexical.

Observed consequence: four cross-wiki queries against the `home` and `calisthenics` wikis returned
pi-jev-wiki pages, tagged `[pi-jev-wiki]`, with no warning that the requested scope had been
abandoned. Reproduced on demand (§8.1).

---

## 2. Bug A — the hybrid engine swallows vector failures

**Where:** `src/wiki/search.ts:361-369`

```ts
async search(options: SearchOptions): Promise<SearchResult[]> {
	const limit = options.limit ?? 5;
	const candidateLimit = Math.max(limit, limit * 3);
	const [lexical, semantic] = await Promise.all([
		this.lexical.search({ ...options, limit: candidateLimit }).catch(() => [] as SearchResult[]),
		this.vector.search({ ...options, limit: candidateLimit }).catch(() => [] as SearchResult[]),
	]);
	return rrfFuse([lexical, semantic], this.rrfK).slice(0, limit);
}
```

**What happens.** Any vector-side failure — corruption, a cold model, a missing index, a provider
error — is indistinguishable from "the vector index had nothing to contribute." RRF then returns
lexical results ranked as if they had won a fusion.

**Why it matters.** The degradation is *correct* in intent (results still come back) but
*undetectable* in effect. The tool result carries no note, so the agent cannot tell that its query
was answered by keyword matching. Compare the explicit `search: "semantic"` path, which
`VectorSearchEngine` does not wrap: there the failure surfaces and
`src/extension.ts:1108` adds `Semantic search failed (...); used keyword search instead.` The
hybrid path, which is the **default** (`search.engine: "auto"` → hybrid when a vector engine
exists, `src/wiki/search.ts:261`), has no equivalent.

**Corollary — the metric is wrong too.** `src/extension.ts:1175` records
`detail: { engine: engine.name }` using the engine that was *constructed*, not the one that
produced the results. So `metrics.jsonl` reports `bm25+vector` for runs that were lexical-only.
Tally of all 25 `ask` entries (§8.3): `bm25+vector` ×20, `index` ×2, `none` ×2, `vector` ×1. Those
20 entries are not evidence that hybrid retrieval worked; they are evidence that the engine object
was hybrid.

**Suggested fix.** Let the vector half report its own failure instead of collapsing to `[]`:
collect a per-half status, and when the vector half fails, (a) append a note to the tool output,
(b) record the *effective* engine in the metric, and (c) mark the fallback in the ledger. The
degradation behaviour can stay; the silence should go.

---

## 3. Bug B — the PGlite vector index is corrupt, and nothing checks it

**Evidence.** Two calls with an explicit semantic request both threw:

```
Semantic search failed (missing chunk number 0 for toast value 50140 in pg_toast_16712); used keyword search instead.
Semantic search failed (missing chunk number 0 for toast value 50157 in pg_toast_16712); used keyword search instead.
```

Different toast values on consecutive calls, same toast relation — a corrupted TOAST table
affecting multiple rows, not a single bad record.

**Scope of the index.** One user-level PGlite database for all registered wikis
(`~/.pi/agent/jev-wiki/vector`, 63 MB), six wikis registered, all six showing `quality 1024d`
chunks with recent `updated` timestamps:

```
- home — C:/Users/liand/docs/wiki — 115 chunks, quality 1024d, updated 2026-09-30T22:54:46Z
- pi-jev-wiki — C:/Coding/pi-jev-wiki/docs/wiki — 170 chunks, quality 1024d, updated 2026-10-01T05:42:13Z
- card-sorter, cultivation-game — //wsl.localhost/Ubuntu/... — 101 / 245 chunks
- calisthenics — C:/Users/liand/docs/life/calisthenics — 149 chunks
- discord-assistant — C:/Coding/discord-assistant/docs/wiki — 69 chunks
```

**Nothing detects it.**

- `wiki_index status` prints `database: ok`, which reflects that PGlite opened, not that rows read
  back.
- `wiki_doctor` has no vector-database check at all — grep for `toast|integrity|vacuum|corrupt`
  across `src/vector/*.ts` and `src/doctor.ts` returns only the *raw source* hash check.
- `wiki_finalize` reindexed 15 chunks successfully at `2026-10-01T05:42:13Z`, ~2 minutes before the
  first failed read. **Writes work; some reads do not.** A rebuild is therefore not obviously
  required to make writes succeed — see §11 before running one.

**Not established.** When the corruption began, what caused it, and whether a rebuild clears it.
Two hypotheses worth checking, neither tested:

1. **Concurrent access.** `vectorDbFor` (`src/vector/db.ts:286`) caches one handle *per process*;
   PGlite is an embedded single-writer database in a shared user-level directory. Two pi sessions
   (interactive + this one, or a WSL-rooted session alongside a Windows one) opening the same
   directory concurrently is a plausible corruption source. Worth checking whether any session
   holds the DB open while another writes.
2. **Interrupted write.** The 0.8.0 changelog mentions atomic-write hardening for wiki files; the
   vector DB may not have equivalent protection.

---

## 4. Bug C — cross-wiki scope is silently dropped whenever the vector half is unavailable

**Where:** `src/extension.ts:1076-1094` selects `scopeWikis` and passes it **only** into
`vectorSearch`:

```ts
const wikis = params.wikis?.length ? params.wikis
	: params.scope === "all" ? enabledWikiNames(currentRegistry)
	: [registration.name];
scopeWikis = wikis;
vectorEngine = new VectorSearchEngine((query, count) =>
	vectorSearch(loaded.agentDir, loaded.config, query, { limit: count, wikis }),
);
```

The lexical engine is built from `layout` alone (`src/wiki/search.ts:271-281`), so it can only ever
return the session wiki (plus the global vault, which is not configured here). With the vector half
empty — for any reason — a request for another wiki returns **local results presented as if they
answered the question**. `scopeWikis` is consulted only to build a hint when the result list is
*empty* (`src/extension.ts:1123-1136`), which is exactly the case that does not occur here, because
lexical search almost always returns something.

**Aggravating detail.** The tool description says `wikis` is for "explicit registered wiki names to
search (**semantic mode**)" — so the parameter is documented as semantic-only, but the failure mode
when semantic mode is unavailable is a silent fallback to the wrong scope rather than an error.
An agent reading the results has no way to know.

**Suggested fix.** When `params.wikis` or `scope: "all"` is supplied and the vector half fails or
is cold, say so explicitly in the tool output — e.g. `requested wikis: home; searched: pi-jev-wiki
(vector unavailable — see wiki_index status)`. Refusing with a clear message is better than
answering a different question.

---

## 5. Bug D — an unresolvable file evidence ref is invisible to the agent

**Where:** `src/extension.ts:166-175` (`buildInsightEvidence`)

```ts
if (item.kind === "file") {
	files.push(item.ref);
	const absolute = isAbsolute(item.ref) ? item.ref : resolve(cwd, item.ref);
	if (existsSync(absolute)) { /* read + excerpt */ }
	else { parts.push(`file: ${item.ref} (not found)`); }
}
```

The `(not found)` marker goes into the text handed to Jev and then vanishes. The brief the agent
receives says only `[unsupported] … not grounded in evidence`, with no indication that the evidence
was never read.

**This actually happened in this session.** Four submissions of one claim were rejected with
groundedness 0.09–0.31. The cause was a wrong path in *my own* evidence: I cited
`node_modules/@earendil-works/pi-coding-agent/docs/message-types.md`, which exists in the **global**
npm install but not in the repo-local one — verified:

```
$ ls node_modules/@earendil-works/pi-coding-agent/docs/message-types.md
ls: cannot access '...': No such file or directory
$ ls node_modules/@earendil-works/pi-coding-agent/docs/*.md | wc -l
30        # docs/ exists; message-types.md is not among them
```

Because the failure was silent, I diagnosed it as "Jev cannot ground citations from installed
packages" and wrote that explanation into
`docs/wiki/wiki/architecture/flow-eval-substrate.md`. That explanation is wrong. The evidence
resolver behaved correctly; it just never told me the refs were missing.

**Also worth noting:** `command` evidence kind is not resolved at all — it falls through to the
final `else` branch and is passed to Jev as text (`command: <ref>` plus the quote). Whether that is
intended is unclear; if it is, the evidence-format documentation should say so, because
`wiki_triage` currently recommends `kind=source` and `kind=commit` as the ways to ground a claim,
and `kind=command` is not listed.

**Suggested fix.** Return the list of unresolved refs in the brief — e.g.
`1 evidence ref not found: node_modules/...` — and record it in the ledger entry for the
adjudication. This is a few lines and would have saved this session's four cycles.

---

## 6. Bug E — same-session retries count as recurrences

**Where:** `src/sessionlog.ts` — `countRecurrence`, `promoteRecurring` (default `minimum = 3`)

Every attempted filing of a rejected candidate is appended to `session-log.jsonl`, and
`promoteRecurring` groups entries by text similarity with no `session` dimension, so N retries
inside **one** session read as "recurred N times."

**Repro from this session:** one claim, retried four times over ~20 minutes, produced:

```
- `mup3w3tb-3d1d7f` · claim_review · criticality 0.50
  reason: recurred 3 times without filing; needs a stronger artifact or a decision
```

`grep -c 'control arm is a CLI switch' docs/wiki/.jev-wiki/session-log.jsonl` → **6** entries.

**Why it matters.** The promotion rule exists to catch facts that keep surfacing across sessions
and never get filed — a real documentation gap. Counting retries within one session inflates that
signal and queues review items that represent nothing but an agent iterating. Low severity, but it
pollutes the review queue, which is the one queue that must stay trustworthy.

**Suggested fix.** Deduplicate by session when counting recurrence (store or derive a session id
per entry), and require occurrences in at least two distinct sessions.

---

## 7. Friction log — what the tooling said versus what was true

Ordered by the cost it imposed in this session, not by severity. Items F1–F4 and F7 are
consequences of the bugs above; F5, F6, F8 and F9 are independent usability defects; F10 is mine to
own.

**Net cost of this friction, in one session:** four wasted adjudication cycles, one incorrect wiki
page plus its correction, one false review-queue item, one near-miss false finding about a wiki's
contents, and a wrong theory of how the grounding pipeline works. The session's purpose was to
reason carefully about measurement quality, which is the point worth noticing.

### F1 — A failed retrieval is indistinguishable from an empty wiki

`wiki_ask` answered four cross-wiki queries from the wrong wiki, tagged each result `[pi-jev-wiki]`,
assigned scores, and reported no problem. I was one step from writing "Andrei's life wiki has no
page about this project's goals" into `docs/plans/EFFICACY.md` as a finding. What prevented it was a
separate probe (`wiki_toc wiki="home"`, which does work) rather than anything the search told me.

This is the highest-consequence item in this document. An agent's default reading of a low-recall
result set is "the knowledge isn't there" — which is exactly the wrong conclusion, and one that
leads to re-deriving knowledge the wiki already holds. See §2 and §4.

### F2 — Four cycles lost to a silent evidence ref

An insight citing a path that does not exist produced identical feedback each time:
`not grounded in evidence`. Diagnosing it required guessing. Cost: four submissions, six
`session-log.jsonl` entries, one false review item, one wrong wiki page, and a written explanation
("Jev cannot ground installed-package citations") that was itself false and is now part of this
session's record. See §5.

### F3 — Rejection messages name the verdict, not the defect

Three different causes produce the same sentence: (a) the ref did not resolve; (b) the ref resolved
but the quoted passage is not in it; (c) the ref and quote are fine and Jev still judged the passage
unsupported. `wiki_triage` correctly told me these were "evidence problems, not policy problems" —
the single most useful diagnostic this session — but it aggregates by class and cannot say *which
of my four evidence items* was the problem. A per-item line (`ref resolved: no`) would have
collapsed four cycles into one.

### F4 — Scores carry no stable meaning across engines

Observed in one session: `score 0.015`–`0.016` for three different keyword queries; `score 1.000`
for the results returned while search was silently broken; `score 1.000` again for exact lexical
hits. The *highest* scores on this machine accompanied the *worst* retrieval path, and because the
score is not labelled with the engine that produced it, the number cannot be used to judge result
quality at all.

### F5 — Three sources describe `wiki_ask` differently, and the true contract is only discoverable by experiment

- The tool's registered description: "Search the project wiki …" — no mention of cross-wiki search.
- `AGENTS.md`: cross-wiki *reads* work (`wiki_ask` with `scope: "all"` or `wikis: [...]`).
- The parameter schema: `wikis` — "Explicit registered wiki names to search (semantic mode)".

The last is the trap. "Semantic mode" reads as "when the semantic engine is available", which it
was (the index is warm, six wikis indexed, `database: ok`) — the parameter is in fact honored only
when the semantic *search* succeeds, which it never did. The failure is then silent (§4).

### F6 — Nothing preflights an evidence ref

There is no read-only way to ask "would these refs resolve?" before spending an adjudication. A
validation mode on `wiki_insights` — or ref pre-flight inside the brief — would have caught F2
before the first submission rather than the fourth.

### F7 — The review queue reported something untrue

`recurred 3 times without filing; needs a stronger artifact or a decision` was generated by my own
retries within one session (§6). I did not trust it — the claim had obviously come from my own
attempts — but an agent without that context would have inferred a documentation gap and acted on
it. A queue is only worth its cost if its items are individually true; noise here devalues every
other item in it.

### F8 — Two copies of pi's documentation, with no way to tell which is authoritative

What eventually caused F2: pi's docs exist in the global npm install and in the repo-local
`node_modules`, and they are not the same set — the local copy has a `docs/` directory with 30
markdown files, but not `message-types.md`, which exists only in the global install. Nothing in a
session surfaces which install a doc came from, or which one matches the running version.

### F9 — The `handoffs` skill does not cover this shape

The skill is written for cross-project handoffs and says explicitly not to write one for your own
project ("Do not use it to avoid asking"). Recording findings in the project's own `handoffs/` for
the owner to triage later is a legitimate third case, and this document is an instance of it. The
next agent asked to do the same should not refuse on the skill's authority — but the skill should
say so.

### F10 — The catalog is longer than the display budget (minor, and partly mine)

The first `wiki_toc` call returned the full local catalog and was truncated by the client's output
limit before the end of it. I lost the tail and did not re-read it. `toc.maxTokens` exists for
exactly this; the observation is that the default catalog is not scannable in one call when the
wiki is this size, so an agent under budget pressure will read half a catalog and move on.

---

## 8. Evidence

### 8.1 Cross-wiki scope silently ignored

```
wiki_ask(wikis: ["home"], query: "working style collaboration decisions", limit: 3)
→ 3 results, all tagged [pi-jev-wiki]
   Notes: Semantic search failed (missing chunk number 0 for toast value 50140 in pg_toast_16712);
          used keyword search instead.
```

Earlier, same behaviour for `scope: "all"` and for `wikis: ["home", "calisthenics"]` — all four
queries returned only `[pi-jev-wiki]` pages. `wiki_toc wiki="home"` works correctly and lists the
home wiki's nine pages, so registration and reading are fine; only search scope is affected.

### 8.2 Index state

`wiki_index action=status` — six wikis, all `quality 1024d`, `database: ok`.
`wiki_doctor` — `16 ok · 0 warn · 0 fail`; no vector-database check exists.

### 8.3 Metrics tally (`docs/wiki/.jev-wiki/metrics.jsonl`)

```
total ask entries: 25
by recorded engine: {"bm25+vector": 20, "index": 2, "none": 2, "vector": 1}
first: 2026-09-19T21:42:01Z   last: 2026-10-01T05:45:54Z
```

Recorded engine reflects the constructed engine object, not the effective retrieval path (§2), so
this tally cannot establish how long search has been degraded.

### 8.4 Evidence resolution

See §5 — `ls` output showing the cited path does not exist in the repo-local install.

---

## 9. Decisions already made

Settled with Andrei on 2026-10-01, so they are not relitigated by whoever picks this up:

- **The corrupt vector index stays in place.** No rebuild, no deletion, not now. Rebuilding would
  most likely clear the symptom and destroy the only evidence of the cause, which could then recur
  unnoticed. Diagnosis happens in a dedicated triage session, ideally after bugs A and C (§2, §4)
  make failures visible while work is being done on them.
- **The vector database directory is left untouched** (`~/.pi/agent/jev-wiki/vector`, 63 MB) so the
  corruption can be examined rather than replaced.
- **Bug D (§5) is the cheapest fix and the recommended first one** — it is what made this session's
  evidence problem invisible for four cycles.
- **Nothing in this document has been implemented.** The findings are recorded, not acted on.

---

## 10. Suggested order

1. **Bug D** (§5) — smallest change, unblocks future diagnosis. Report unresolved evidence refs in
   the brief.
2. **Bug A** (§2) — stop swallowing the vector half's failure; surface it in the note, the metric,
   and the ledger. This is what turns §3 from invisible into obvious.
3. **Bug C** (§4) — make an unsatisfiable cross-wiki request fail loudly rather than answering from
   the local wiki.
4. **Bug B** (§3) — after A and C make failures visible, diagnose the corruption. At minimum, add a
   DB read-back check to `wiki_doctor` and stop reporting `database: ok` from an open alone.
5. **Bug E** (§6) — session-aware recurrence counting.

---

## 11. Out of scope — including the obvious-but-wrong turn

- **Do not "just rebuild the index" first.** `wiki_index action=rebuild` would very likely clear the
  immediate symptom and destroy the only evidence of the corruption, leaving the cause (concurrent
  access? interrupted write?) unexamined and free to recur. This was Andrei's call on 2026-10-01
  (§9); the corpus stays as it is. If a future session must rebuild, copy
  `~/.pi/agent/jev-wiki/vector` aside first.
- Not investigated: the corruption's origin, whether it affects all six wikis or only the
  pi-jev-wiki rows, and whether a second reading process is involved.
- Not investigated: whether `search.engine: "auto"` should keep defaulting to hybrid for a
  user-level index that is shared by every registered wiki.
- Unrelated but noted in passing: `docs/plans/README.md` and the wiki pages were already modified in
  the working tree before this session started.
- Deliberately not changed: nothing in this document has been fixed. Two wiki pages were written
  this session (`architecture/flow-eval-substrate.md`, `decisions/eval-mechanism-metric.md`) as part
  of the measurement plan; the first required a correction because of Bug D.

---

## 12. Verification checklist

- [ ] `wiki_ask(wikis: ["home"], query: …, search: "semantic")` returns `[home]` results — currently
      throws.
- [ ] With the vector half forced to fail, the tool output states the effective engine and the
      requested-vs-searched wiki names.
- [ ] `metrics.jsonl` records the engine that produced the results, not the constructed one.
- [ ] `wiki_doctor` can detect a corrupt vector row without running a query.
- [ ] An insight citing a nonexistent file path reports the unresolved ref in the brief.
- [ ] Three retries of one rejected claim in one session do not create a "recurred 3 times" review
      item.

---

## 13. Provenance

Written by an agent session in this repository on 2026-10-01 at Andrei's request, as a record for
him to triage later. All commands above were run on this machine against the working tree at 0.8.1;
every quoted error string is verbatim. Nothing was fixed, and no rebuild, write, or mutation was
performed as part of writing this document.

What I did **not** verify: the cause of the corruption; whether a rebuild repairs it; whether other
wikis' rows are affected; whether hybrid searches before 2026-10-01 were ever vector-backed. Where
this document reasons beyond observation it says so explicitly (§3, §11).

One correction to the record, so it is not repeated: an earlier claim in this session — that "Jev
cannot ground citations from installed packages" — was wrong, and was a consequence of Bug D rather
than a property of the grounding pipeline. See §5.
