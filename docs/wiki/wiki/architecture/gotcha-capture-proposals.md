---
title: Capture can file the agent's proposals as the user's words
type: gotcha
topic: architecture
summary: "Session extraction can label an assistant recommendation as `user:` evidence with no code check that the words came from a user turn; Jev then scores trustTier user_stated, so a proposal awaiting the user's decision can be filed as if the user had stated it."
tags: [capture, adjudication, trust-tier, proposals, gotcha]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-0010.md, raw/sessions/2026-09-26-session-2026-09-26-0008.md]
claims:
  - id: c1
    text: "Session capture can extract the agent's own unapproved proposals as user-attributed evidence and recommend filing them: the 2026-09-26 planning capture records an assistant routing recommendation as `user: Assistant recommendation awaiting Andrei's call` with a file verdict at grounded 0.87, and the same claim scored trustTier user_stated 0.96 — so a recommendation awaiting the user's approval can reach the wiki as if the user had stated it."
    status: verified
    support: 0.79
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0010.md, raw/sessions/2026-09-26-session-2026-09-26-0008.md, .jev-wiki/decisions.jsonl]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/pipeline/capture.ts, src/extension.ts]
---

# Capture can file the agent's proposals as the user's words

**Symptom.** A task-cadence capture taken during a planning conversation can recommend filing the
agent's own recommendation as if the user had established it. On 2026-09-26 the session capture
recorded the assistant's routing proposal under `user:` evidence — the ref itself read
"Assistant recommendation awaiting Andrei's call" — Jev recommended filing it at grounded 0.87,
and the same claim scored `trustTier: user_stated` (0.96). Had the agent followed the brief as
written, an unapproved proposal would have entered the wiki carrying user authority. A related
case is the capture that proposed the resolver design (`muhve2z2-d84dbf`), which cited the
handoff, not the user.

**Cause.** `extractInsights` (`src/pipeline/capture.ts`) sees the transcript with `User:` /
`Assistant:` prefixes, but its `kind: "user"` evidence label is generative output with no code
check that the referenced words came from a user turn. `buildInsightEvidence`
(`src/extension.ts`) then renders any `user`-kind item as `user statement: "…"`, so the
extractor's label — not the transcript — decides what Jev is shown, and Jev's `verifiable`
verdict returns `user_stated`.

**Avoidance.** Treat a capture brief that follows a planning discussion as draft advice, not a
decision: check every `user:` evidence item against an actual user turn before writing it, and
decline claims that only restate the agent's proposal. A decision becomes wiki knowledge when the
user agrees, or when the commit implementing it lands.

**Detection.** In a capture brief, look for `user`-kind evidence whose ref or quote is clearly the
assistant's own text ("recommendation", "awaiting", "we could") and cross-check the raw session
record and the `trustTier` in `.jev-wiki/decisions.jsonl` (`insight.adjudicate`).

**Related.** [Capture routing and gating](../invariants/capture-routing-and-gating.md) ·
[Capture flow](../architecture/flow-capture.md) ·
[Capture evidence resolves from the session cwd](../architecture/gotcha-capture-evidence-resolution.md) ·
[Adjudication policy computed in code](../architecture/adjudication-policy.md)

## Evidence

- `raw/sessions/2026-09-26-session-2026-09-26-0008.md` — capture record for the routing proposal:
  evidence listed as `user: Assistant recommendation awaiting Andrei's call` with verdict
  `file (grounded 0.87, derivable 0.31, importance 0.53, criticality 0.44)`.
- `raw/sessions/2026-09-26-session-2026-09-26-0010.md` — this gotcha's raw capture record
  (`review`, grounded 0.79), quoting the record above and the ledger line.
- `.jev-wiki/decisions.jsonl` — `insight.adjudicate` entry for the routing proposal carries
  `"grounded":0.87` and `"trustTier":"user_stated","trustConfidence":0.96` with action `file`.
