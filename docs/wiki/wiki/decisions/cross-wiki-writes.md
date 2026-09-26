---
title: Cross-wiki write routing
type: decision
topic: decisions
summary: "Writes target one registered wiki per call through an explicit `wiki` parameter, and auto-capture routes by subject — filing into the wiki that owns the session's edited files when exactly one does, and otherwise staying on the session wiki with a visible warning."
tags: [cross-wiki, routing, capture, write-tools, decision]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-0025.md]
claims:
  - id: c1
    text: "Cross-wiki writes are explicit and per-call: every write tool takes `wiki: \"<registered name>\"`, targets exactly one registered wiki per call, and keeps the session's wiki as the default; relative page and ingest paths resolve against the target project rather than the session workspace, and `wiki_sync wiki=<name>` diffs the target project's repository."
    status: verified
    support: 0.91
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0025.md, "Andrei, 2026-09-26: \"Lets plan with cross wiki writes in mind and implement that first.\""]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c2
    text: "Auto-capture routes by subject by default: `capture.route: subject` files the capture into the registered wiki that owns the files the session actually edited when exactly one does; ambiguous, missing, or evidence-only matches keep the session wiki and add a visible warning to the brief. `capture.route: session` restores the working-directory rule."
    status: verified
    support: 0.83
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0025.md, "Andrei, 2026-09-26: \"Then the auto routing can work by default and warn if it is ambiguous.\""]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/extension.ts, src/wiki/target.ts, src/config.ts]
---




# Cross-wiki write routing

**Status.** accepted

**Date.** 2026-09-26

## Context

- A session is bound to one wiki root. Reads crossed wikis (`wiki_ask scope=all`, `wiki_toc wiki=<name>`), but writes were local-only: a calisthenics-rooted session could not file its `pi-jev-wiki` findings anywhere, so the agent hand-wrote pages, reproduced the TOC writer byte-for-byte, and skipped Jev adjudication entirely.
- Automatic capture inherited the same limitation: it filed into the session's working-directory wiki, silently mis-filing knowledge when the work belonged to another project.

## Decision

- Every write tool accepts `wiki: "<registered name>"` and then operates on that wiki's pages, raw sources, TOC/log, ledger, and review queue. One wiki per call — a call never spans two wikis. Omitting `wiki` keeps the session wiki.
- Cross-wiki paths resolve against the target project, never the session workspace: a same-named file in the session directory cannot be picked up by mistake. `wiki_sync wiki=<name>` diffs the target project's repository.
- `capture.route` defaults to `subject`: auto-capture routes to the registered wiki that owns the files the session edited, when exactly one does. Ambiguous, missing, or evidence-only matches stay on the session wiki and put a visible warning in the brief. `capture.route: session` restores the working-directory rule.

## Consequences

- Cross-project knowledge lands where it belongs without a handoff detour, and every routing decision is recorded in the ledger (`capture.route`: `routed`/`warned`/`session`).
- Ambiguity is never resolved silently: the capture still happens (on the session wiki) and the brief names where the evidence points, so the agent can re-submit with `wiki: <name>`.
- Addressing is by registered name, not raw path, matching `wiki_index`.

## Related

- [Capture routing and gating](../invariants/capture-routing-and-gating.md)
- [Capture flow](../architecture/flow-capture.md)
