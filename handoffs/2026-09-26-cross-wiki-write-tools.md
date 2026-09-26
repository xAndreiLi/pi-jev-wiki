# Handoff — cross-wiki write tools, plus adjacent tooling pain points

**Date:** 2026-09-26
**Repo:** `C:\Coding\pi-jev-wiki` @ v0.7.1
**Requested by:** Andrei (via an agent session in `C:\Users\liand\docs\life\calisthenics`)
**Status:** not started

**How to read this:**

- **§1–§9** — one feature: a `wiki` parameter on the write tools. Agreed with Andrei; ready to
  implement.
- **§10** — **a separate backlog** of 12 pain points hit while using the tooling in anger. Not part
  of the §1 feature; triage them on their own merits. §10.8 and §10.4 are the cheapest and would
  help immediately; §10.5 is the highest-value fix in the whole document.
- **§11** — a closing note about this file's own provenance.

---

## 1. The ask

Let the **write** tools target a wiki other than the current workspace's, one wiki per call.
Reads already work cross-wiki; writes do not.

Concretely, an agent working in project A should be able to:

```
wiki_finalize(pages: ["procedures/foo.md"], note: "...", wiki: "home")
```

…and have that update `home`'s TOC, log, and ledger — not project A's.

## 2. Why this matters (real incident)

During a session rooted at `C:\Users\liand\docs\life\calisthenics`, the agent needed to document
tooling findings in Andrei's global life wiki (`C:\Users\liand\docs\wiki`, registered as `home`).

- **Reading worked:** `wiki_ask wikis: ["home"]`, `wiki_toc scope: "all"`, and
  `wiki_index action=rebuild wiki=home` all functioned.
- **Writing did not.** The agent had to hand-write the page, then **reverse-engineer the TOC
  generator** — reproducing the existing `toc.md`, `index.md` and `toc/<topic>.md` byte-for-byte
  before trusting it, and reimplementing `entriesHash` (`src/wiki/manifest.ts:44`) to regenerate
  `toc.json` — and append a log entry by hand.

That is a lot of duplicated, fragile machinery for something the tooling should own. The hand-written
path also **skips Jev adjudication entirely** (no ingest, no claim gating, no ledger entry), so the
filed claims were never verified.

## 3. Current behaviour, with evidence

Everything resolves through one function — `src/extension.ts:74`:

```ts
function runtimeFor(ctx: ExtensionContext): Runtime {
	const loaded = loadConfig(ctx.cwd);
	return { loaded, layout: resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot) };
}
```

There is **no override parameter**. All 14 tool handlers call `runtimeFor(ctx)`.

Root resolution precedence (already implemented, no change needed):

1. project config `<cwd>/.pi/jev-wiki.json` → `wikiRoot`
2. else global config `~/.pi/agent/jev-wiki.json` → `wikiRoot`
3. else `DEFAULT_CONFIG.wikiRoot` = `"docs/wiki"`

Relevant handler line numbers (v0.7.1):

| Tool | Line | Write? |
| --- | --- | --- |
| `wiki_ingest` | `src/extension.ts:1146` | ✅ |
| `wiki_insights` | `src/extension.ts:1225` | ✅ |
| `wiki_finalize` | `src/extension.ts:1273` | ✅ |
| `wiki_sync` | `src/extension.ts:1382` | ✅ |
| `wiki_review` | `src/extension.ts:1435` | ✅ |
| `wiki_remove` | `src/extension.ts:1583` | ✅ |
| `wiki_lint` | `src/extension.ts:1534` | ✅ (auto-fix) |
| `wiki_status` / `wiki_toc` / `wiki_ask` / `wiki_structure` / `wiki_doctor` / `wiki_triage` / `wiki_setup` | 864 / 901 / 1012 / 1632 / 1875 / 2009 / 1892 | read-only |
| `wiki_index` | `src/extension.ts:1649` | already takes `wiki` — **the precedent to follow** |

