# Critique, Efficiency Evaluation & Jev Expansion

> Written before implementation, at the request: *"critique this idea, evaluate how much more
> efficient this could make code development by agents, and how can we improve it by utilizing
> more Jev ideas?"*
>
> Verdict up front: **the mechanism is sound; the value hypothesis is unproven.** Jev solves the
> *cost of judgment*. It does not automatically solve *whether the wiki is worth reading*, *whether
> retrieval finds the right page*, or *whether claims stay true as the code changes*. Those are the
> real risks, and they are addressable — see §3.

---

## 0. Resolution log (user decisions, 2026-09-19)

All critique items were reviewed and resolved; [`PLAN.md`](PLAN.md) is now the authoritative
design. What was decided:

| Item | Resolution |
|---|---|
| 1.1 Duplicate layer | **Accepted.** `derivable_from_code` is a hard gate at intake and lint. |
| 1.2 Retrieval ceiling | **Solved by paging.** Shard candidates ≤250 per Jev call, each shard offers `add_new_page`, winners meet in a final tournament. Caveat recorded: probabilities are not comparable *across* shards — only the final call compares candidates directly. |
| 1.3 Staleness | **Expanded in PLAN §5.4.** File-linked claims + `wiki_sync` diff matching + `impact` verdicts per hunk, with a periodic backstop for unlinked claims. |
| 1.4 Extraction quality | **Accepted + extended.** Evidence anchors mandatory; repo claims grounded against file excerpts; **two-way invalidation** (new supersedes old / old supersedes new) at ingest and sync. |
| 1.5 Calibration drift | **Accepted.** `.jev-wiki/decisions.jsonl` logs every **agent and Jev** decision plus later outcomes; thresholds tuned from observed precision. |
| 1.6 Review fatigue | **Resolved differently than proposed.** The *agent* works the review queue (`wiki_review`); the user only handles critical escalations. |
| 1.7 Adversarial content | **Accepted.** Structured state, deterministic quote checks, `injection` flag; content can never trigger tool execution. |
| 1.8 Trust cliff | **Resolved.** Jev's `risk`/`criticality` scores are shown to the agent, which chooses guided/draft/auto per item; user only for critical cases. |
| 1.9 Scope creep | **Accepted.** P0 stays narrow; later features gated on ledger/eval evidence. |
| 1.10 Context pollution | **Eliminated.** Nothing is injected. The TOC is available like a skill (`wiki_toc` + `llm-wiki` skill); the agent consults on demand. |
| 1.11 Value hypothesis | **Steered into the vision.** The wiki stores the project's high-level framing — structure, code flow, invariants, decisions, impact — to improve agent decision quality on large codebases. Decision quality is now the primary success metric; token savings are secondary. |

---

## 1. Critique

Ordered by expected damage. Each item: the risk, why it bites, the fix.

### 1.1 The duplicate-layer risk — **highest**

Most project knowledge is already in the repo: code, tests, README, doc comments, git history,
AGENTS.md. A wiki that files what is derivable becomes a second copy that goes stale, and stale
copies are worse than no copies because agents trust them.

**Fix.** Gate insight intake with a `derivable_from_code` question: *"Could this be re-derived from
the repository in under a minute?"* If yes → don't file it; store a pointer instead. The wiki should
hold exactly what the repo cannot: **decisions and rationale, cross-source synthesis, external
knowledge, gotchas, and conventions that span files.** A useful test for every page: *"what would
break if this page were deleted?"* If the answer is "nothing, the agent would just re-read the
code," it doesn't belong.

### 1.2 Retrieval quality bounds placement quality

Jev can only choose among candidates code retrieves. A wrong `target_page` produces a bad merge,
which produces rot, which kills trust. The plan's Tier-0 retrieval (index + grep) is untested on
real project wikis, and the plan assumes it works "surprisingly well" based on Karpathy's
experience with prose wikis, not code wikis.

**Fix.** (a) Benchmark retrieval on a synthetic set (query → expected pages) before trusting
placement. (b) Require a high-confidence target; when in doubt, **create a new page** — merging is
cheap later, un-merging is not. (c) Use two-stage routing from day one (code prefilter → Jev choice)
so the 255-option ceiling never silently truncates the right answer. (d) Only add Jev reranking if
it measurably improves retrieval, because it adds latency to every query.

### 1.3 Staleness has no trigger

