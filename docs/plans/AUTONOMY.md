# jev-wiki — Autonomy Realization Plan

**Status.** Proposed — 2026-10-08. Detailed plan for `PLAN.md` §9 **P2 (Autonomy)**.
**Owner.** Agent-maintained; escalations per §1.4.
**Predecessors.** `PLAN.md` §9 P2 · `DESIGN.md` §11.3 · `EFFICACY.md` §2 (metrics) · `AUTO-RETRIEVAL.md`.

---

## 0. Goal and acceptance criteria

**Goal.** The wiki maintains itself. A human runs no wiki command, resolves no routine review item,
and never confirms a page write. Human attention is spent only on the escalation class defined in §1.4.

**Acceptance criteria** — all must hold over a continuous two-week period of real work:

| # | Criterion | Measured how |
|---|---|---|
| A1 | Zero human-initiated `wiki_*` maintenance calls (`sync`, `review`, `lint`, `finalize`) | Session ledger: `actor: "agent"` only for those ops, plus zero human `/wiki:*` commands |
| A2 | Wiki currency: no claim sits `needs_recheck` > 7 days | `wiki_doctor` sync-baseline + review-age checks |
| A3 | Every written page originated from the writer or was explicitly agent-authored with a reason | Ledger `op: wiki.write` carries `mode`; `guided` entries carry `reason` |
| A4 | No claim lost by a mode downgrade | Every accepted claim appears in a page, or has a ledger `insight.decide` with a non-file action |
| A5 | No unattended failure loop: no repeated identical failed Jev call within a session | Ledger: no more than `maxAttempts` consecutive failures per `op` per session |
| A6 | Agent maintenance tokens per accepted claim at or below the recorded baseline | Ledger usage aggregate, per the §5 instrument |

**Non-goals.** Retrieval quality, index/embedder behaviour, cross-wiki routing, and the R1–R3 efficacy
experiments are untouched by this plan. See §8.

---

## 1. Target loop

### 1.1 The autonomous maintenance loop

```
   capture trigger            adjudication            placement          write            commit
┌────────────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌───────────┐   ┌───────────┐
│ agent_settled      │   │ Jev verdicts     │   │ sharded      │   │  writer   │   │ finalize  │
│  · cadence=task    │──▶│  grounded        │──▶│ tournament   │──▶│  composes │──▶│ index     │
│  · cadence=commit  │   │  derivable       │   │ target page  │   │  draft    │   │ log       │
│ session_before_    │   │  durable         │   │ + new page   │   │  agent    │   │ ledger    │
│  compact           │   │  sensitive       │   │              │   │  reviews  │   │ reindex   │
└────────────────────┘   │  importance      │   └──────────────┘   │  promotes │   └───────────┘
                         │  criticality     │                      └───────────┘
                         └──────────────────┘
                                  │
                                  ▼  code thresholds, not Jev
                         ┌──────────────────────────────────────────────┐
                         │ file · reinforce · review · reject           │
                         └──────────────────────────────────────────────┘

   currency                             health                        agenda
┌────────────────────┐   ┌──────────────────────────────┐   ┌────────────────────┐
│ sync.onCommit      │   │ lint backstop (days)         │   │ session_start      │
│ session_start check│──▶│ doctor on demand             │──▶│  delivers an agenda│
│   → baseline drift │   │ review queue, budgeted       │   │  as a nextTurn msg │
└────────────────────┘   └──────────────────────────────┘   └────────────────────┘
```

### 1.2 The division of labour (unchanged, restated because the plan depends on it)

Jev advises. **Code** owns thresholds and composite scores. The **agent** writes and has the final
say, recording overrides. Two boundaries survive everything: `sensitive`/`injection` content is never
filed, and contradictions are never resolved silently.

### 1.3 Writer modes

| Mode | Who composes | Where it lands | Agent's job |
|---|---|---|---|
| `guided` | nobody | — | author the whole page, frontmatter included |
| **`draft` (default per this plan)** | writer model | `.jev-wiki/drafts/<stamp>/` | review, correct, promote |
| `auto` | writer model | `wiki/` directly | handle flagged pages + review queue |

`draft` is the default because it removes the authoring cost while keeping the agent as the final
word. `auto` is a *verified* alternative, not a default — §5 defines the verification.

