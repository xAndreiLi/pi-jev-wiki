---
title: Adjudication policy computed in code
type: architecture/layer
topic: architecture
summary: "Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free."
tags: [adjudication, thresholds, policy, jev]
updated: 2026-09-26
sources: [raw/sessions/2026-09-19-session-2026-09-19-1730.md, raw/sessions/2026-09-20-session-2026-09-20-2035.md, raw/sessions/2026-09-26-session-2026-09-26-2247.md]
claims:
  - id: c1
    text: "The extension treats every Jev verdict as advisory; thresholds and composite scores are computed in code, so policy changes never require a model call."
    status: verified
    support: 0.95
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
    reviewed: 2026-09-19
    last_checked: 2026-09-26
  - id: c2
    text: "High-importance architecture, invariant, and decision framing is queued for confirmation when Jev rates it derivable from code, instead of being rejected, because a real-project agent reported that its most important insights were being dropped."
    status: verified
    support: 0.86
    evidence: [raw/sessions/2026-09-20-session-2026-09-20-2035.md]
    reviewed: 2026-09-20
    last_checked: 2026-09-26
  - id: c3
    text: "Jev verdicts are advisory: the agent has the final say and records overrides in the ledger."
    status: user-stated
    support: 0.38
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-2247.md, "I want jev to act as a arbiter and reminder to LLM agents about what not to add, but I want the LLMs to act as the final say."]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c4
    text: "The project spends Jev tokens liberally: Jev calls are cheap relative to model tokens, so agents should prefer an extra Jev call (placement, relevance, contradictions, sync impact, rejection triage) over a guess, and the policy is documented in skills/llm-wiki/SKILL.md and README.md; code still owns thresholds and composite decisions."
    status: user-stated
    support: 0.96
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0034.md, "Do not be frugal with jev tokens, they are much less expensive than your own. We should be utilizing jev when possible and this should be documented in the skill."]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/pipeline/adjudicate.ts, skills/llm-wiki/SKILL.md]
---





# Adjudication policy computed in code

**Responsibility.** The `decideClaim` function translates Jev verdicts into concrete actions (`file`, `reinforce`, `review`, `reject_*`) using fixed thresholds and a weighted composite score.

**Public surface.** `ClaimVerdicts` (raw model answers) → `ClaimDecision` (action + score + reasons).

**Dependencies.** `ResolvedConfig.thresholds` and `ResolvedConfig.weights` for tunable policy without code changes.

**Key files.** `src/pipeline/adjudicate.ts`

## Invariants

- Policy logic lives entirely in `decideClaim`; no model call is required to change thresholds or weights.
- High-importance architecture, invariant, and decision framing is queued for confirmation when Jev rates it derivable from code, instead of being rejected, because a real-project agent reported that its most important insights were being dropped.
- Jev verdicts are advisory: the agent has the final say and records overrides in the ledger; hard boundaries (sensitive/injection, silent contradiction resolution) still apply.

## Token economy

Jev is the cheap resource: a Jev call costs a fraction of the model context it replaces, so the
pipeline — and agents following `skills/llm-wiki/SKILL.md` — prefers an extra Jev call (placement,
retrieval relevance and sufficiency, contradiction and duplicate checks, sync impact, rejection
triage) over a model guess. Model tokens are the scarce budget. Thresholds and composite decisions
stay in code, so the policy itself never needs a model call.

## Failure modes

- Raising `thresholds.autoAccept` too high suppresses valid filings.
- Misaligned weights can overweight groundedness versus importance.

## Change impact

- Threshold and weight changes in `src/config.ts` (`DEFAULT_CONFIG`) propagate immediately to all adjudication.
- Changing the scoring formula affects every claim decision; no re-ingestion is needed.

## See also

- [pi extension module](module-pi-extension.md)
- [Jev typed decisions](../invariants/jev-typed-decisions.md)