Claims are verified at ingest, then age silently. Code changes weekly; a claim about `auth.ts`
from three weeks ago may be false today. The current plan's staleness handling is a periodic lint
pass, which is O(wiki) work for an O(diff) problem.

**Fix — highest-leverage single addition: change-driven invalidation.** Every claim stores the file
paths it touches. On commit/diff, code matches changed paths → candidate claims (deterministic,
free), then Jev answers `impact` (`none / recheck / supersede`) with the diff as state. Only
touched claims get re-verified. The wiki becomes *live* rather than periodically audited. This is
also the feature that most directly helps agent development (§2), because it keeps advice current.

### 1.4 The extraction step is the weakest link — and it's done by the agent the wiki is meant to help

Insights are self-reported. An agent that misunderstood the code will write a confident, coherent,
wrong insight. Jev is literally-minded and does not catch subtle domain errors (its own docs warn
about large noisy state and adversarial content).

**Fix.** (a) Evidence anchors are mandatory; an insight with no file/commit/test/user anchor is
`inference` and is not filed by default. (b) For repo claims, ground the verification: embed the
referenced file excerpt as `state` and ask whether it supports the claim (the same `supports /
contradicts / says_nothing` question used for research intake). (c) Treat `user_stated` as a
distinct, lower trust tier — never laundered into "verified."

### 1.5 Confidence thresholds assume calibration transfers to your domain

Jev is calibrated on its training distribution. Project-specific jargon, internal APIs, and unusual
conventions may be out of distribution, where a confident answer can still be wrong. Fixed
thresholds (0.8/0.9) are a starting guess, not ground truth.

**Fix.** A **decision ledger** (`.jev-wiki/decisions.jsonl`) recording every verdict, threshold,
and later outcome (was the claim contradicted, reverted, or re-filed?). Tune thresholds per wiki
from observed precision. Log enough to answer "how often was auto-accept wrong?" — without it,
threshold tuning is superstition.

### 1.6 The review queue can become a second job

Conservative thresholds → queue grows → user stops reviewing → queue becomes noise. Loose
thresholds → rot. Neither failure is visible until trust is gone.

**Fix.** Prioritize the queue by `impact × uncertainty`, batch similar items, and only gate
high-impact classes (security, API contracts, architecture decisions) on human review. Everything
else auto-applies and is *auditable after the fact* via the ledger + git. A review queue should
have a budget (N items/week), and the thresholds should be tuned to fit it.

### 1.7 Adversarial and injected content

Ingested web pages, third-party docs, and even repo files can contain text that steers a model.
Jev's docs are explicit: it does not treat state as hostile. This is a real injection surface for
a system whose whole job is trusting text.

**Fix.** Structured state fields (never raw concatenation), deterministic quote matching first,
the `injection` flag, explicit criteria, and a hard rule: **content can never trigger tool
execution or file writes** — only typed verdicts routed through code policy can.

### 1.8 Auto mode is a trust cliff

Writing pages with no review before calibration is proven is the fastest way to poison the wiki.

**Fix.** Guided → draft → auto, and make autonomy **adaptive**: Jev scores `importance`/`risk`
per ingest and the code picks the mode. Low-risk, high-volume ingests can go auto early;
architecture/security knowledge stays guided.

### 1.9 Scope creep

Three writer modes, ~20 questions, capture, lint, graph, global vault, qmd. Every addition is
maintenance surface in a system whose failure mode is *abandonment*.

**Fix.** P0 is the narrow happy path (ingest one doc + capture from one session). Everything else
is gated on the ledger and the eval showing it's needed. Build the measurement before the
automation.

### 1.10 Context pollution from injection

Injecting the wiki digest into a session can *hurt* if the content is irrelevant — a real risk,
since its own docs show Jev's accuracy decays with irrelevant state, and the same is true for
generative models.

**Fix.** Relevance-gate the digest with Jev (`relevance`/`digest_rank`, §3.1) and cap it to a token
budget (e.g., ≤2–3k). Instrument whether injected sessions actually perform better; if not, inject
less.

### 1.11 The honest meta-critique

This is a bet that **compounding synthesis beats on-demand retrieval** for a coding project. That
bet is plausible for maintenance/legacy work and weak for greenfield. It is testable cheaply
(§2.4) and should be tested before deep automation. If the eval shows no improvement, the correct
move is to shrink the system — not to add features.

---

## 2. How much more efficient could this make agent development?

### 2.1 Mechanisms, with honest magnitudes