### 1.4 The escalation boundary

Human attention is spent on exactly two things:

1. **Critical review items** — `criticality >= review.escalateCriticality` (0.85), which per
   `decisions/review-escalation.md` means security, breaking API changes, or data loss.
2. **The one-time embedding-preset choice** before the first index build (`wiki_index action=model`).

Everything else — routine review dispositions, sync invalidations, lint findings, page writes,
lint backstops — is the agent's.

---

## 2. Current state: the realization gap

The autonomy layer is built and unwired. Five config keys are declared, defaulted, documented in
`DESIGN.md`, and read by no code:

| key | designed to do | reality |
|---|---|---|
| `sync.onCommit` | sync when a commit lands | dead |
| `sync.backstopLintDays` | periodic lint backstop | dead |
| `review.maxPerSession` | bound review work per session | dead — `PLAN.md` P1's "review budget" does not exist |
| `writer.model` | compose on a chosen model | dead — `callWriter` always uses `ctx.model` |
| `gitCommit` | commit the wiki per ingest | dead |

Three structural gaps beyond the dead keys:

- **G1 — the write stage is the only manual stage left.** `writeAcceptedPages` can compose pages, but
  `guided` returns at `src/pipeline/write.ts:164` without writing; `draft` composes into
  `.jev-wiki/drafts/` from which **nothing can promote**; `resolveWriterMode` resolves per *batch*
  from the worst claim's criticality, where `PLAN.md` specifies per *item*.
- **G2 — currency, health and review have no trigger.** `session_start` only notifies. Nothing runs
  the queue. Consequently the review queue has 19 open items (oldest 2026-10-02) and the sync
  baseline is 13 commits behind — not neglect, absent machinery.
- **G3 — this repository runs everything off.** `.pi/jev-wiki.json` sets `capture.cadence: "manual"`;
  defaults add `onCompact: false`, `writer.mode: "guided"`. Capture never fires, the writer is
  disabled, sync only warns.

---

## 3. Failure-loop safety

A system that spends money on a hook is a system that can spend money forever. Andrei's constraint:
*Jev spend is fine, but a failure loop must be impossible.* Three loop classes are in scope, and
**one is live today**.

### 3.1 Live defect: the capture retry storm

`autoCapture` (`src/extension.ts:2405–2477`) guards with four conditions:

```ts
if (messageCount < 3 || messageCount === lastAutoCaptureMessageCount) return undefined;
if (Date.now() - lastAutoCaptureAt < minIntervalMs) return undefined;   // 10 min, 0 for commit
if (autoCaptureInFlight) return undefined;
```

`lastAutoCaptureAt` and `lastAutoCaptureMessageCount` are assigned **only on success paths**
(`:2453`, `:2460`, `:2471`). The catch is:

```ts
} catch {
    return undefined;   // neither guard advanced
}
```

So any throw before completion — a Jev error at the pre-screen (`:2433`), an extraction failure, a
network fault — leaves both guards stale. The next `agent_settled` passes every guard and fires
another Jev call. Under `cadence: "commit"` the interval is `0`, so a persistent failure (expired
key, `402` no-credits — explicitly non-retryable in `jev.ts`) retries **on every settle, forever**.

`syncWiki` has the same shape: `writeSyncState` runs only at the end of the run, so a mid-loop Jev
failure re-fires the entire claim batch on the next trigger — 40 calls on today's backlog.

### 3.2 Two more loop classes to design against

- **Self-capture loop.** Capture writes pages; that writing is a turn; the next settle sees a new
  message count and re-screens the *maintenance work* — which, being about the wiki, can look like
  durable knowledge. Today only the 10-minute interval and the Jev pre-screen bound this. It is an
  unbounded-spend loop, not a corruption loop.
- **Resolution loop.** Auto-resolution rewrites pages; a rewrite could in principle re-trigger
  detection. Today it cannot: `wiki_sync` maps claims to `files:` patterns that point at *code*, and
  the wiki's own writes drive zero affected claims (measured: 38 of 75 changed files are wiki files,
  and they match 0 claims). Worth preserving as an explicit invariant rather than a happy accident.

### 3.3 Design rules (binding on every work item)