Note `globalWikiRoot` (`src/config.ts:34`) is **not** the mechanism: `doctor.ts:122` describes it as
`"global vault … (read-only cross-project search)"`, and `globalLayoutFor()` (`src/extension.ts:96`)
is consumed only by `wiki_ask` at `src/extension.ts:1032`.

## 4. Design decisions (already agreed with Andrei)

1. **One wiki per call.** A single call must never span two wikis — `wiki_finalize` writes one
   TOC/log/ledger, and mixing targets would produce ambiguous entries. Reject `pages` that resolve
   outside the selected wiki (the existing `outside the wiki` guard already does this).
2. **Targeting by registered name**, matching `wiki_index`'s existing `wiki` param — not by raw
   path. Names are stable and already surfaced by `wiki_toc scope: "all"`.
3. **Default unchanged.** Omitting `wiki` keeps today's behaviour exactly.
4. **Read tools are out of scope** — they already handle cross-wiki via `scope` / `wikis`.

## 5. Implementation plan

### 5.1 Resolve the target root

Add an optional name to `runtimeFor` (or a sibling helper, so `runtimeFor` stays cheap for the
read-only tools):

```ts
async function runtimeFor(ctx: ExtensionContext, wikiName?: string): Promise<Runtime> {
	const loaded = loadConfig(ctx.cwd);
	if (wikiName) {
		const registry = await readRegistry(loaded.agentDir);
		const entry = registry.wikis.find((w) => w.name === wikiName);
		if (!entry) {
			throw new Error(
				`Unknown wiki "${wikiName}". Registered: ${registry.wikis.map((w) => w.name).join(", ") || "(none)"}`,
			);
		}
		return { loaded, layout: resolveLayout(entry.root, ".", loaded.config.stateRoot) };
	}
	return { loaded, layout: resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot) };
}
```

Helpers already exist in `src/vector/registry.ts`:

- `readRegistry` (`:29`) — read the name → root registry
- `normalizeRoot` (`:48`) — canonicalise paths for comparison
- `wikiNameFor` (`:55`) — derive a stable name from a root
- `registerWiki` (`:71`) — register a root
- **`resolveWikiRoot` (`:104`)** — resolve a filesystem path to a real wiki root (reads the project's
  `.pi/jev-wiki.json` and probes `wiki/`, `docs/wiki/`), throwing a clear error when none is found.

Prefer `resolveWikiRoot(entry.root)` over trusting `entry.root` verbatim, mirroring the existing
defensive pattern at `src/extension.ts:1813` and `:1834`:

```ts
const root = await resolveWikiRoot(entry.root).catch(() => entry.root);
```

Note `runtimeFor` is currently **synchronous** — if you make it async, update all 14 call sites (or
add a separate async helper and leave the read-only path untouched).

Consider auto-registering on first use via the existing `registerWiki()` (`registry.ts:71`) so a
configured-but-never-indexed wiki still resolves. Decide deliberately and document it.

### 5.2 Add the parameter

Same shape as `wiki_index`'s existing definition:

```ts
wiki: Type.Optional(Type.String({ description: "Registered wiki name to target (defaults to the current wiki)" })),
```

Add to: `wiki_ingest`, `wiki_insights`, `wiki_finalize`, `wiki_sync`, `wiki_review`, `wiki_remove`,
`wiki_lint`.

### 5.3 ⚠️ Path resolution — the trap

`resolvePagePath` (`src/extension.ts:2263`) tries **`ctx.cwd` first**:

```ts
const candidates = [
	isAbsolute(page) ? page : resolve(cwd, page),   // ← current workspace wins
	resolve(layout.wikiDir, page),
	resolve(layout.root, page),
];
```

So a cross-wiki `wiki_finalize` can silently pick up a *different* file that happens to exist at the
same relative path in the current workspace, or report a page as missing when it exists in the
target.

**When `wiki` is supplied, resolve against the target root only** — pass the target root as the
`cwd` base, or drop the first candidate.

The same class of bug exists in `wiki_ingest`, which resolves its `path` as
`resolve(ctx.cwd, params.path)` at `src/extension.ts:1168`. A file living in another project cannot
currently be ingested by relative path. Decide the intended semantics for `path` + `wiki` together
and cover it with a test.

