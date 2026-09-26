# jev-wiki — Design Proposal

> A pi package that builds and maintains a Karpathy-style LLM wiki for a project, using
> **Jev (TypeSafe System One)** as the calibrated decision layer for truthfulness, placement,
> and maintenance.

Status: **v0.4** — [`PLAN.md`](plans/PLAN.md) is now the authoritative, decision-oriented document;
this file is the detailed technical appendix. Sections that changed with the 2026-09-19
resolutions (no injection, paged routing, agent-managed review, architecture-first pages) have
been reconciled below. [`CRITIQUE.md`](CRITIQUE.md) holds the risk analysis and resolution log.
Research artifacts: [`research/`](research/) (Jev docs, Karpathy gist, production lessons, pi API notes).

---

## 1. Refined idea in one paragraph

Karpathy's LLM wiki says: *the LLM writes the wiki, the human curates sources and asks questions.*
Jev cannot write prose — it returns **typed, calibrated decisions** (`noul`, `choice`, `score`).
So the refined system splits labor three ways:Bo

- **Jev = the gatekeeper/oracle.** Is this claim supported by its source? Does it contradict the
  wiki? Which page/topic does it belong to? Is it important enough to keep? Is the wiki drifting?
- **A generative LLM (pi's active model) = the scribe.** Extract candidate claims from raw sources,
  compose and merge wiki pages. It only writes what Jev accepted.
- **Code = the policy/branching layer.** Verbatim quote checks, thresholds, weighting,
  corroboration counting, supersession by date, index/log bookkeeping, file safety.

This mirrors TypeSafe's own guidance ("atomic questions composed in code", "code remains in control")
and makes the wiki cheap to maintain: Jev costs **$0.042/Mtok input, output free**, answers in
**70–500 ms**, and every answer carries a probability distribution.

---

## 2. Research findings

### 2.1 Jev — what it is and what it can do

Sources: [typesafe.ai launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[docs.typesafe.ai](https://docs.typesafe.ai/introduction), [AI/ML API schema](https://docs.aimlapi.com/api-references/decision-models/typesafe/jev),
[jaggedness page](https://docs.typesafe.ai/model-jaggedness/jev-1.13), local copies in `research/`.

- First **System One model**: unstructured `state` in, **typed probabilistic decisions out**.
  No text generation, no token-by-token decoding — outputs are generated in parallel. Claimed
  ~40–200× faster and ~450× cheaper than frontier LLMs on decision-shaped tasks.
- Trained with **Reinforcement Learning for Calibrated Decisions (RLCD)**. "Higher confidence means
  higher accuracy"; hallucination in the type/schema sense is impossible by construction.
- Models: `jev-1.13.0` (alias `jev-latest`). 64k context/request; **32k tokens for `state` +
  longest question**; text only; primary language English.
- Rate limits: **1,200 req/min, 250k tok/s** (dynamic). Errors: 401, 422, 429, 529 with backoff.

**Endpoints:**

- **TypeSafe direct (chosen):** `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`,
  64k context (32k state + longest question), token from project-root `.env` (`TYPESAFE_API_KEY`),
  loaded by `src/config.ts`.
- OpenRouter (config alternative): `POST https://openrouter.ai/api/alpha/decisions`, model
  `~typesafe/jev-latest` (floating) or `typesafe/jev-1.13` (pinned), 32k advertised context.
  Native TypeSafe schema verbatim; `/chat/completions` rejects decision models by design.
  Auth reuses pi's OpenRouter login via `ctx.modelRegistry.getApiKeyForProvider("openrouter")`
  (fallback `OPENROUTER_API_KEY`). Same price; `usage.cost` returned per call.

Request / response (exact shapes):

```jsonc
// Request
{
  "model": "jev-latest",
  "state": "text | {field: text, ...} | [text, ...]",   // the evidence to judge
  "questions": {
    "supported":  { "type": "noul",   "instructions": "The passage directly supports the claim.",
                    "criteria": { "true": "...", "false": "..." } },   // criteria optional
    "relation":   { "type": "choice", "instructions": "How does the passage relate to the claim?",
                    "criteria": { "supports": "...", "contradicts": "...", "says_nothing": "..." } },
    "importance": { "type": "score",  "instructions": "How durable is this knowledge?",
                    "criteria": ["ephemeral", "contextual", "durable", "canonical"] } // 2–10 levels
  }
}

// Response  (one answer per question key; choice/score also carry confidence)
{
  "model": "jev-latest",
  "answers": {
    "supported":  { "type": "noul",   "noul": 0.96 },
    "relation":   { "type": "choice", "choice": "supports", "confidence": 0.93,
                    "probabilities": { "supports": 0.93, "contradicts": 0.02, "says_nothing": 0.05 } },
    "importance": { "type": "score",  "score": 2.1, "confidence": 0.55,
                    "legend": { "0": "ephemeral", "1": "contextual", "2": "durable", "3": "canonical" },
                    "probabilities": { "0": 0.05, "1": 0.15, "2": 0.55, "3": 0.25 } }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

Operational facts that shape the design:

| Property | Value | Consequence |
|---|---|---|
| Question limits | up to 255 `choice` options; 2–10 `score` levels; questions limited only by token budget | paged-choice tournament: shard ≤250 per call, winners meet in a final call; batch many questions per call |
| Parallel questions | all questions judged independently against the same state | one call can verify dozens of claims ("speculative fan-out"); adding questions is nearly free |
| Cost | $0.042/Mtok in, output free | aggressive verification is economically trivial |
| Precision limits | no arithmetic/counting/date math; literal reading; accuracy drops with large irrelevant state; weak numeric calibration of scores | **filter evidence in code**, chunk claims, keep arithmetic/date logic in code |
| Adversarial content | state is not treated as hostile; injected instructions can steer answers | deterministic quote checks, explicit criteria, injection flag, human review for high-impact claims |
| No separate confidence on `noul` | distance from 0.5 is the signal | threshold in code (e.g. ≥0.9 yes, ≤0.1 no, else review) |

The official [citation-checking cookbook](https://docs.typesafe.ai/cookbooks/citation_check) is
essentially a prototype of our verification stage: exact quote match first, then a `choice`
question `supports / contradicts / says_nothing` with a 0.8 auto-accept threshold.

### 2.2 Karpathy's LLM wiki (the pattern we implement)

Source: [Karpathy's gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (copy in `research/`).

- Three layers: **raw sources** (immutable, source of truth) → **wiki** (LLM-owned markdown,
  interlinked, compounding) → **schema** (the instruction file that makes the LLM a disciplined
  maintainer, e.g. `AGENTS.md`; in pi this is a **skill**).
- Operations: **Ingest** (one source touches 10–15 pages), **Query** (index-first, cite pages,
  file good answers back), **Lint** (contradictions, stale claims, orphans, missing pages, data gaps).
- Navigation at moderate scale (~100 sources, hundreds of pages): `index.md` (content catalog) and
  `log.md` (append-only, `## [date] op | title` parseable by grep). No embeddings needed.
- "The tedious part is the bookkeeping… LLMs don't get bored." Maintenance cost ≈ 0 is the whole point.

Production lessons (from two live implementations + an extended pattern, see `research/`):

- Every load-bearing fact must be **locatable verbatim in `raw/`**; verify at compile time, re-check
  mechanically at lint time ("grounding invariant").
- Never silently rewrite history: mark **Outdated** / **Disputed** status blocks, cross-link pages.
- Knowledge has a **lifecycle**: confidence, corroboration count, recency, supersession, and
  forgetting. Flat markdown can carry this in frontmatter.
- `index.md` alone stops scaling around ~100–200 pages; then add hybrid search (qmd is the
  suggested local engine: BM25 + vectors + LLM rerank, CLI + MCP).
- Privacy gate on ingest (secrets/PII) and an append-only audit trail (`log.md` + git).

### 2.3 pi plugin mechanisms

Sources: local pi docs `docs/extensions.md`, `docs/packages.md`, `docs/skills.md`, examples.
(Note: `examples/plugins/` is the experimental Chord server/TUI facet system — **not** what we need.)

A pi "plugin" for this use case = a **pi package** (npm/git/local) with a `pi` manifest that can bundle:

- **Extensions** (TypeScript, hot-reloadable): `pi.registerTool()` (LLM-callable tools),
  `pi.registerCommand()` (`/wiki:*`), `pi.on(event)` (session/tool/agent hooks), `pi.appendEntry()`
  (session-branch-safe state), `ctx.ui` (review dialogs), `withFileMutationQueue()` (safe concurrent writes).
- **Skills**: `skills/*/SKILL.md` — pi's native equivalent of Karpathy's schema layer. Loaded
  on demand; can ship `references/` templates and helper scripts.
- **Prompts**: e.g. `/wiki-research`.
- **Nested LLM calls** from an extension: `ctx.modelRegistry.complete(model, {messages}, {signal})` —
  used by pi's own compaction example; enables an autonomous "auto" ingest mode.
- **Provider registration** (`pi.registerProvider`) is for chat providers; Jev's decisions API does
  not fit it, so Jev is integrated as an HTTP client inside the extension, not as a chat model.

pi-web-access (already installed in this environment) provides `web_search` / `fetch_content`
tools to the main agent, so URL sources can be fetched by the agent and handed to the wiki pipeline
as text — no duplicate fetching stack required in the extension.

---

## 3. Architecture

```
                       ┌────────────────────────────────────────────────────┐
  source               │  jev-wiki extension                                 │
  (file/URL/text/      │                                                     │
   session transcript) │  1. stage      normalize, hash, store raw/ (immutable)
        │              │                 chunk by headings, extract         │
        ▼              │                 candidate claims/quotes/entities    │
  ┌───────────┐        │                 (generative LLM, strict JSON)      │
  │  capture  │───────▶│                                                     │
  └───────────┘        │  2. retrieve   candidate pages/claims from TOC + search │
                       │                 (any size; sharded for routing)        │
                       │                                                     │
                       │  3. adjudicate JEV: grounded? conflict? novel?       │
                       │                 page type? topic? target page?      │
                       │                 importance? sensitivity? injection? │
                       │                 (batched fan-out, parallel)         │
                       │                                                     │
                       │  4. policy     code: thresholds, weights,           │
                       │                 corroboration, supersession,        │
                       │                 review queue (agent), ledger        │
                       │                                                     │
                       │  5. write      generative LLM composes/merges pages  │
                       │                 per skill templates (guided or auto) │
                       │                                                     │
                       │  6. finalize   index.md, log.md, link check,         │
                       │                 optional git commit, usage report    │
                       └────────────────────────────────────────────────────┘
                                 │                         ▲
                                 ▼                         │
                        wiki/ (markdown)     review-queue.jsonl · decisions.jsonl
```

### 3.1 Repository layout (this project)

```
jev-wiki/
├── package.json                 # "pi" manifest: extensions, skills, prompts
├── src/
│   ├── extension.ts             # entry: registers tools, commands, events
│   ├── config.ts                # global + project config, key resolution
│   ├── jev.ts                   # TypeSafe client: batching, fan-out, retries, usage
│   ├── wiki/
│   │   ├── layout.ts            # paths, frontmatter, atomic writes, mutation queue
│   │   ├── index.ts             # index.md + log.md maintenance
│   │   ├── search.ts            # index-first + grep/BM25; optional qmd adapter
│   │   └── links.ts             # link validation, orphan detection
│   ├── pipeline/
│   │   ├── stage.ts             # normalize, hash, chunk, extract (LLM)
│   │   ├── adjudicate.ts        # Jev question catalog + policy
│   │   └── write.ts             # guided brief / auto writer
│   └── lint.ts                  # deterministic + Jev judgment checks
├── skills/llm-wiki/
│   ├── SKILL.md                 # THE SCHEMA: conventions, workflows, quality rules
│   └── references/              # page templates: architecture/invariant/decision/impact/gotcha/glossary
├── prompts/wiki-research.md     # multi-source research into raw/, one compile at a time
└── research/                    # source material gathered for this design (can be moved out later)
```

### 3.2 Wiki layout (per project, configurable root)

```
<wikiRoot>/                      # default: docs/wiki  (git-committed, Obsidian-compatible)
├── raw/<topic>/YYYY-MM-DD-slug.md      # immutable; frontmatter: source, collected, published, sha256
└── wiki/
    ├── index.md                        # catalog grouped by topic: link · type · one-line summary · updated
    ├── log.md                          # append-only `## [YYYY-MM-DD] op | title` + disposition
    ├── disputes.md                     # optional global ledger; pages also carry Status blocks
    ├── architecture/                   # module-*.md · flow-*.md · layer-*.md
    ├── invariants/                     # invariant-*.md
    ├── decisions/                      # decision-*.md (ADR-style, supersession links)
    ├── impact/                         # impact-*.md (derived; refreshed by wiki_sync)
    └── <topic>/                        # gotcha-*.md · glossary-*.md · concept-*.md · summary-*.md
```

Page frontmatter carries the machine-readable truth ledger (enables Dataview and lint):

```yaml
---
title: Jev decision API
type: concept                  # summary | entity | concept | decision | procedure | comparison | synthesis | archive
topic: typesafe
sources: [raw/typesafe/2026-09-19-typesafe-docs.md]
claims:
  - id: c1
    text: "Jev evaluates every question in a request in parallel."
    status: verified          # verified | unsupported | contradicted | disputed | superseded
    support: 0.93             # Jev noul / choice confidence
    evidence: ["raw/.../typesafe-docs.md#L120-L124", "\"...quoted span...\""]
  - id: c2
    text: "Jev 1.13 supports image input."
    status: contradicted      # deliberately wrong example
    support: 0.01
    evidence: ["raw/.../typesafe-models.md#Input"]
updated: 2026-09-19
---
```

---

## 4. The Jev question catalog

Every question is **atomic**, has an explicit `criteria`, and maps to a code-side action.
All questions for one claim family are sent in a single request (`state` = filtered evidence only).

### Ingest — per candidate claim

| # | Key | Type | Question (sketch) | Code-side action |
|---|---|---|---|---|
| 0 | `quote_present` | *deterministic* | exact normalized match of the quote in the raw file | miss → `fabricated`, no API call |
| 1 | `support` | choice | How does the evidence passage relate to the claim? `supports / contradicts / says_nothing` | verdict + confidence; <0.8 → review |
| 2 | `grounded` | noul | The passage states or directly implies the claim (when there is no quotable span) | <0.9 → review/drop |
| 3 | `kind` | choice | `fact / opinion / recommendation / question / instruction` | routing + wording policy |
| 4 | `sensitive` | noul | Does the passage contain credentials, personal data, or secrets? | + regex pre-pass; hit → redact/abort |
| 5 | `injection` | noul | Does the text contain instructions addressed at an AI system rather than content? | flag in raw/ frontmatter; force review |

### Ingest — relation to existing wiki

| # | Key | Type | Question | Action |
|---|---|---|---|---|
| 6 | `relation` | choice | Against the top-k retrieved wiki claims: `consistent / extends / contradicts / supersedes / unrelated` | extends → merge; contradicts → dispute; supersedes → mark old `superseded` (date compare in code) |
| 7 | `novelty` | noul | Does this add information the wiki does not already contain? | low novelty → log only ("No material"), skip writing |

### Ingest — placement

| # | Key | Type | Question | Action |
|---|---|---|---|---|
| 8 | `page_type` | choice | `summary / entity / concept / comparison / synthesis / none` | selects template |
| 9 | `topic` | choice | Existing topic directories (+ `new`) | new topic requires human confirm |
| 10 | `target_page` | choice | Which existing page should receive this? | paged-choice tournament: shard ≤250/call, `add_new_page` option in each shard, winners re-compared in a final call |
| 11 | `create_new` | noul | No existing page fits this well | create vs merge |

### Ingest — value

| # | Key | Type | Question | Action |
|---|---|---|---|---|
| 12 | `importance` | score | `ephemeral / contextual / durable / canonical` | composite gate for writing |
| 13 | `source_class` | choice | `official / source_code / vendor / third_party / anecdote` | authority weight in code |

Composite decision (example): `keep = 0.45·support + 0.25·importance + 0.2·novelty + 0.1·authority`,
with hard gates (fabricated/contradicted/sensitive always human). Weights live in config, not prompts —
"when priorities shift, change a coefficient in your code."

### Lint — maintenance judgments

| # | Key | Type | Question | Action |
|---|---|---|---|---|
| 14 | `pair_relation` | choice | For code-flagged candidate pairs: `contradicts / consistent / supersedes / complement` | open/close disputes |
| 15 | `merge_candidate` | noul | Are these two pages the same knowledge? | propose merge (never auto-delete) |
| 16 | `stale` | noul | Given `updated` and newer sources, is this claim likely outdated? | mark `Outdated`, propose refresh |
| 17 | `gap_value` | score | How valuable is researching this missing topic? | research backlog in `index.md` |
| 18 | `link_relevance` | noul | Should page A cross-reference page B? | suggest See Also (human/agent applies) |

---

## 5. Operations

### 5.1 Ingest

Three modes, one pipeline (see [`PLAN.md`](plans/PLAN.md) §3 for the full trade-offs):

- **Guided (default)** — Karpathy-style, transparent:
  `wiki_ingest` stages the source, runs Jev, and returns a **brief**: accepted claims with
  verdicts/confidences, placement plan, disputes opened, items sent to review. The main agent
  (following the `llm-wiki` skill) writes/merges pages with the normal `write`/`edit` tools, then
  calls `wiki_finalize` to update `index.md`/`log.md` and validate links.
- **Auto** — for backfill/batch: `wiki_ingest({mode:"auto"})` runs extraction **and** writing with
  nested `ctx.modelRegistry.complete()` calls, gated by Jev, then finalizes. Returns a summary and
  review queue. Only pages that pass the policy gate are written.
- **Draft** — auto writes into `.jev-wiki/drafts/<ingest-id>/`; nothing publishes until the agent or
  user reviews the diff and promotes it with `wiki_finalize`.

Pipeline guarantees:

- raw/ is immutable and content-hashed → re-ingest is idempotent (`sha256` short-circuit).
- Every load-bearing fact is validated verbatim against raw/ **before** it is written (grounding invariant).
- Contradictions never overwrite: old claim gets `status: superseded|disputed` + link to the new source.
- Shared state (`index.md`, `log.md`) writes are serialized with `withFileMutationQueue()`;
  compile is sequential even when extraction/Jev calls run in parallel.
- Optional `git add/commit` per ingest (config `gitCommit: true`) → free audit trail.
- Tool result `details` carry the full decision record (branch-safe session state).

### 5.2 Query

`wiki_ask` → index-first + search → returns ranked page excerpts with citations; the agent answers.
`wiki_file` (or "file this answer") crystallizes a synthesized answer as an `archive` page, gated by
`file_worthwhile` (noul) so chat noise doesn't pollute the wiki.

### 5.3 Lint

`/wiki:lint` or `wiki_lint`:
- **Deterministic, auto-fix**: index consistency, broken internal links, missing raw refs, orphans,
  raw backlog. (Modeled on the production skill in `research/astrohan-SKILL.md`.)
- **Jev judgment, report + queue**: contradiction pairs, stale claims, merge candidates, missing
  entity pages, coverage gaps. Auto-fix only when confidence ≥ threshold; otherwise review queue.

### 5.4 Session capture (pi-native)

`/wiki:capture` asks the agent to compose a list of key insights from the session, then calls
`wiki_insights`. Jev organizes them into the existing wiki: `grounded`, `derivable_from_code`,
`durable`, `verifiable`, `already_known`, `relation` (both directions), `page_type`,
`target_page` (paged tournament), `topic`, `importance`, `criticality`, `sensitive`, `action`.
Reinforcement bumps corroboration; sessions are stored as ordinary raw sources with evidence
pointers. Full refinement in [`PLAN.md`](plans/PLAN.md) §5. Optional `session_before_compact` hook and
`agent_settled` auto-capture (off by default). **Nothing is injected into sessions** — the TOC is
surfaced like a skill (`wiki_toc` + the `llm-wiki` skill) and the agent consults it on demand.
The review queue is worked by the agent (`wiki_review`); the user is escalated only for critical
items. See [`PLAN.md`](plans/PLAN.md) §§4–5.

---

## 6. Truth model (what "truthful" means here)

Jev cannot browse the world and is not a fact-checker against reality. It judges **groundedness and
consistency** given evidence. So the wiki's notion of truth is deliberately layered:

1. **Provenance** — every claim points at a verbatim span in an immutable raw source.
2. **Groundedness** — Jev says the source supports it (calibrated probability, not a vibe).
3. **Corroboration** — code counts independent supporting sources per claim; more sources ⇒ higher confidence.
4. **Consistency** — Jev checks against existing wiki claims; disagreement is *recorded*, not resolved silently.
5. **Authority** — source class weighted in code (official docs > source code > vendor blog > third party).
6. **Recency/supersession** — date math in code; newer sources supersede older claims explicitly.
7. **Agent review & user escalation** — the agent resolves queue items using Jev's verdicts and
   risk scores; only critical items (security, breaking APIs, data loss, high blast radius) reach
   the user. Every decision is logged in the ledger.

This is why disputes are first-class: a wiki that silently picks a winner is worse than one that
shows both claims, their sources, and their confidence.

---

## 7. Configuration

Global `~/.pi/agent/jev-wiki.json`, project `<cwd>/.pi/jev-wiki.json` (project trusted only):

```json
{
  "provider": "typesafe",
  "baseUrl": "https://api.typesafe.ai/v1/systemone",
  "apiKey": "$TYPESAFE_API_KEY",
  "envFile": ".env",
  "model": "jev-latest",
  "wikiRoot": "docs/wiki",
  "globalWikiRoot": null,
  "writer": { "model": null, "mode": "guided" },
  "routing": { "shardSize": 250, "minFit": 0.6, "newPageConfidence": 0.7 },
  "review": { "mode": "agent", "autoAcceptUserStated": true, "escalateCriticality": 0.85, "maxPerSession": 10 },
  "sync": { "onSessionStart": "check", "onCommit": false, "backstopLintDays": 14 },
  "thresholds": {
    "autoAccept": 0.8,
    "minSupport": 0.7,
    "minNovelty": 0.6,
    "reviewBelow": 0.8,
    "minImportance": 1
  },
  "weights": { "grounded": 0.45, "importance": 0.25, "nonDerivable": 0.2, "authority": 0.1 },
  "authority": { "official": 1.0, "source_code": 0.95, "vendor": 0.8, "third_party": 0.6, "anecdote": 0.4 },
  "privacy": { "redactPatterns": true },
  "toc": { "maxTokens": 3000 },
  "gitCommit": false,
  "capture": { "onCompact": false, "onSettle": false },
  "search": { "engine": "index", "qmdCollection": null }
}
```

`apiKey` supports `$ENV_VAR` indirection and `.env` loading; switching to OpenRouter (or AI/ML
API) is a `provider`/`baseUrl`/`model` config change in `src/jev.ts`. Keys are never written to
project files; `.env` is gitignored.

---

## 8. Tool surface (v1)

| Tool / command | Purpose |
|---|---|
| `wiki_toc` | the wiki table of contents (filterable by topic/tag); how the agent discovers knowledge |
| `wiki_ingest` | stage + adjudicate a source; guided brief or auto write |
| `wiki_insights` | agent-authored insight list → adjudication + placement |
| `wiki_impact` | what a change touches: dependents, invariants, tests, owners |
| `wiki_sync` | diff since last sync → `impact` verdicts → recheck queue |
| `wiki_review` | agent works the review queue; criticality-gated user escalation |
| `wiki_finalize` | commit TOC/log/link updates after guided writing |
| `wiki_ask` | TOC-first retrieval + cited excerpts |
| `wiki_file` | crystallize an answer as an `archive` page |
| `wiki_lint` | deterministic fixes + Jev judgment report |
| `wiki_status` | pages, sources, disputes, review queue, ledger, Jev usage |
| `wiki_configure` | show/set wiki root, thresholds, key presence (no secrets echoed) |
| `/wiki:capture`, `/wiki:sync`, `/wiki:review`, `/wiki:lint`, `/wiki:status`, `/wiki:ask` | user-facing commands |
| `llm-wiki` skill | schema/conventions + when to consult the TOC |

---

## 9. Failure modes and mitigations

| Risk | Mitigation |
|---|---|
| Jev reads instructions literally / wrong | exact `instructions` + `criteria`; split ambiguous questions in two and combine in code |
| Counting/math/date errors | never ask Jev; extract components (choice) then compute in code |
| Accuracy drop on large noisy state | filter first; verify in small claim+evidence batches; never dump whole documents |
| Adversarial source steers Jev | deterministic quote check, injection noul, explicit criteria, review for high-impact claims |
| Schema/type errors | structurally impossible from Jev; extraction JSON is validated in code |
| LLM extraction misses/misquotes | quote must exist verbatim in raw or claim is rejected; extraction prompt is strict JSON; Jev is the second opinion |
| Wiki rot (stale/orphan/duplicate) | lint with Jev judgments; status frontmatter; supersession instead of silent edits; forgetting curve in v3 |
| Privacy leak | regex + `sensitive` noul gate before raw/ write; redact and log |
| index.md too big at scale | optional qmd adapter (BM25+vector+rerank, CLI/MCP); graph in a later phase |
| Cost blowup | Jev is ~free; the writing LLM is gated to accepted claims; `wiki_ingest` reports tokens/cost |

---

## 10. Phased roadmap

The authoritative phases and acceptance criteria are in [`PLAN.md`](plans/PLAN.md) §9. Summary:

- **P0 — walking skeleton (both channels):** package/config/.env, Jev client, architecture-first wiki
  layout + TOC, guided `wiki_ingest`, `wiki_insights` (with `derivable_from_code`), ledger, baseline
  metrics, `wiki_toc` + skill (no injection).
- **P1 — currency, scale, agent review:** file-linked claims + `wiki_sync` invalidation, paged
  routing, `wiki_review` with criticality escalation, `wiki_lint`, decision-quality eval harness.
- **P2 — autonomy:** draft/auto writers with agent-selected modes from risk scores, automated
  capture hooks, structure scan, corroboration/supersession.
- **P3 — scale and reach:** qmd hybrid search, hierarchical TOC, consolidation, global vault.

---

## 11. Decisions locked (2026-09-19)

1. **Jev access** — TypeSafe direct (`POST /api/v1/systemone`, `jev-latest`, 64k context) with the
   token in a project-root `.env`. OpenRouter's Decisions API remains a config switch.
2. **Wiki location** — inside the user's project workspace (default `docs/wiki/`), mechanism shipped
   as a pi package.
3. **Writing mode** — ship all three (`guided` default, `draft`, `auto`); the agent may choose per
   item from Jev's `risk`/`criticality`; users are escalated only for critical items.
4. **Session capture** — the agent composes the insight list; Jev filters (`derivable_from_code`,
   `durable`, `verifiable`) and routes (`action`, placement); sessions become ordinary raw sources
   with evidence pointers.
5. **Scale** — paged-choice tournament (shards ≤250, final comparison over winners); tiered search
   index → BM25 → qmd. Jev cost stays negligible at every tier.
6. **Package name** — `jev-wiki` (open). Distribution via local path or git initially.

Next: P0 walking skeleton per [`PLAN.md`](plans/PLAN.md) §8.