| # | Rule | Why |
|---|---|---|
| L1 | Guard state is **persisted**, never process-local | A restart must not clear a backoff. All current guards are module variables. |
| L2 | Guard timestamps advance in a `finally`, including on failure | An error must move the clock, or the next trigger retries immediately |
| L3 | Failure opens a **circuit breaker** with exponential backoff: `min(2^failures * 60s, 6h)` | Bounds repeated spend without human intervention |
| L4 | **Non-retryable** errors (401/403/402) open the breaker for the whole session and are recorded with a reason | A billing or auth fault is not fixed by retrying |
| L5 | **Progress is persisted incrementally.** Sync must never advance the baseline past unchecked claims, and must record the checked prefix | Today the baseline advances only on full success — all-or-nothing is what makes a storm expensive |
| L6 | Every autonomous trigger has a **per-session call ceiling** | An upper bound on unattended spend that does not depend on any single guard being right |
| L7 | Maintenance work does not trigger capture | Terminate the self-capture loop by construction, not by throttle |

---

## 4. Work items

Ordered by dependency. Sizes: S ≤ ~1 hour, M ≤ half day, L ≤ multi-day.

### W1 — Persist maintenance state · **L** · foundation

New `.jev-wiki/maintenance.json`, written under the existing wiki lock (`withWikiLock`,
`src/wiki/lock.ts`) so concurrent sessions cannot clobber it:

```jsonc
{
  "capture": { "lastAt": null, "lastMessageCount": 0, "failures": 0, "backoffUntil": null },
  "sync":    { "lastAt": null, "lastCheckedCommit": null, "failures": 0, "backoffUntil": null },
  "lint":    { "lastAt": null },
  "review":  { "sessionId": null, "resolvedThisSession": 0 },
  "session": { "spent": { "jevCalls": 0 }, "startedAt": null }
}
```

All four in-memory guards move here. **Acceptance:** killing and restarting the process mid-backoff
does not resume work; two concurrent sessions do not double-fire a trigger.

### W2 — Writer promote path · **L** · unblocks everything downstream

Extend `wiki_finalize` with `drafts: [paths]` (preferred: the skill already mandates finalize as the
last step, so no new tool name enters the surface). Promotion must:

1. read the draft and the target page **fresh** (the target may have changed since drafting);
2. merge claims by id — draft claims were generated from the plan, so ids are stable;
3. union `sources`/`files`, update `updated`, re-run the `checkLiterals` grounding check;
4. write the page, update the index, append log + ledger (`op: wiki.write`, `action: "promote"`);
5. delete the draft; drop its `manifest.json` entry; remove the stamp directory when empty.

Stale drafts (no promotion within N days) are reported by `wiki_lint` and surfaced in the agenda.
**Acceptance:** a draft promotes to a page byte-identical to a hand-authored merge; no orphan
directories; `npm run test:unit` covers the empty-target, changed-target and multi-claim cases.

### W3 — Per-item writer mode · **M**

`resolveWriterMode` currently takes the worst criticality across the whole plan, so one critical
claim drags the batch. Move resolution into `groupClaims`, so each group resolves independently
(`src/pipeline/write.ts:48`, `:154`). The brief must then label each claim with the mode it was
written under, and a `guided` group in an otherwise `draft` batch must say so explicitly — that is the
gap that makes the current downgrade silent.
**Acceptance:** a batch of one critical + five routine claims resolves to one guided and five draft
groups; the brief names both.

### W4 — Wire `writer.model` · **S**

`callWriter` (`src/pipeline/write.ts:125`) uses `ctx.model` unconditionally. Resolve
`config.writer.model` through `ctx.modelRegistry` when set, falling back to `ctx.model`. Lets
composition run on a cheaper model than the session without touching `ctx.model`.
**Acceptance:** setting `writer.model` in `.pi/jev-wiki.json` changes the model used, visible in the
ledger usage record.

### W5 — Default `writer.mode` to `draft` · **S**

Change `DEFAULT_CONFIG.writer.mode` (`src/config.ts:95`) to `"draft"`. Update the skill's mode
description and `tools.md`-equivalent tool descriptions, which currently instruct the agent to
hand-write frontmatter (`src/extension.ts:404` "Include YAML frontmatter (title, type, topic,
summary, tags, updated, claims with status/support/evidence)").
Depends on W2 — shipping the default before the promote path exists would dead-end every capture.
**Acceptance:** a fresh project with no config writes pages via draft and promotes them.