### 5.4 TOC / ledger isolation

Each wiki root carries its own `.jev-wiki/` (ledger, review queue, raw index, `toc.json`) and its own
`raw/`, `wiki/`. Because the layout object drives all of it, resolving the target layout is
sufficient — **no data-model change is required.** Verify this holds for:

- `wiki_ingest` → target `raw/<topic>/` + target ledger
- `wiki_finalize` → target TOC, `log.md`, target ledger, and the vector index `sync.onFinalize`
- `wiki_remove` → target page + target TOC shard (see the 0.7.1 fix for shard pruning)
- `wiki_lint` auto-fix → must not repair the *current* wiki when another is targeted

## 6. Tests

`scripts/unit-test.ts` — offline, no network, no API key. Style:

```ts
await check("name of the behaviour", async () => { /* assert */ });
```

Run with `npm run test:unit`; full gate is `npm run test:all` (also runs `tsc --noEmit`).

Suggested coverage:

1. `runtimeFor(ctx, "home")` resolves the registered wiki's root, not `ctx.cwd`'s.
2. Unknown wiki name throws a message listing registered names.
3. Omitting `wiki` reproduces current behaviour (guard against regression).
4. **`resolvePagePath` prefers the target wiki's file over a same-relative-path file in `ctx.cwd`.**
5. `wiki_finalize(wiki: X)` writes only X's TOC/`log.md`/ledger; the current workspace's are
   untouched.
6. A `pages` entry that resolves outside the target wiki is reported broken, not silently written.

Use `mkdtemp` temp roots as the existing tests do.

## 7. Docs to update in the same change

- **`skills/llm-wiki/SKILL.md`** — the skill states it is the *only* schema documentation. Document
  cross-wiki writes and when to reach for them. (There is an explicit convention in this repo to
  update the skill whenever the schema/fields change — follow it.)
- **`README.md`** — the tool table (`:55`–`:59`) and the cross-wiki section around `:175`, which
  currently frames `globalWikiRoot` as search-only. Add the write-side story.
- **`CHANGELOG.md`** — new `### Added` entry under a new version heading, matching the existing
  format (`## 0.7.1 — 2026-09-26`).
- **`docs/wiki/`** — consult it first (`wiki_toc`) and file the design decision there as an
  architecture/decision page once implemented.

## 8. Out of scope

- Changing root-resolution precedence.
- Making `globalWikiRoot` writable (different feature; `scope: all` already covers discovery).
- Cross-wiki *moves* or merges of pages.
- Read tools — already covered by `scope` / `wikis`.

## 9. Verification checklist

- [ ] `npm run typecheck` clean
- [ ] `npm run test:all` green, new tests included
- [ ] Manually finalize a page into a second wiki from a workspace rooted elsewhere; confirm the
      target's `log.md`/`toc.json`/ledger changed and the current workspace's did **not**
- [ ] Confirm the `ctx.cwd` path-resolution trap is closed by test #4
- [ ] Version bumped; `CHANGELOG.md` entry added
- [ ] `skills/llm-wiki/SKILL.md` + `README.md` updated

## 10. Adjacent pain points from real use

All of these were hit during the session that produced this handoff. Each has a symptom, the
evidence, and a suggested fix. Sizes are rough.

### The unifying observation

**Root/target resolution is duplicated in at least three places, and each one assumes "the current
session's wiki":**

1. the write tools (`runtimeFor`, `src/extension.ts:74`) — §1
2. session-insight capture (routes briefs to the session root, not the subject wiki) — §10.1
3. `wiki_ask`'s global-vault scope (`src/extension.ts:1032`)

A single "resolve target wiki" concept, defaulted to today's behaviour, would fix all three rather
than patching each. Worth designing before implementing.

---

### 10.1 Session insights route to the session root, not the subject wiki

**Symptom.** Auto-captured session briefs land in whichever wiki the *session* is rooted at,
regardless of what the work was about.

