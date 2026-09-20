---
title: Adjudication policy computed in code
type: architecture/layer
topic: architecture
summary: "Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free."
tags: [adjudication, thresholds, policy, jev]
updated: 2026-09-20
sources: [raw/sessions/2026-09-19-session-2026-09-19-1730.md, raw/sessions/2026-09-20-session-2026-09-20-2035.md]
claims:
  - id: c1
    text: "The extension treats every Jev verdict as advisory; thresholds and composite scores are computed in code, so policy changes never require a model call."
    status: verified
    support: 0.95
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1730.md]
    reviewed: 2026-09-19
    last_checked: 2026-09-19
  - id: c2
    text: "High-importance architecture, invariant, and decision framing is queued for confirmation when Jev rates it derivable from code, instead of being rejected, because a real-project agent reported that its most important insights were being dropped."
    status: verified
    support: 0.86
    evidence: [raw/sessions/2026-09-20-session-2026-09-20-2035.md]
    reviewed: 2026-09-20
    last_checked: 2026-09-20
files: [src/pipeline/adjudicate.ts]
---



# Adjudication policy computed in code

**Responsibility.** The `decideClaim` function translates Jev verdicts into concrete actions (`file`, `reinforce`, `review`, `reject_*`) using fixed thresholds and a weighted composite score.

**Public surface.** `ClaimVerdicts` (raw model answers) → `ClaimDecision` (action + score + reasons).

**Dependencies.** `ResolvedConfig.thresholds` and `ResolvedConfig.weights` for tunable policy without code changes.

**Key files.** `src/pipeline/adjudicate.ts`

## Invariants

- Policy logic lives entirely in `decideClaim`; no model call is required to change thresholds or weights.
- High-importance architecture, invariant, and decision framing is queued for confirmation when Jev rates it derivable from code, instead of being rejected, because a real-project agent reported that its most important insights were being dropped.

## Failure modes

- Raising `thresholds.autoAccept` too high suppresses valid filings.
- Misaligned weights can overweight groundedness versus importance.

## Change impact

- Threshold and weight changes in `src/config.ts` (`DEFAULT_CONFIG`) propagate immediately to all adjudication.
- Changing the scoring formula affects every claim decision; no re-ingestion is needed.

## See also

- [pi extension module](module-pi-extension.md)
- [Jev typed decisions](../invariants/jev-typed-decisions.md)