### W6 — Wire `sync.onCommit` · **M**

`agent_settled` already computes `headCommit` and compares against `lastCommitSeen` for commit
cadence (`src/extension.ts:2487–2492`). Reuse that comparison to trigger `syncWiki`, independently of
capture cadence, so a commit syncs even when capture is manual.
Bound by L5 and L6: a per-run claim budget, incremental progress, and the circuit breaker.

**Acceptance:** a commit lands → affected file-linked claims flip to `needs_recheck` without any
human action; a forced Jev failure produces one retry, then a backoff, not a storm.

### W7 — Wire `sync.backstopLintDays` · **S**

In `session_start`, if `now - lint.lastAt > backstopLintDays`, run `wiki_lint` with `autoFix`, and per
`decisions/lint-queues-unbacked-claims.md` **queue** judgment items rather than auto-resolving them.
**Acceptance:** with `backstopLintDays: 14` and a 15-day-old `lint.lastAt`, lint runs once.

### W8 — Wire `review.maxPerSession` · **S**

Count resolutions per session in the persisted state. The agenda (W9) stops proposing review work
once the budget is spent, so a 100-item queue cannot become an unbounded session.
**Acceptance:** with `maxPerSession: 10` and 19 open items, the agenda proposes 10 and reports the rest.

### W9 — Session-start agenda · **M** · this is what removes the human

Replace the sync warning (`src/extension.ts:2261`) with an agenda delivered as
`pi.sendMessage(..., { deliverAs: "nextTurn" })` — the advisory mechanism auto-capture already uses
(`:2506`). Content:

```
Wiki agenda — 19 review items (2 critical), sync 13 commits behind, 4 pages need recheck.
Routine items are yours to resolve. Critical items: <ids> — escalate.
```

Critical items are named for escalation; everything else is the agent's to work. Writing the agenda to
a state file as well as the message keeps it durable across compaction.
**Acceptance:** a session with a non-empty queue and a stale baseline produces exactly one agenda
delivery, and the agent works it without a human `/wiki:review`.

### W10 — Failure-loop guards · **L** · gates all triggers

Implement L1–L7 of §3.3. Specifically: persisted guards; timestamps advanced in `finally`; exponential
backoff; a session circuit breaker for 401/403/402; incremental sync progress with a checked-prefix
commit; per-session call ceilings; and a maintenance-turn tag that suppresses capture of capture.
Depends on W1.
**Acceptance:** the §3.1 defect has a regression test — a forced throw in `autoCapture` must leave
state such that the next settle does **not** re-fire; a forced `402` must open the breaker for the
session.

### W11 — This repository's config · **S** · last

`.pi/jev-wiki.json` gains `capture: { "cadence": "task", "onCompact": true }`. Writer mode stays at
the new default (`draft`). Do this only after W1–W10 pass, then monitor the first week against §0's
acceptance criteria.
**Acceptance:** one week of normal work with zero human-initiated maintenance calls (A1).

### Dependency summary

```
W1 ─┬─▶ W10 ─┬─▶ W6 ─┐
    │        ├─▶ W7 ─┤
    │        └─▶ W8 ─┴─▶ W9 ─┐
W2 ─┴─▶ W3 ─▶ W4 ─▶ W5 ──────┴─▶ W11
```

---

## 5. Verification: `draft` vs `auto`

`draft` is the default. `auto` is adopted only if it survives this protocol. Kill criteria are
written **before** the run, following `EFFICACY.md` §12.

### 5.1 Design

A **paired comparison on a fixed corpus**, not a new efficacy experiment. Runs in throwaway clones
using the existing harness (`eval/lib.mjs`, `eval/arms.mjs`) so the real wiki is never touched.

- **Corpus.** 20 captures drawn from `docs/wiki/raw/sessions/` — the ledger already holds their
  adjudicated verdicts, so claims and placements are fixed before the comparison and only the writer
  varies. Plus 5 fresh captures to guard against overfitting to the historical corpus.