**Evidence.** Two consecutive auto-generated briefs from this session were filed against a
calisthenics root while describing `pi-jev-wiki` internals — e.g. 7 of 8 claims in one brief were
about `runtimeFor`'s signature, config precedence, and `resolvePagePath`. Filing them would have put
another project's internals in a calisthenics wiki.

**Suggestion.** Infer the subject wiki (touched-file git root, or explicit hint), or at minimum
surface a mismatch so the agent can redirect instead of declining in chat. Note this is **not fixed**
by adding a `wiki` param to the write tools — capture needs its own target resolution.

**Size.** Medium. **Priority.** High — it silently produces wrong-topic knowledge.

---

### 10.2 `wiki_ingest` renames the source, leaving a duplicate

**Symptom.** The managed copy gets a name derived from the document title, while the file you
passed stays where it was. Two copies of one source, under different names.

**Evidence.** Ingesting `raw/calisthenics/2026-09-26-recommended-routine-guide.md` produced
`raw/calisthenics/2026-09-26-recommended-routine-rr-r-bodyweightfitness.md`. Cleaning up the
duplicate, the agent **destroyed the managed copies twice** by guessing which was which.

**Suggestion.** Return the managed path prominently in the brief (it is mentioned, but buried);
consider moving rather than copying; or warn when the destination name already exists.

**Size.** Small. **Priority.** Medium — this actively caused two destructive mistakes.

---

### 10.3 Nothing re-verifies a raw source's recorded hash

**Symptom.** A recorded hash and the stored bytes can diverge with no signal from any tool.

**Evidence.** After normalising line endings, `sha256(body)` no longer matched the recorded key and
**nothing reported it** — not `wiki_lint`, not `wiki_doctor`. The only check that noticed anything
was lint's *filename-based* raw backlog.

**Suggestion.** Add a `wiki_doctor` check that re-hashes raw sources and reports drift. It is cheap,
and it would have caught the CRLF bug immediately instead of by accident.

**Size.** Small. **Priority.** Medium.

---

### 10.4 CRLF silently breaks dedup

**Symptom.** The same logical content hashes differently depending on line endings, so dedup stops
matching. Python's default text mode on Windows and most Windows editors emit CRLF.

**Evidence.** `const hash = await sha256Hex(safeText)` (`src/extension.ts:416`) hashes the text as
read, with no newline normalisation. Observed directly: a CRLF source failed to dedup against the
LF re-scrape of identical content, and vice versa.

**Suggestion.** Normalise `\r\n` → `\n` before hashing, or warn when a source contains CRLF. This is
a high-leverage one-liner for a Windows user.

**Size.** Tiny. **Priority.** High.

---

### 10.5 "Ungrounded" rejections carry no diagnostic

**Symptom.** A claim is rejected as `not grounded in evidence` with no indication of what evidence
would have satisfied the check.

**Evidence.** This was the single largest source of wasted effort in the session — roughly **14
claims overridden** across one ingest run. Nearly all *were* stated in the source, but as
syntheses: e.g. "Pull-up + Squat" is never written as such; it is a `### First Pair` heading plus
two bullets. The agent's only options were to guess, or to override.

**Suggestion.** Include the closest matching passage, or a similarity score, in the rejection
reason. Then the remedy the skill prescribes ("attach evidence that states the claim") becomes
actionable instead of a guess. `wiki_triage` exists for this, but it is retrospective and only
mentioned in the skill.

**Size.** Medium. **Priority.** High — it is the main friction in the core loop.

---

### 10.6 Two revisions of one source produce phantom contradictions

**Symptom.** Holding an archived and a live revision of the same document makes the
contradiction checker flag a claim against its own near-duplicate.

**Evidence.** Review item `muhuljjd-f0549b` flagged "progressions instead of external load" as
`contradicts existing knowledge` at **criticality 0.80**. The sentence is character-identical in
both revisions.

**Suggestion.** Skip pairs whose claim text is near-identical, or detect revision pairs of the same
source. Keeping both revisions is genuinely valuable (it is how upstream drift was found), so the
fix belongs in the checker, not in guidance to avoid revisions.

