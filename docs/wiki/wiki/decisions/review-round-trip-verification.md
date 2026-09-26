---
title: Review resolutions verify the serializer round-trip
type: decision
topic: decisions
summary: "wiki_review resolutions re-read the page after writing and warn when the claim's status did not survive the serializer round-trip, because frontmatter is re-serialized on every write."
tags: [review, serializer, frontmatter, verification, decision]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-010608.md]
claims:
  - id: c1
    text: "`wiki_review` resolutions verify the page after the serializer round-trip: the affected claim's status is re-read and a warning is returned when it did not survive the write (accept → verified unless user-stated, reject → rejected, supersede → superseded), because frontmatter is re-serialized on every write."
    status: verified
    support: 0.87
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-010608.md, "96ca8ca"]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/review.ts]
---

# Review resolutions verify the serializer round-trip

**Status.** accepted

**Date.** 2026-09-26

## Context

- `applyReviewResolution` rewrites the affected claim in frontmatter through `writePage`'s
  serializer. A serializer round-trip can change what parses back — the raw-source hash check
  already had to reverse its exact behaviour — so a resolution that silently failed to take effect
  would be invisible.
- Review item `muhslpak-ffda5b` tracked this gap from an earlier session and stayed open until the
  fix shipped.

## Decision

- After the write, the page is re-read and the claim's status compared against the expected one
  (`expectedClaimStatus`): `accept` leaves `user-stated` claims alone and marks others `verified`,
  `reject` marks `rejected`, `supersede` marks `superseded`.
- A mismatch, or a claim missing after the round-trip, returns a warning in the tool output instead
  of a silent success.

## Consequences

- Drift in a rewritten page surfaces at resolution time; the agent re-reads the page and fixes it.
- The check compares the claim's status, not the whole frontmatter: normal re-serialization
  (numbers, quoting, ordering) is expected and not reported.

## Related

- [Agent-managed review with user escalation for critical items](review-escalation.md)
- [Out-of-scope review disposition](out-of-scope-disposition.md)
- [Finalize the wiki before presenting decisions](finalize-before-decisions.md)