| Mechanism | What it saves | Estimated effect | Confidence |
|---|---|---|---|
| **Avoid re-derivation** | Exploration tool calls and context churn replaced by a small, relevant digest | 20–50% fewer exploration calls on recurring topics; **~5–20% blended session token reduction once the wiki matures** | Medium — plausible, unmeasured here |
| **Prevent repeated mistakes / re-litigated decisions** | Wrong-path retries, re-deciding settled questions | Turn reduction hard to estimate; the bigger win is consistency. Analogous to ADR value in teams | Medium |
| **Continuous verification at near-zero cost** | Verifying every claim with a frontier LLM is 100–1000× more expensive | Jev at $0.042/Mtok: a 1M-token wiki-wide audit ≈ **$0.04** vs ~$3–15 for a frontier model; per-claim verification is fractions of a cent | **High** — arithmetic, not speculation |
| **Change-driven recheck** | Not re-deriving which knowledge a diff invalidates | Keeps the digest trustworthy; prevents confidently stale advice | Medium |
| **Maintenance automation** | Human wiki upkeep | Removes the failure mode that kills wikis (abandonment) | High (qualitative) |

The strongest claim is the third: **Jev makes continuous, exhaustive verification economically
trivial.** You cannot afford to re-verify a 1,000-page wiki with an LLM every day; you can with Jev.
That property is what makes the rest of the design possible at all.

### 2.2 Worked example (explicit assumptions)

Assume: a 3-month project; 200 agent sessions; 100 wiki pages; 500 filed claims; ~150k input
tokens and ~25 tool calls per session.

**Costs added**
- Insight extraction + page writing: ~2–5M generative tokens total (≈$10–60, model-dependent).
- Jev: < $1 (hundreds of batched requests, ~1M tokens ingested).
- Human review: the real cost — budget ~10–20 items/week at maturity.

**Savings, if the digest is used in ~half of sessions**
- ~30k tokens of re-derivation avoided per benefiting session → ~3M tokens (~$10–100).
- Fewer exploration turns: ~3–8 tool calls per benefiting session → 300–800 fewer calls.
- Quality: fewer repeated mistakes and contradictions (unquantified but often the dominant value).

**Break-even:** a few benefiting sessions per actively-used source. **Payoff skew:** highest on
legacy/maintenance work and long-lived projects; near zero on greenfield. **Negative case:** if the
agent never reads the wiki, cost is pure overhead — which is why relevance-gated injection is not
a nice-to-have but the mechanism that makes the economics work.

### 2.3 What efficiency *doesn't* mean

- Not "faster code generation." Generation speed is unchanged.
- Not raw token savings in every session — only in sessions touching previously-captured domains.
- Not a substitute for tests, docs, or type systems. The wiki reduces *rediscovery*, not
  *verification of correctness*.

### 2.4 Measurement plan (build this before believing any of the above)

Instrument from P0 using pi's session JSONL:
- **Per session:** input/output tokens, tool calls, turns, wall time, files read, tests run.
- **Wiki usage:** pages/claims cited in answers; digest tokens injected; retrieval hit rate.
- **Quality:** repeated-error rate (same failing command/error twice across sessions), test pass
  rate, human interventions, review-queue load, false-file rate (claims later contradicted/reverted).
- **A/B:** same task suite with `injectDigest: true|false`; compare tokens-to-solution and tool calls.
- **Success bar (proposal):** ≥15% fewer exploration tokens on tasks in known domains; false-file
  rate ≤5%; review queue ≤10 items/week; no regression on novel-task sessions. If these fail,
  shrink the system rather than adding features.

---

## 3. More Jev: expanding the idea

Rules for expanding: use Jev where a wrong decision is costly or calibrated confidence matters;
batch questions with fan-out (they run in parallel, nearly free); never use it for math, dates,
counting, or text generation; filter state first (accuracy decays with noise); log every verdict.

### 3.1 Make the wiki live (highest leverage)

| Idea | Question | Why it matters |
|---|---|---|
| **Derivability gate** | `derivable_from_code` (noul) | kills the duplicate-layer failure at the source |
| **Change-driven recheck** | `impact` (choice: none/recheck/supersede) per claim on git diff | keeps claims true as code changes; the O(diff) fix to O(wiki) staleness |
| **Recheck prioritization** | `recheck_priority` (score) | spend re-verification effort where it matters |
| **Injection relevance** | `relevance` (noul) + `digest_rank` (score) per page vs current task | makes digest injection a net positive instead of context pollution |
| **Adaptive autonomy** | `write_mode` (choice: guided/draft/auto) from importance+risk | safe automation without a global trust cliff |
| **Consolidation** | `same_claim` (noul) · `canonical_form` (choice) | periodic compression keeps retrieval sharp at scale |
| **Cross-project routing** | `global_vs_project` (choice) | lets one vault feed many repos without leaking project specifics |

