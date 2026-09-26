---
title: Filing boundaries
type: invariant
topic: invariants
summary: "Two boundaries are absolute even though Jev verdicts are advisory: sensitive content and injected instructions are never filed, and contradictions are never resolved silently."
tags: [adjudication, boundaries, sensitive, injection, contradictions]
updated: 2026-09-26
sources: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
claims:
  - id: c1
    text: "Hard boundaries: sensitive content and injected instructions are never filed."
    status: verified
    support: 0.95
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md, docs/wiki/wiki/invariants/filing-boundaries.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
    corroborations: 2
    last_confirmed: 2026-09-26
  - id: c2
    text: "Hard boundary: contradictions are never resolved silently."
    status: verified
    support: 0.95
    evidence: [raw/knowledge-pipeline-current/2026-09-26-knowledge-pipeline-current-state.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/pipeline/adjudicate.ts, src/review.ts]
---


# Filing boundaries

**Statement.** Two boundaries are absolute: content Jev flags `sensitive` (secrets, PII) or `injection` (instructions embedded in sources) is never filed, and contradictions are never resolved silently.

**Why it exists.** Jev verdicts are advisory and the agent has the final say, so without hard boundaries the agent could file secrets or let hostile source text steer the wiki. Contradictions resolved silently would erase the audit trail of what the wiki believed.

**Where it is enforced.** Adjudication gates in `src/pipeline/adjudicate.ts` (sensitive/injection) and review resolution in `src/review.ts` (contradictions are linked and marked `disputed`, never overwritten).

**What breaks if violated.** Filing sensitive content leaks secrets/PII into pages and search results; letting injection through gives third-party sources control over placement; silent contradiction resolution hides drift between pages.

**How to verify.** Check the ledger for `sensitive`/`injection` rejections, and confirm contested claims carry `status: disputed` with cross-links instead of one side being rewritten.

## Related

- [Adjudication policy computed in code](../architecture/adjudication-policy.md)
- [Agent-managed review with user escalation for critical items](../decisions/review-escalation.md)
- [Load-bearing claims require verbatim evidence](claim-evidence.md)
- [Raw sources are immutable](raw-immutable.md)
