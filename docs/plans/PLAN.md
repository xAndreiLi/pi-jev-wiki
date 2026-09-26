# jev-wiki — Implementation Plan

> **What this is:** a pi package that builds and maintains the **mental model of a project** — how
> the system is shaped, why, and what a change touches — so coding agents make better decisions on
> large codebases. **Jev** (TypeSafe's System One decision model, accessed directly via a
> project-root `.env` token) is the calibrated arbiter and reminder for truth, placement,
> invalidation, and maintenance; pi's agent writes and has the final say; code owns every threshold
> and every number.
>
> **Companion docs:** [`CRITIQUE.md`](../CRITIQUE.md) (risks + resolutions, efficiency evaluation, Jev
> expansion) · [`DESIGN.md`](../DESIGN.md) (detailed design) · [`research/`](../../research/README.md)
> (primary sources: Jev docs, Karpathy's gist, production lessons, pi API notes).

---

## 0. TL;DR

- **The bet.** Agents are good at local code tasks and bad at large-project decisions — where a
  change belongs, what it breaks, which invariants hold, why the system is shaped this way. That is
  a *framing* problem: the code has the details but not the frame. The wiki is the maintained
  frame.
- **What it stores:** architecture-level knowledge — module responsibilities, dependency direction,
  data flow, invariants and boundaries, decisions with rationale, change-impact maps, gotchas,
  glossary. **What it refuses to store:** anything derivable from the code in under a minute
  (`derivable_from_code` gate). The wiki is not a second copy of the repo.
- **Split of labor:** Jev advises as arbiter and reminder, the agent decides and writes, code
  enforces thresholds and safety. Jev generates no text;
  it returns `noul` (truth probability), `choice` (pick one, ≤255 options + distribution), and
  `score` (position on a rubric + distribution).
- **Two intake channels, one pipeline:** (A) user-requested **research intake**; (B) **agent
  insights** captured after work — the agent composes a list of key insights, Jev organizes them
  into existing pages or, failing that, new ones.
- **No injection.** The wiki is never pushed into a session. Its **table of contents is available
  like a skill** (`wiki_toc` + the `llm-wiki` skill), and the agent reads what it needs, when it
  needs it.
- **The agent maintains the wiki; the user adds knowledge.** Review queues are worked by the agent,
  with Jev's risk ranking visible to the agent. The user is only brought in for critical items
  (security, breaking APIs, data loss, high blast radius).
- **Access:** TypeSafe direct — `POST https://api.typesafe.ai/v1/systemone`, `jev-latest`, 64k
  context — token in a gitignored `.env`. OpenRouter stays available as a config switch.

---

## 1. The vision: a maintained mental model for agent decisions

### 1.1 Why agents fail at scale

An agent can read any file but cannot hold a 200k-line system in context. Without a frame it
optimizes locally: it puts logic in the wrong layer, duplicates an existing abstraction, violates
an unwritten invariant, or reopens a decision that was settled six months ago for good reasons.
Search finds *code*, not *intent*, *boundaries*, or *consequences*. Human teams solve this with
architecture docs, ADRs, and tribal knowledge; agents get none of it, or get stale fragments.

The wiki's job is to be that frame, kept current with near-zero marginal cost because Jev makes
the judgment parts cheap and code does the bookkeeping.

### 1.2 The quality bar for every page

Two tests, applied at intake and at lint:

- **Delete test:** if the page were deleted, would the agent just re-read the code and be fine?
  If yes, it is a duplicate — don't file it.
- **Decision test:** does this page help decide **where a change belongs** or **what a change
  breaks**? If it doesn't inform a decision, it's trivia.

Pages that pass are the ones the repo cannot answer cheaply: rationale, synthesis across sources,
boundaries and invariants, historical attempts, external constraints, and the map of what depends
on what.

### 1.3 Page types (architecture-first)

| Page | Question it answers | Typical content |
|---|---|---|
| `architecture/module-*` | what is this module for? | responsibility, public surface, dependencies, invariants, key files |
| `architecture/flow-*` | how does X get from A to B? | end-to-end data/control flow with entry points and hand-offs |
| `architecture/layer-*` | what is allowed to depend on what? | boundaries, direction of dependency, forbidden edges |
| `invariant-*` | what must always be true? | constraints, validation rules, security/perf guarantees |
| `decision-*` | why is it this way? | ADR-style: context, options, choice, consequences, supersedes |
| `impact-*` | if I change X, what breaks? | derived dependents, tests, owners, migration notes |
| `gotcha-*` | what bites people? | footguns, flaky areas, non-obvious coupling |
| `glossary-*` / `entity-*` | what does this word mean here? | domain terms → code entities, people, services, jobs |
| `concept-*` | how does this idea work? | synthesized understanding across sources |
| `summary-*` | what did this source say? | per-source summary (secondary; research channel) |

Implementation details are deliberately absent. A module page points at files; it doesn't
reproduce them.

### 1.4 Decision-time workflows (how the wiki actually helps)

| Moment | Tool | What happens |
|---|---|---|
| Starting a task | `wiki_ask` / `wiki_toc` | agent reads the frame: relevant module/flow/decision pages |
| Planning a change | `wiki_impact` | "what depends on X?" — dependents, invariants, tests, owners |
| Before editing | `assumption_check` (Jev) | agent's plan/assumptions checked against documented decisions and invariants |
| During review | `plan_conflict` (Jev) | flags plans that contradict settled decisions |
| Finishing | `answer_grounded` (Jev) | the agent's summary is checked against the evidence it cited |
| After committing | `commit_insight` (Jev) | does this change carry durable framing knowledge? capture it |
| Periodically | `wiki_sync` + `wiki_lint` | code moved → affected claims re-verified; contradictions and gaps surfaced |

### 1.5 What success looks like

Token savings are the *secondary* metric. The primary metrics are decision quality:

- fewer wrong-layer edits and duplicated abstractions;
- fewer invariant/boundary violations caught late (or not at all);
- less rework and fewer plan revisions after review;
- fewer re-litigated decisions;
- agent answers that cite the frame instead of guessing.

These are measurable from session logs and git history (§8) and are the reason to build this at
all.

---

## 2. Key insights from research (that still hold)

### 2.1 Jev is an oracle, not a scribe

Jev generates no text. It answers a map of typed questions against a `state` in one parallel pass —
all questions judged independently, so dozens fit in one ~100–500 ms call. Documented weaknesses
are design constraints: literal reading, no counting/math/date arithmetic, and *accuracy decays
when state is large and noisy*. Therefore: filter evidence in code, keep every number in code,
and use Jev only for judgment.

### 2.2 Calibrated confidence makes agent-managed maintenance safe

Every `choice`/`score` answer carries a probability distribution and a `confidence`. Policy lives
in code: auto-apply above a threshold, queue below it. The official citation-verification cookbook
does exactly this (`AUTO_ACCEPT = 0.8`). Because the queue is worked by the agent (§5.5), the
thresholds control *how much the agent has to think*, not how much the user does.

### 2.3 Truth is provenance plus agreement

Jev verifies whether a claim is **grounded** in its evidence and **consistent** with the wiki; it
cannot browse the world. So the wiki's truth model (§6) layers provenance, groundedness,
corroboration, consistency, authority, recency, and agent review — and **disputes are first-class**,
never silently resolved.

### 2.4 The bookkeeping is the product

Karpathy's insight: wikis die of maintenance. The extension's value is the unglamorous deterministic
work — TOC and log upkeep, link validation, orphan detection, corroboration counting supersession,
invalidation on diffs, grounding re-checks, review workflow, decision ledger. Jev makes the
judgment parts cheap enough to run constantly; code makes them reliable.

### 2.5 pi gives us every integration point

`pi.registerTool()` (LLM-callable tools) · `pi.registerCommand()` (`/wiki:*`) · `pi.on(...)` hooks
(`session_before_compact`, `agent_settled`, `tool_result` for git commits) ·
`ctx.modelRegistry.complete()` (nested writer for auto/draft mode) · `ctx.ui` (critical escalations
only) · `withFileMutationQueue()` (safe writes) · `skills/*/SKILL.md` (the schema layer; in pi this
is how the TOC becomes discoverable) · pi-web-access for URL fetching.

### 2.6 Jev access is pluggable — TypeSafe direct is the default

- **TypeSafe direct (default):** `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`,
  64k context (32k state + longest question). Token: `TYPESAFE_API_KEY` from a project-root `.env`
  (gitignored), loaded by `src/config.ts`.
- **OpenRouter (alternative):** `POST https://openrouter.ai/api/alpha/decisions`, native schema
  verbatim, `~typesafe/jev-latest`, 32k advertised. Useful for one-bill setups or failover.
- Same price either way: **$0.042/Mtok input, output free**. Rate limits ~1,200 req/min; retry
  429/529 with `Retry-After`.

---

## 3. Architecture

```
 CHANNEL A — research intake (user-requested)
   doc / URL / paper ──▶ normalize ──▶ store raw/ ──▶ extract claims + quotes (LLM)
                                                              │
 CHANNEL B — agent insights (during/after work)               ├──▶ retrieve candidates (TOC → search → candidate set)
   work session ──▶ agent composes insight list ──────────────┤    JEV: grounded? derivable? durable? known?
         (tool: wiki_insights)                                │         relation (both ways)? page_type? target?
         └ fallback: nested LLM extraction when unattended    │         importance? criticality? risk?
                                                              ▼
                                              CODE policy ──▶ place (paged-choice tournament) ──▶ write
                                              thresholds · corroboration · supersession ·         (guided|draft|auto)
                                              invalidation · review queue · ledger                ▼
                                                                                       finalize: TOC · log · links
                                                                                       sync map · ledger · git
```

The wiki is consulted **on demand** via `wiki_toc` / `wiki_ask` / `wiki_impact`; nothing is
injected into the session.

### 3.1 Package layout

```
jev-wiki/
├── package.json                 # "pi" manifest: extensions, skills, prompts; keyword pi-package
├── src/
│   ├── extension.ts             # registers tools, commands, hooks
│   ├── config.ts                # .env loading, global + project config, key resolution
│   ├── jev.ts                   # TypeSafe client: batching, fan-out, retries, usage/cost
│   ├── wiki/                    # layout, frontmatter, toc, log, search, links, impact map
│   ├── pipeline/                # stage, extract, adjudicate, policy, place, write
│   ├── invalidation.ts          # file-linked claims + git diff sync
│   ├── review.ts                # agent-managed review workflow + escalation rules
│   ├── ledger.ts                # decisions.jsonl (agent + Jev + code)
│   └── lint.ts                  # deterministic fixes + Jev judgment checks
├── skills/llm-wiki/
│   ├── SKILL.md                 # the schema + when/how to consult the wiki
│   └── references/              # page templates (architecture/invariant/decision/impact/…)
├── prompts/wiki-research.md     # multi-source research workflow
└── research/                    # sources behind this plan
```

### 3.2 Wiki layout in the user's project (default `docs/wiki/`)

```
docs/wiki/
├── raw/<topic>/YYYY-MM-DD-slug.md      # immutable sources (documents + session digests)
└── wiki/
    ├── index.md                        # THE TOC: grouped pages with type · one-liner · tags · updated
    ├── log.md                          # append-only `## [YYYY-MM-DD] op | title`
    ├── architecture/                   # module-*.md · flow-*.md · layer-*.md
    ├── invariants/                     # invariant-*.md
    ├── decisions/                      # decision-*.md (ADR-style, supersession links)
    ├── impact/                         # impact-*.md (derived; refreshable by wiki_sync)
    └── <topic>/                        # gotcha-*.md · glossary-*.md · concept-*.md · summary-*.md
```

Page frontmatter carries the machine-readable truth state (claims with `status`, `support`,
`evidence`, `files`) — consumed by Jev, sync, lint, and the TOC generator, and available to
Obsidian/Dataview for free.

---

## 4. Retrieval and routing at any scale

### 4.1 The TOC is the skill-visible surface (no injection)

- `wiki/index.md` is the canonical table of contents: grouped, typed, one line per page, tags, and
  `updated`. It is kept short by construction — summaries are one line, and at scale the TOC
  becomes hierarchical (topic → pages) and can be pruned of low-value entries.
- The `llm-wiki` skill tells the agent the TOC exists, where it is, and **when** to consult it
  ("before architectural or unfamiliar changes, before planning, when a term is unclear").
- `wiki_toc` returns the TOC (optionally filtered by tag/topic) for programmatic browsing.
- Nothing is auto-injected; the agent decides when knowledge is needed. This avoids context
  pollution entirely and makes the efficiency story honest: value accrues only when the agent
  actually consults the frame.

### 4.2 Paged choice: target selection with unlimited pages

Jev `choice` accepts ≤255 options. The fix is a **sharded tournament**, not a truncated list:

1. **Candidate generation (code):** TOC + lexical/BM25/tag/entity prefilter → ordered candidate
   list of any size.
2. **Shard** into groups of ≤250.
3. **Per shard (parallel, one Jev request each):**
   - `best` — `choice` over the shard's pages **plus `add_new_page`**;
   - `any_fit` — `noul`: "Does any existing option substantially fit?"
4. **Reduce:** keep shard winners. If every shard returned `add_new_page`, or all `any_fit` scores
   are below the threshold → create a new page.
5. **Final tournament:** one `choice` over the surviving shard winners **plus `add_new_page` plus
   `none_of_these`**, with a `fit` noul for the winner.
6. **Create vs merge (code):** new page if the final choice is `add_new_page`, or confidence is
   below threshold, or `fit` is low. Otherwise merge into the winner.

**Critical rule:** probabilities from different shards are *not comparable* (different option
sets); never average or compare them. Only the final tournament compares candidates directly, and
each shard's `any_fit` gate decides whether its winner is real. Cost of routing 2,000 pages:
~9 parallel calls, ~1 second, fractions of a cent.

### 4.3 Search ladder

| Tier | Scale | Retrieval |
|---|---|---|
| 0 | ≤ ~200 pages | `index.md` (TOC) + grep |
| 1 | ~200–2,000 | BM25 (local) + tag filters; two-stage routing via sharding |
| 2 | 2,000+ | qmd hybrid (BM25 + vectors + rerank, local CLI/MCP) behind `search.ts`; hierarchical TOC |

---

## 5. The two intake channels

### 5.1 Channel A — research intake (user-requested)

`wiki_ingest` in guided mode (default): stage the source into immutable `raw/`, extract claims with
verbatim quotes, retrieve candidates, adjudicate with Jev, return a **brief**; the agent writes and
merges pages per the skill templates; `wiki_finalize` updates TOC/log/links/ledger. Re-ingest is a
hash no-op. Unsupported claims are rejected with evidence; contradictions open disputes.

### 5.2 Channel B — agent insights (automatic during work)

The agent — which just spent the session in the repo — composes a strict insight list and submits
it via `wiki_insights`:

```ts
type Insight = {
  text: string;
  kind: "decision" | "fact" | "procedure" | "pattern" | "gotcha" | "invariant" | "preference";
  evidence: Array<
    | { kind: "file"; path: string; quote?: string }
    | { kind: "commit"; ref: string }
    | { kind: "test" | "command"; ref: string }
    | { kind: "user"; quote: string }
    | { kind: "source"; rawPath: string; quote: string }
  >;
  confidence: number;
};
```

Jev then organizes them into the existing wiki (§5.3), with the agent-authoring/human-oversight
split from §0: review work belongs to the agent.

### 5.3 Shared adjudication

The full question catalog is §7. The spine, in order: `grounded` → `derivable_from_code` →
`durable` → `already_known` → `relation` (both directions) → `page_type` → `target` (paged
tournament) → `importance` → `criticality`/`risk` → `sensitive`. Every verdict maps to a code
action; thresholds and weights live in config, not prompts.

### 5.4 Invalidation — the wiki stays current

Two mechanisms, both expanded here because they are the difference between a wiki and a stale wiki:

**(a) Two-way relation at ingest.** For each new claim N and the top-k retrieved existing claims
E₁…Eₖ, one batched request asks, per pair: does N supersede Eᵢ, does Eᵢ supersede N, do they
conflict? Outcomes: old claim → `superseded` with a link; new claim → filed as `historical` or
rejected when an old claim wins; `conflict` → a visible dispute. Knowledge-to-knowledge staleness
is handled, not just code-to-knowledge.

**(b) Change-driven sync.** Every claim stores `files` (and optionally `symbols`) from its evidence.
`.jev-wiki/state.json` remembers the last synced commit. `wiki_sync` (on demand, on commit hooks
when enabled, or checked at session start) diffs `lastSync..HEAD`:

1. code intersects changed paths with claim `files` — free, deterministic;
2. for each affected claim, one batched Jev request per diff hunk: `impact` =
   `no_impact / needs_recheck / supersede / contradict`;
3. `needs_recheck` marks the claim stale and queues it; the agent re-reads the new code, re-grounds
   the claim, and updates, supersedes, or retires it;
4. `supersede`/`contradict` apply immediately with a link to the commit.

A periodic lint backstop handles claims with no file links (external knowledge can't be
diff-checked) and low-frequency drift. Impact maps (`impact-*` pages) are regenerated from the
dependency/structure scan plus Jev checks when the sync touches their inputs.

### 5.5 Autonomy and review — agent-managed, user only for critical

- **Iterative autonomy, driven by the agent.** Jev returns `importance`, `criticality`, and `risk`
  for every candidate. The **agent sees these scores** and chooses how to handle each item
  (guided / draft / auto). The user is not in the per-item loop.
- **The agent works the queue.** `wiki_review` gives the agent prioritized items (low confidence,
  disputes, stale claims) with evidence and Jev verdicts; the agent re-verifies, decides, applies
  the change, and records the resolution and rationale in the ledger. Review budget per session is
  capped so it can't run away.
- **Escalation to the user** only when `criticality ≥ threshold` (default 0.85): security, breaking
  API changes, data loss, high blast radius — or when the agent's resolution contradicts an earlier
  human decision. Escalations come with the evidence, the Jev scores, and a recommended action.
- **Nothing is invisible.** Every agent resolution and Jev verdict is in the ledger, so autonomy
  remains auditable after the fact.

---

## 6. Truth model

Jev verifies groundedness and consistency; it cannot browse the world. The wiki is honest about
this:

1. **Provenance** — every load-bearing claim points at a verbatim span in an immutable raw source
   or a file/commit/test anchor.
2. **Groundedness** — Jev: does the evidence support the claim?
3. **Corroboration** — code counts independent supporting sources per claim; `reinforces` verdicts
   increment it. Repeated work strengthens the wiki.
4. **Consistency** — two-way relation checks against existing claims; disagreement becomes a
   visible dispute.
5. **Authority** — source class (`official / source_code / vendor / third_party / anecdote`)
   weighted in code.
6. **Recency** — date comparison and supersession in code; Jev extracts date components only.
7. **Agent review & user escalation** — the agent resolves queue items; critical items reach the
   user. Every decision is logged.

---

## 7. Jev question catalog (v1)

Grouped by operation; every question is atomic with explicit `criteria`, and every verdict maps to
a code action. Full sketches in `DESIGN.md` §4.

- **Verify** — `quote_present` (deterministic) · `grounded` (noul) · `support` (choice:
  supports/contradicts/says_nothing) · `kind` (choice) · `sensitive` (noul) · `injection` (noul)
- **Filter** — `derivable_from_code` (noul — the duplicate-layer gate) · `durable` (noul) ·
  `verifiable` (choice: verified_in_repo / user_stated / inference / speculation)
- **Relate** — `already_known` (noul) · `relation` (choice, asked **both directions**) ·
  `reinforces` (noul/choice outcome) · `pair_conflict` (choice)
- **Place** — `page_type` (choice) · `topic` (choice) · `best` (choice, per shard) · `any_fit`
  (noul, per shard) · final tournament `choice` + `fit` (noul) · `create_new` (decided in code)
- **Value** — `importance` (score) · `criticality` (score) · `risk` (score) · `source_class`
  (choice) · speculative tags (`security_relevant`, `perf_relevant`, `api_breaking`, `ops_relevant`,
  `onboarding_relevant`) as fan-out nouls
- **Maintain** — `impact` (choice per diff hunk) · `stale` (noul) · `merge_candidate` (noul) ·
  `gap_value` (score) · `link_relevance` (noul)
- **Decision-time** — `assumption_check` (choice: matches/contradicts/unknown) · `plan_conflict`
  (choice) · `answer_grounded` (noul) · `wiki_used` (noul, for self-measurement)

Composite keep-score (code, configurable):
`0.45·grounded + 0.25·importance + 0.20·(1−derivable) + 0.10·authority`, with hard gates for
fabricated / contradicted / sensitive / injected / derivable content.

---

## 8. Decision ledger and measurements

### 8.1 The ledger (`.jev-wiki/decisions.jsonl`)

Every decision by every actor, with its inputs and later outcome:

```jsonc
{"ts":"…","actor":"jev","op":"place","subject":"claim:c1","verdict":{"best":"architecture/module-auth","confidence":0.82},
 "thresholds":{"minFit":0.6},"action":"merge","outcome":"later_superseded_by:claim:c9"}
{"ts":"…","actor":"agent","op":"file_insight","subject":"insight:i3","reason":"reinforces invariant-7",
 "evidence":["src/auth.ts:120"],"action":"wrote","review":"agent"}
{"ts":"…","actor":"code","op":"sync","subject":"claim:c4","verdict":{"impact":"needs_recheck"},
 "action":"queued","thresholds":{"impact":"0.7"}}
```

This is the calibration and audit substrate: per-wiki precision of auto-accepts, threshold tuning,
"why is this claim here?", and the self-report.

### 8.2 Decision-quality evaluation (primary) and efficiency (secondary)

- **Decision quality:** wrong-layer edits, duplicated abstractions, invariant/boundary violations,
  plan revisions after review, rework in touched areas, re-litigated decisions. Measured from
  session logs + git history with manual spot checks.
- **Efficiency:** input/output tokens, tool calls, turns, wall time, exploration calls per session;
  A/B where the agent is instructed to consult vs not consult the TOC on a task suite.
- **Wiki health:** citation rate of pages in answers, false-file rate (filed claims later
  contradicted/reverted), review-queue load, escalation rate, stale-claim count.
- **Self-report:** `wiki_used` + ledger outcomes produce "last 30 days: N consulted pages, M
  avoided re-derivations, K stale claims corrected after code changes."

---

## 9. Phases

### P0 — Walking skeleton (both channels, minimal)
- pi package skeleton (`package.json` manifest, ESM, pi peers only), `.gitignore`, `.env` loading.
- `src/jev.ts`: TypeSafe client (`api.typesafe.ai/v1/systemone`, `jev-latest`) with batching,
  parallel fan-out, retry/`Retry-After`, usage/cost capture; OpenRouter as config alternative.
- `src/wiki/`: layout (architecture-first page types), frontmatter, atomic writes, TOC + log.
- **Channel A:** `wiki_ingest` guided — staging, extraction, Verify/Filter/Relate/Place/Value
  questions, brief output.
- **Channel B:** `wiki_insights` — agent-authored list → adjudication + placement, including
  `reinforces` corroboration bumps and `derivable_from_code` rejection.
- **Ledger** (agent + Jev + code) and baseline session metrics.
- **Consultation, not injection:** `wiki_toc` + `llm-wiki` skill; `wiki_finalize`, `wiki_status`.
- **Acceptance:** ingest a real architecture document; capture 3 insights from a session; one
  insight reinforced, one merged, one rejected as derivable-from-code; TOC/log correct; re-ingest
  is a no-op.

### P1 — Currency, scale, and agent-managed review
- **Invalidation:** file-linked claims, `wiki_sync` on diffs, `impact` verdicts, `needs_recheck`
  queue, two-way relation (old supersedes new / new supersedes old).
- **Paged-choice tournament** for target selection; two-stage routing at scale.
- **`wiki_review`**: agent works the queue, applies resolutions, logs rationale; criticality-gated
  user escalation; review budget.
- **`wiki_lint`**: deterministic fixes + Jev judgments (contradictions, stale, merges, gaps).
- **Eval harness** for decision quality and efficiency (A/B TOC consultation).
- `wiki_ask`, `wiki_impact`, `/wiki:*` commands.
- **Acceptance:** a code change flips an affected claim to `needs_recheck` and the agent resolves
  it; 500-page synthetic wiki routes correctly via shards; lint finds a planted contradiction.

### P2 — Autonomy and capture automation
- Draft and auto writer modes (nested `ctx.modelRegistry.complete()`), adaptive per item from
  Jev's `criticality`/`risk` as evaluated by the agent.
- Automated insight capture: `session_before_compact` hook, optional `agent_settled` debounce,
  nested-LLM extraction fallback; recurrence promotion from `session-log.jsonl`.
- Corroboration ledger and date-based supersession; optional git commit per ingest.
- Structure scan (`wiki_structure`) seeds/refreshes module and impact pages from the repo.

### P3 — Scale and reach
- qmd/hybrid search behind `search.ts`; hierarchical TOC.
- Consolidation/forgetting passes; entity graph from frontmatter.
- Global (cross-project) vault with `global_vs_project` routing.

---

## 10. Risks (post-critique)

| Risk | Status / mitigation |
|---|---|
| Duplicate-layer wiki | **Resolved by design:** `derivable_from_code` hard gate + delete/decision tests |
| Retrieval bounds placement | **Addressed:** paged-choice tournament; default to new page on low fit; never compare cross-shard probabilities |
| Staleness | **Addressed:** file-linked claims + `wiki_sync` (O(diff)) + periodic backstop for unlinked claims |
| Extraction quality | Evidence anchors mandatory; inference-tier insights not filed; repo claims grounded against file excerpts |
| Calibration drift | Decision ledger + outcome tracking; per-wiki threshold tuning |
| Review fatigue | **Moved to the agent** (`wiki_review`); user sees only critical escalations; budgeted queue |
| Adversarial/injected content | Structured state, deterministic quote checks, `injection` flag; content never triggers tools |
| Auto-mode trust cliff | Agent chooses mode per item from Jev's risk/criticality; ledger + git audit |
| Scope creep | P0 stays narrow; each later feature gated on eval/ledger evidence |
| Context pollution | **Eliminated:** no injection; TOC-as-skill + on-demand retrieval |
| Agent rubber-stamps its own review | Outcome tracking (false-file rate, escalations), criticality gate, periodic user digest |

---

## 11. Config (sketch)

```jsonc
// ~/.pi/agent/jev-wiki.json  (+ project .pi/jev-wiki.json, trusted only)
{
  "provider": "typesafe",                          // "typesafe" | "openrouter" | "aimlapi"
  "baseUrl": "https://api.typesafe.ai/v1/systemone",
  "apiKey": "$TYPESAFE_API_KEY",                   // loaded from envFile if unset
  "envFile": ".env",                               // project-root, gitignored
  "model": "jev-latest",
  "wikiRoot": "docs/wiki",
  "globalWikiRoot": null,                          // optional read-only cross-project vault (absolute or agent-dir relative)
  "writer": { "mode": "guided", "model": null },   // default; agent may adapt per item via risk
  "routing": { "shardSize": 250, "minFit": 0.6, "newPageConfidence": 0.7 },
  "review": { "mode": "agent", "autoAcceptUserStated": true, "escalateCriticality": 0.85, "maxPerSession": 10 },
  "sync": { "onSessionStart": "check", "onCommit": false, "backstopLintDays": 14 },
  "thresholds": { "autoAccept": 0.8, "minSupport": 0.7, "minImportance": 1, "minNovelty": 0.6 },
  "weights": { "grounded": 0.45, "importance": 0.25, "nonDerivable": 0.2, "authority": 0.1 },
  "capture": { "onCompact": false, "onSettle": false },
  "toc": { "maxTokens": 3000 },
  "gitCommit": false,
  "search": { "engine": "index" }                  // index | bm25 | qmd
}
```

---

## 12. Ground rules

- The wiki holds the frame, not the code: nothing derivable in a minute gets filed.
- Jev advises; the agent decides, writes, and reviews; code owns every number, date, count, threshold, weight.
- The agent consults the TOC; nothing is injected into sessions.
- Never write a fact the evidence doesn't support; never delete a claim — supersede it with a link.
- Claims link to files so diffs can find them; sync runs on change, not on hope.
- Everything is logged with its verdicts, thresholds, and outcomes: the ledger is the audit trail
  and the calibration substrate.
- The user adds knowledge and handles critical escalations; the agent maintains everything else.
