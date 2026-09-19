---
title: Retry Handling in Client
type: decision
topic: decisions
summary: "Unbacked claims are queued as review items rather than deleted, because a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge."
tags: [lint, claims, review-queue, ledger, bookkeeping]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1806.md]
claims:
  - id: c1
    text: "Unbacked claims are queued as review items rather than deleted, because a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge."
    status: user-stated
    support: 0.58
    evidence: ""
    reviewed: 2026-09-19
  - 0: r
    1: a
    2: w
    3: /
    4: s
    5: e
    6: s
    7: s
    8: i
    9: o
    10: n
    11: s
    12: /
    13: "2"
    14: "0"
    15: "2"
    16: "6"
    17: "-"
    18: "0"
    19: "9"
    20: "-"
    21: "1"
    22: "9"
    23: "-"
    24: s
    25: e
    26: s
    27: s
    28: i
    29: o
    30: n
    31: "-"
    32: "2"
    33: "0"
    34: "2"
    35: "6"
    36: "-"
    37: "0"
    38: "9"
    39: "-"
    40: "1"
    41: "9"
    42: "-"
    43: "1"
    44: "8"
    45: "0"
    46: "6"
    47: .
    48: m
    49: d
files: [src/lint.ts]
---


# Retry Handling in Client

**Status.** accepted

**Date.** 2026-09-19

## Decision

When the lint process detects an active claim that lacks an accepted ledger entry and has not been previously reviewed, it does not delete or reject the claim. Instead, it queues the claim as a `claim_review` item with criticality 0.45 and reason `lint: no accepted ledger entry backs this claim`. This approach treats a missing ledger entry as a potential bookkeeping gap rather than evidence of bad knowledge.

## Rationale

A claim may be valid even if its corresponding ledger entry is missing, mis-filed, or not yet recorded. Deleting the claim would risk losing valid knowledge. Queuing it for review allows a human (or later automation) to verify the claim and either accept, reject, or dispute it.

## Evidence

- `docs/wiki/raw/sessions/2026-09-19-session-2026-09-19-1806.md` — user-stated decision captured during session.
- `src/lint.ts` — unbacked-claims section that enqueues review items rather than deleting claims.