- **Arms.** `draft` (writer composes → promote step) vs `auto` (writer composes → direct write).
- **Fixed across arms.** Claims, evidence, placement targets, thresholds, model, prompt template.
  The only variable is the mode and its review step.

### 5.2 Metrics

**Primary — quality guardrails. Any regression here fails the run.**

| Metric | Definition | Source |
|---|---|---|
| `ungrounded_literal_rate` | Pages flagged by `checkLiterals` per page written | `needs_review` flag on written pages |
| `duplicate_page_rate` | Claims filed to a new page when an existing page covers them | compare against the draft arm's targets |
| `claim_fidelity` | Fraction of accepted claims whose text appears in a page | ledger `insight.decide` vs page claims |
| `placement_agreement` | Agreement between arms on the target page | page paths per claim |
| `groundedness_rejudged` | Jev's `grounded` score on the *written page's* claims | one Jev call per page — spend approved |

**Secondary — cost.**

| Metric | Definition |
|---|---|
| `agent_tokens_per_capture` | Session tokens attributable to capture (the cost we are cutting) |
| `writer_tokens_per_page` | Writer call usage |
| `human_escalations_per_capture` | Items reaching the user |

**Kill criteria (decide now, not after):**

1. `duplicate_page_rate` > 0 in `auto` — **fail**. A duplicate page is worse than a slow one.
2. `ungrounded_literal_rate` in `auto` exceeds `draft` by more than 5 percentage points — **fail**.
3. `claim_fidelity` < 1.00 in `auto` — **fail**. A dropped claim is silent knowledge loss (A4).
4. `placement_agreement` < 0.9 — **fail**.
5. `groundedness_rejudged` mean drops more than 0.05 — **fail**.
6. Otherwise **pass**, and `auto` becomes eligible for *low-criticality claims only*.

### 5.3 Reading the result

n = 25 paired captures is small. Treat the output as **directional**, and let the guardrails decide:
a clean guardrail sweep matters more than a significance test on the cost saving. Report cost as an
interval, never as a point estimate.

### 5.4 After the run

If `auto` passes, adopt it **per-item and gated** — `auto` for claims below
`review.escalateCriticality`, `draft` above — rather than wholesale, and keep the §5.2 metrics as
standing guardrails for a month. If it fails, `draft` stays and `auto` remains available as a manual
override with the failure recorded as a decision.

---

## 6. Rollout sequence

| Phase | Items | Gate to proceed |
|---|---|---|
| 1 — Foundation | W1, W10 | The §3.1 defect has a passing regression test |
| 2 — Writer | W2, W3, W4, W5 | Promote path green in `test:unit` + `test:integration` |
| 3 — Triggers | W6, W7, W8, W9 | Each trigger's acceptance test passes; circuit breaker demonstrated |
| 4 — Verification | §5 protocol | Guardrails clean |
| 5 — Live | W11 | §0 acceptance criteria over two weeks |

Phases 1–3 are code. Phase 5 is one config change, deliberately last, so that autonomy is never
enabled ahead of its safety.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Promote path merges into a page that changed since drafting | High | Re-read the target at promotion (W2 step 1); aborts to a review item on conflict |
| Writer composes plausible but wrong pages at scale | High | `draft` default keeps the agent reading every page; §5 guardrails; `checkLiterals` |
| Circuit breaker too aggressive, wiki silently stops updating | Medium | Breaker state is in `wiki_doctor` and the session agenda; A2 catches staleness |
| Per-session ceiling starves a genuinely large backlog | Medium | Ceiling is configurable; agenda reports the remainder so it is visible, not silent |
| Mode downgrade still loses a claim | High | A4; per-item modes (W3); brief labels each claim's mode |
| Self-capture loop reappears through a new hook | Medium | L7 as an invariant, not a throttle; regression test in W10 |

---

## 8. Out of scope

- Retrieval quality, ranking, `auto-retrieve` injection budgets, and the embedder/index service.
- The `R1`/`R2`/`R3` efficacy experiments in `EFFICACY.md` — this plan reuses their metrics, it does
  not replace their designs.
- Cross-wiki routing at registry scale (`PLAN.md` remaining roadmap).
- `log.md` rotation, catalog-cache, and summary-fidelity lint — real but unrelated.
- Any change to what Jev is *asked*: the question catalog and prompt content stay as they are.