**Size.** Small–medium. **Priority.** Medium.

---

### 10.7 No disposition for "wrong wiki / out of scope"

**Symptom.** Declining a claim that belongs to a different project records nothing.

**Evidence.** 7 claims were declined as out-of-scope for the filing wiki; that decision exists only
in chat. The review vocabulary is accept/reject/supersede/defer — none expresses "correct claim,
wrong target".

**Suggestion.** A `wrong_topic` (or `wrong_wiki`) disposition that records the decline and can
suggest a target. Otherwise the same claims get re-proposed on every future capture pass.

**Size.** Small. **Priority.** Medium.

---

### 10.8 `wiki_review list` is capped by a *resolution budget* config

**Symptom.** The list silently truncates, hiding item IDs needed for bulk resolution.

**Evidence.** `listOpenReviews(layout, loaded.config.review.maxPerSession)`
(`src/extension.ts:1454`), and `review.maxPerSession` defaults to **10** (`src/config.ts:84`). With
**32 open items**, the list showed 10 — forcing four re-list cycles to collect IDs. `maxPerSession`
is documented as a per-session *resolution* budget, not a display limit; the same value is doing both
jobs.

**Suggestion.** Separate display from budget; add an explicit `limit` param; and report
`showing 10 of 32` so the agent knows to keep going.

**Size.** Tiny. **Priority.** High (cheapest fix on this list).

---

### 10.9 Bulk resolution is ID-only

**Symptom.** Resolving ~40 review items required collecting and passing explicit ID lists.

**Suggestion.** Allow resolving by predicate — e.g. all items whose reason matches
`below auto-accept threshold`. Pairs with 10.8.

**Size.** Small. **Priority.** Low.

---

### 10.10 Ingest briefs are verbose, with no up-front cost signal

**Symptom.** Briefs run 4–6 KB each with heavy repetition, and nothing indicates cost before a
multi-document ingest.

**Evidence.** Ingesting **8 documents** produced ~40 review items and drove the session to
~**950 K Jev input tokens**. Briefs describe every claim; nothing warns that cost scales with
(documents × claims).

**Suggestion.** A compact/summary-first brief mode, and a claim-count or token estimate surfaced
before the first document of a batch so the agent can choose to split the work.

**Size.** Small. **Priority.** Medium.

---

### 10.11 Frontmatter round-trips, so what you write isn't what is stored

**Symptom.** Edits fail to match text that the tool itself re-serialised.

**Evidence.** Two `edit` attempts failed because serialization rewrote `support: 0.90` → `support: 0.9`
and dropped redundant quoting around `text:`. Each failure required re-reading the file.

**Suggestion.** Either preserve the author's literal scalars, or document the normalisation in
`skills/llm-wiki/SKILL.md`. The skill already warns about block-style lists; the scalar round-trip
is not mentioned and is just as likely to bite.

**Size.** Small. **Priority.** Low (but cheap to document).

---

### 10.12 Self-inflicted: `wiki_triage` was not reached for

Worth recording honestly. When rejections started piling up, the agent overrode them one by one
instead of running `wiki_triage` for the score ranges and a concrete remedy. The tool existed and
would have helped — it is only mentioned in the skill, not surfaced in the brief that was producing
the problem.

**Suggestion.** When a run produces many rejections, have the ingest brief point at `wiki_triage`.

**Size.** Trivial. **Priority.** Low.

## 11. Note for whoever picks this up

The person who wrote this handoff **could not use the wiki tooling in this repo** — that is the bug.
So this document is plain markdown in `handoffs/`, deliberately outside the wiki, and carries no
ledger entry or Jev adjudication. If you want the design decision recorded properly, ingest this file
once the feature exists:

```
wiki_ingest(path: "handoffs/2026-09-26-cross-wiki-write-tools.md", title: "Cross-wiki write tools", topic: "decisions")
```

…which would be a fitting first real use of the feature.

**Evidence provenance:** line numbers are from the installed `src/extension.ts`, which was verified
byte-identical to this repo's at v0.7.1 on 2026-09-26. Re-check them before editing.
