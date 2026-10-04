# Automatic wiki retrieval on prompt

**Status:** P1 implemented 2026-10-04 (unreleased; `hooks.autoRetrieve`, default `mode: "inject"`).
Sections below are kept as the design record; §9 records the decisions taken and §10 the Jev uses
shipped or deferred. Nothing else here is implemented.
**Relation to existing decisions:** this *narrows* `PLAN.md` §4.1 ("the wiki is never pushed into a
session") rather than deleting it. Retrieval becomes automatic; injection stays gated, budgeted,
measured, and off by default. `CRITIQUE.md` §1.10 and §2.4 already called for relevance-gated digest
injection with a token budget and an A/B — this is that mechanism, with the measurement that decides
whether it ships.

---

## 0. TL;DR

- **Hook.** One `pi.on("before_agent_start", …)` handler that returns a custom message. Pi injects it
  in the same batch as the user prompt, so it renders in the transcript and is in context before the
  first provider request. No `input`-transform hack, no system-prompt surgery.
- **Two modes, not three.** `off` and `inject` (default). A `display` rung was designed and dropped:
  it existed to collect gate verdicts without injecting, but every `inject` run already logs its
  verdict — including the below-gate ones — so the calibration data costs nothing extra.
- **Query.** The prompt, repaired deterministically for continuations. No LLM rewrite in v1 — a
  weak query fails the gate, so it degrades to *no* injection rather than to a *wrong* injection.
- **Gate.** Reuse `judgeRetrieval`. Historical `ask.judge` verdicts suggest it is selective (24/30 below
  the 0.5 sufficiency floor) — but that sample is contaminated by the 2026-10-02 index outage. Treat
  it as a reason to gate, not as a calibration; measure the floor on `display`-mode data.
- **Cost.** `display` is one local search, sub-second warm, no context tokens.
  `inject` adds one batched Jev call per prompt in the hot path — the real cost is latency, so it
  runs under a hard budget and fails closed.

## 1. Mechanism (verified against pi 0.85.1)

| Fact | Where |
|---|---|
| `before_agent_start` sees the expanded `prompt` and `systemPromptOptions`, after extension commands, before the agent loop | `docs/extensions.md` §events; `dist/core/agent-session.js:1552` |
| A handler may return `{ message: { customType, content, display, details } }` | `dist/core/extensions/types.d.ts:1082` |
| Handler messages accumulate and are appended **to the same batch as the user message**, before the first provider request | `dist/core/extensions/runner.js:1123-1145`, `dist/core/agent-session.js:1584-1592` |
| A `custom_message` entry participates in LLM context; `display` controls TUI rendering only (`true` = styled, `false` = hidden) | `dist/core/session-manager.d.ts:100-115` |
| Display **without** context is the other primitive: `pi.appendEntry()` + `pi.registerEntryRenderer()` | `examples/extensions/entry-renderer.ts` |
| Extension messages do not start a turn — only user-authored messages do, so no recursion | `dist/core/agent-session.js:449` |

**Why a trailing custom message and not a system-prompt section.** Sessions in this project are
98.6% cache reads (`EFFICACY.md:262`). Appending after the user prompt adds nothing that the new turn
would not invalidate anyway; editing `systemPromptOptions` rewrites the leading prompt and drops the
cached prefix for the whole conversation. The trailing message is the cheap one.

**Why `before_agent_start` and not `input`.** `input` fires before skill/template expansion, so a
`/wiki:*` invocation or a skill command would be searched as raw slash-command text, and it has no
access to the fully expanded prompt. `before_agent_start` has both and can return a message.

## 2. Modes

| Mode | Does | Context cost | Gate | Use |
|---|---|---|---|---|
| `off` | nothing | none | — | opt out |
| `inject` (default) | hybrid retrieval over the session wiki, Jev judgment, then a `custom_message` (`display: true`) when the gate passes | ≤ `maxTokens` | Jev, fail-closed | the agent gets the knowledge without calling `wiki_ask` |

The brief is a `custom_message`, so it is visible in the transcript *and* in context. Display-only
remains available as a primitive (`appendEntry` + `registerEntryRenderer`) if a future mode needs it.

## 3. Query construction

Input: `event.prompt` (already expanded). Deterministic repairs only:

1. **Continuation fallback.** If `tokenize(prompt).length < 4` or the prompt matches
   `/^(yes|ok|okay|continue|go on|go ahead|do it|proceed|next|and then)\b/i`, substitute the most
   recent `role: "user"` message from `ctx.sessionManager.getBranch()`. Injected `custom` messages are
   a different role, so they never become the query.
2. **Paste isolation.** If the prompt contains a fenced block longer than ~1,000 chars, query on the
   text before it plus the pasted block's first line. Stops "look at this file: ```…```" from
   embedding 20k characters of code.
3. **Length cap.** Feed at most ~1,200 chars to the embedder (deterministic truncation; the model
   truncates anyway, and a cap keeps the cost bounded).
4. **Dedupe.** Skip if the normalized query equals the previous hook query in the session.
5. **Skip outright.** Not idle (`ctx.isIdle() === false`, e.g. a steer mid-run that already got a
   brief), empty prompt. Extension commands (`/wiki:*`) are handled before this hook and never reach
   it; skill commands and prompt templates are already expanded by the time it runs.

**Why no LLM rewrite in v1.** It adds a second model call and a network round trip to the hot path
before the first token, and the failure it would fix — continuations — is fixable in three lines of
regex. Revisit only if logged data shows the gate discarding prompts that later turn out to be
answerable from the wiki.

**The property that makes this safe:** the gate is the quality filter, not the query. A poorly formed
query produces irrelevant candidates, which fail the gate, which means *nothing is injected*. A
mediocre query costs a little latency; it does not cost context.

**If the measurement later shows recall gaps** (prompts that the wiki could answer, gate-blocked),
the escalation path is, in order: append the top matching TOC title/summary terms to the query (the
TOC is small and already loaded for BM25 — domain-vocabulary expansion, still no model); then, only
if that fails, a query-rewrite call. Do not start there.

## 4. The relevance gate

Reuse `judgeRetrieval` (`src/vector/judgments.ts`): one batched Jev call scoring each candidate's
relevance plus one evidence-sufficiency verdict. Inject iff `sufficiency ≥
search.jev.minSufficiency` (default 0.5). Within a passing run, candidates are rendered in Jev's
relevance order and candidates it scores below its own midpoint (0.5) are dropped — reusing the
model's decision boundary rather than inventing a second threshold. A `relevanceFloor` was
considered and rejected: the sample below cannot calibrate one, and a guessed second gate only adds
a way to be wrong.

Measured on the existing ledger (`docs/wiki/.jev-wiki/decisions.jsonl`, 30 `ask.judge` entries):

- sufficiency: median 0.23, `≥0.5` in 6/30, `≥0.8` in 2/30 — the gate would have blocked ~80%.
- candidate relevance: median 0.46, 159 candidates.

**Those numbers are not a calibration set.** The sample spans 2026-09-26 → 2026-10-04 and straddles
the vector-store outage and rebuild of 2026-10-02 (`gotcha-corrupt-vector-store-recovery`); 13 of the
30 fall on 2026-10-01, the day the store was failing, when `metrics.jsonl` recorded `bm25+vector` for
runs that in fact returned lexical-only results (`gotcha-silent-search-degradation`, 20 of 25 `ask`
entries). Low sufficiency there is at least partly an artifact of a dead vector half. Two further
caveats: n=30 is too small to fix a threshold, and those queries were agent-authored "what you need
to know" questions, not raw prompts — a different input distribution. Hence: **calibrate on
post-rebuild `display`-mode data**, where the verdict is logged but nothing is injected.

One real example of how marginal the floor is: this proposal's own research query ("no injection,
wiki is never pushed into a session…") returned 6 pages with sufficiency 0.49 — just under the
default 0.5. A single number cannot be both the gate and the truth; log and revisit.

**Fail closed.** If Jev errors or the budget expires, inject nothing. This deliberately differs from
`wiki_ask`, which degrades to unranked keyword results with a note: in a hot path, "we could not
tell" must mean "do not inject".

## 5. Brief format

```
<auto-retrieval engine="bm25+vector" gate="0.61">
The project wiki has relevant knowledge for this prompt. It may be incomplete — read the pages
before relying on it, and use wiki_ask for anything else.

- architecture/flow-retrieval.md#c10 (verified) — "Fusion fuses BM25 and vector ranks with
  reciprocal rank fusion."
- ...
</auto-retrieval>
```

- **Prefer claim hits.** Claims are atomic, one line, and carry `status` (`verified`,
  `needs_recheck`, `disputed`); section hits fall back to a trimmed excerpt. The vector index
  already distinguishes `kind: claim | page-section`.
- **Budget.** `maxTokens` default 800 (CRITIQUE's ceiling was 2–3k); 3–4 hits.
- **Header wording is load-bearing.** "May be incomplete", "read the pages" — the brief is a pointer,
  not an answer, so the rediscovery discipline survives. It also distinguishes auto-content from a
  user instruction.
- **`customType: "jev-wiki-auto"`** — distinct from capture's `"jev-wiki"`, so `pi-wiki-eval` can
  bucket retrieval injections separately from capture briefs (`episodes.ts` already counts
  `injected`).

## 6. Failure modes and guards

| Failure | Guard |
|---|---|
| Context pollution (irrelevant digest degrades the model) | Gate + budget + `display`-first ramp; CRITIQUE §1.10 |
| Silent degradation: cold/mismatched index → vector half empty, BM25 only, scored like a real match | Log the **outcome, not the engine name**: how many candidates each half produced. A run whose vector half is empty while an index exists is `outcome: "degraded"` and must not inject — the engine name in `metrics.jsonl` is already known to be untrustworthy (`gotcha-silent-search-degradation`) |
| Latency on every prompt | `budgetMs` (default 2,500) with fail-closed; warm the embedding provider at `session_start` so the first prompt does not pay the model load; skip on non-idle |
| Metric contamination | log `op: "auto"`, **never** `op: "ask"` — counting this as consultation would repeat the 93%→30% defect (`gotcha-wiki-consultation-vs-maintenance`) |
| Wiki content as instructions | The intake `injection` gate is now load-bearing: it already refuses injected content. Excerpts are wrapped in an explicit origin block |
| Over-trust ("the wiki was checked, it must be complete") | Header says otherwise; `needs_recheck`/`disputed` status rendered in the brief |
| Duplicate injection on steer/follow-up | Non-idle skip + query dedupe |
| Dangling async work (if verdict logging is fire-and-forget) | One AbortController per session, aborted in `session_shutdown` |

## 7. Measurement

`display` and `inject` both append to `.jev-wiki/metrics.jsonl`:

```json
{"op":"auto","query":"…","pages":["…"],"detail":{"mode":"inject","outcome":"injected","lexical":5,"vector":4,"sufficiency":0.61,"topRelevance":0.72,"latencyMs":840,"promptChars":220}}
```

`outcome ∈ injected | below_gate | empty | degraded | timeout | error`.

The `degraded` flag is the point: `HybridSearchEngine` swallows a vector-side failure and RRF-fuses
lexical-only candidates (`src/wiki/search.ts:364-367`), and the existing `engine` field reports the
*constructed* engine, not what ran. The hook must count per-half contributions itself, or it
inherits the defect and injects lexical-only results with the appearance of verified relevance.

**This defect becomes load-bearing with this feature.** Today a degraded `wiki_ask` misleads an
agent that chose to ask; under `inject`, degraded retrieval puts pages into context automatically on
every prompt. Fixing the hybrid swallow — or at least exposing per-half counts — is a prerequisite
for P3, and its absence is an argument for P1/P2 (`display`) first.

Extend `pi-wiki-eval`:

- bucket `op: "auto"` separately from `ask`/`toc` — the consultation rate must keep meaning
  "the agent or user chose to consult";
- keep the existing rediscovery join (retrieved page `files:` vs files read afterwards);
- add one join: **injected paths → later `read`/`grep` calls** = effective consultation. This is the
  metric that says whether injection worked at all;
- `injected.chars` already exists (`episodes.ts`); break it down by `customType`.

Proposed success bar before `inject` becomes a default:

- effective consultation on injected episodes well above the 30% R0 baseline (`EFFICACY.md:262`);
- rediscovery rate below the 13.2% baseline on the same repos;
- ≤ 1.2k injected tokens per episode;
- no regression on novel-topic episodes;
- A/B in the **post-audit** harness only (`gotcha-eval-harness-leaks`).

## 8. Phases

| # | Step | Files | Size | Gate to proceed |
|---|---|---|---|---|
| P1 | config key + retrieval + `display` mode + metric | `src/config.ts`, `src/hooks/auto-retrieve.ts` (new), `src/extension.ts`, `src/metrics.ts` | S–M | — |
| P2 | async gate verdict logging (still no injection) | same | S | P1 runs clean for a week |
| P3 | `inject` mode behind the config flag | `src/auto-retrieve.ts` | S | — |
| P4 | eval bucket + effective-consultation join | `packages/pi-wiki-eval/` | M | P3 running |
| P5 | amend `PLAN.md` §4.1 and `CRITIQUE.md` §1.10 status | docs + wiki decision page | S | done 2026-10-04 |

P1 and P3 shipped together: with `inject` as the only non-off mode there was no separate flag to add.
Files: `src/auto-retrieve.ts` (query, retrieval, gate, brief), `src/config.ts` (`hooks.autoRetrieve`),
`src/extension.ts` (hook + warm-up), `src/metrics.ts` (`op: "auto"`).

**Warming guard (do not get this wrong).** `createLocalProvider` loads the model eagerly and
`transformers.js` will *download* it if absent (`src/vector/embed.ts:136-158`), breaking the existing
"queries never download a model" guarantee. Warm at `session_start` only when the index already
reports chunks for the configured model (the same `db.counts()` check `vectorSearch` uses) **and**
the model cache directory (`modelsDir(agentDir) = <agentDir>/jev-wiki/models`) exists. Otherwise do
nothing: the first prompt falls back to the lexical half, exactly as it does today.

## 9. Decisions taken (2026-10-04)

1. **Default mode: `inject`.** "Inject by default for now, I want this feature rolled out and
   tested." Opt out with `hooks.autoRetrieve.mode: "off"`.
2. **Gate: Jev.** "Inject should use the jev gate." Sufficiency only; fail closed.
3. **Scope: session wiki only.** "Session wiki only for the automatic injection, but this should be
   documented in the skill so that agents know to search manually for global wiki hits." Done in
   `skills/llm-wiki/SKILL.md`.
4. **Config surface: a public `hooks.autoRetrieve` block** (`mode`, `limit`, `maxTokens`,
   `budgetMs`). `limit` and `maxTokens` are the knobs most likely to need tuning per project; the
   gate threshold is not duplicated — it is `search.jev.minSufficiency`.

The plan's `display` rung is dropped (§2), the relevance floor is dropped (§4), and P2's separate
"log verdicts before injecting" step is unnecessary because every run logs its verdict.

## 10. Other ways Jev can improve this feature

Shipped:

- **The gate** — sufficiency is the only reason auto-injection is safe.
- **Relevance order and cut.** The same batched call orders the brief and drops candidates below
  Jev's own midpoint, so the brief's shape is model-decided rather than threshold-written.
- **Below-gate outcomes as a coverage signal.** Every blocked run logs its query and verdict, so
  repeated below-gate prompts on one topic are evidence of a wiki gap — material for capture and
  lint rather than a silent miss. Not yet mined; the data accumulates from day one.

Deferred, in rough order of value:

- **Assumption check** (CRITIQUE §3.2): after the agent states a plan, ask Jev whether it contradicts
  a documented decision. This is the higher-leverage use of Jev in the loop, and the auto-brief gives
  it something concrete to check against.
- **Budget scaling.** Scale the brief by need (one claim for a marginal hit, four for a strong one)
  rather than a flat `maxTokens`. Cheap, but there is no data yet on how often the flat budget is
  the binding constraint.
- **Query-side Jev.** Deliberately rejected: Jev returns decisions, never text, so it cannot rewrite a
  query; and a decision call to pick between query candidates costs the same as judging the results.
  The gate already fails closed, which is the property a better query would buy.
