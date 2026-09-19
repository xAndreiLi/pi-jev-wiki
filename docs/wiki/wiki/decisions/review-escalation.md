---
title: Agent-managed review with user escalation for critical items
type: decision
topic: decisions
summary: Review work is agent-managed. The user is only escalated for critical items such as security, breaking API changes, or data loss.
tags: [review, escalation, workflow]
updated: 2026-09-19
sources: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
claims:
  - id: c1
    text: "Review work is agent-managed. The user is only escalated for critical items such as security, breaking API changes, or data loss."
    status: verified
    support: 0.99
    evidence: [raw/jev-wiki-architecture-notes/2026-09-19-jev-wiki-architecture-notes.md]
files: []
---

# Agent-managed review with user escalation for critical items

**Status.** accepted

**Date.** 2026-09-19

## Context

- Requiring user approval for every wiki change would create friction.
- Some wiki updates carry risk (e.g., documenting security invariants incorrectly).

## Options considered

1. User reviews every change — safe, but slow.
2. Agent reviews everything silently — fast, but risky for high-stakes content.
3. Agent-managed review with escalation — balances throughput and safety.

## Decision

- Routine wiki updates (architecture, decisions, invariants) are agent-managed.
- Escalate to the user only for security-sensitive content, breaking API changes, or potential data loss.

## Consequences

- Low-friction maintenance.
- Requires clear criteria for "critical" to avoid alert fatigue.

## Evidence

- `docs/notes/jev-wiki-overview.md` — decisions section.
