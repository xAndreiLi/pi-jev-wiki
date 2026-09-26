---
title: "Capture can file the agent's proposals as the user's words"
type: gotcha
topic: architecture
summary: "Historical: session extraction could label an assistant recommendation as `user:` evidence with no code check that the words came from a user turn, and Jev then scored trustTier user_stated; 0.8.0 closes the pathway by validating user evidence against actual user turns."
tags: [capture, adjudication, trust-tier, proposals, gotcha]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-0010.md, raw/sessions/2026-09-26-session-2026-09-26-0008.md]
claims:
  - id: c1
    text: "Session capture can extract the agent's own unapproved proposals as user-attributed evidence and recommend filing them: the 2026-09-26 planning capture records an assistant routing recommendation as `user: Assistant recommendation awaiting Andrei's call` with a file verdict at grounded 0.87, and the same claim scored trustTier user_stated 0.96 — so a recommendation awaiting the user's approval can reach the wiki as if the user had stated it."
    status: superseded
    support: 0.79
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0010.md, raw/sessions/2026-09-26-session-2026-09-26-0008.md, .jev-wiki/decisions.jsonl, c5e5f62]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
    superseded_by: "0.8.0 validates user-kind evidence against actual user turns and renders unsupported items as agent-stated (unverified), closing the user_stated pathway (see Mitigation below)."
    superseded_at: 2026-09-26
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

**Mitigation (0.8.0).** `buildInsightEvidence` now checks every `user`-kind item against the
session's actual user turns; a ref or quote that does not appear there is rendered to Jev as
`agent-stated (unverified)`, so the `user_stated` trust tier can no longer be won by the agent's
own text (commit `c5e5f62`). The failure mode remains for pre-fix captures and for evidence typed
by hand without user support.

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