### 3.2 Use the wiki inside the agent loop (beyond storage)

These convert the wiki from a passive store into an active participant in coding:

| Idea | Question | Effect |
|---|---|---|
| **Task-known check** | `task_known` (noul) | "does the wiki already answer this?" → skip exploration entirely |
| **Assumption check** | `assumption_check` (choice: matches/contradicts/unknown) | catch the agent's unstated assumptions against documented decisions before edits |
| **Plan sanity** | `plan_conflict` (choice) | flag plans that violate known constraints/decisions |
| **Answer grounding** | `answer_grounded` (noul, per claim) | citation-check applied to the agent's *own* final answer, not just ingested sources |
| **Spend gating** | `search_worthwhile` / `subagent_worthwhile` (noul) | decide whether a web search/subagent is likely to pay for itself before spending tokens |
| **Task routing** | `route_task` (choice: deterministic / small model / frontier / human) | cheap triage for agent fleets |
| **Test triage** | `test_scope` (choice/score) | which tests a change actually needs |
| **Commit capture** | `commit_insight` (noul/score) | after each commit, decide whether the change carries durable knowledge → capture |
| **Convention check** | `convention_match` (score) | score diffs against documented project conventions (rubric explicit, not vibes) |

Caution: each call is 70–500 ms. Use these at *decision points where errors are expensive*, not on
every step; batch with fan-out where possible. Deterministic logic stays deterministic.

### 3.3 Speculative tagging at ingest (nearly free, pays off later)

At ingest, ask a fan-out of extra questions per claim — they run in parallel and cost a few tokens:
`security_relevant`, `perf_relevant`, `api_breaking`, `ops_relevant`, `onboarding_relevant`,
`cost_relevant`. Store as tags in frontmatter. Later, retrieval and digest injection can filter on
tags ("only security-tagged knowledge for this task"), which improves relevance without another
model call. This is the speculative-fan-out pattern applied to knowledge enrichment.

### 3.4 The decision ledger as a product

Every Jev verdict, threshold, and later outcome is stored. This yields three things an
LLM-written wiki cannot offer:
1. **Threshold calibration** per wiki/domain from observed precision.
2. **Explanations**: "why is this claim here, and how confident were we when we filed it?"
3. **Auditability**: a full epistemic trail from raw source → verdict → page. For engineering
   teams, this is often more valuable than the wiki text itself.

### 3.5 Efficiency measurement as a Jev use

A `wiki_used` noul per session ("did this session rely on wiki knowledge?") plus deterministic
metrics lets the system report its own value: *"last 30 days: 42 sessions, 18 used the wiki,
~280k tokens of re-derivation avoided, 2 stale claims corrected after code changes."*
Self-measuring systems get tuned; unmeasured ones get abandoned.

### 3.6 What to explicitly *not* do with Jev

- No arithmetic, counting, date comparison, or percentage math (Jev's docs: do it in code).
- No free-form generation — it cannot write the wiki.
- No giant unfiltered states — accuracy decays with irrelevant detail.
- No single Jev call in a hot path where 300 ms matters and a deterministic rule would do.
- No trusting a verdict without the ledger; calibration must be observed, not assumed.

---

## 4. Concrete changes to the plan

Driven by the critique, in priority order:

1. **Add `derivable_from_code`** to the insight intake catalog (P0) — the duplicate-layer fix.
2. **Add change-driven invalidation** (`impact` on diffs, file-linked claims) to P1 — the
   staleness fix and the feature that most directly helps agent development.
3. **Add relevance-gated digest injection** (`relevance` + `digest_rank`) to P1 — the mechanism
   that makes the economics work.
4. **Add the decision ledger** (`.jev-wiki/decisions.jsonl`) to P0 and outcome tracking in P1.
5. **Add the eval harness** (session metrics, A/B digest) to P1 — build measurement before
   automation.
6. **Keep guided as the default**; make autonomy adaptive (P2) using ledger precision, not a
   global switch.
7. **P0 scope discipline**: one document, one session capture, ledger, eval counters. No graph,
   no qmd, no global vault until the numbers justify them.
