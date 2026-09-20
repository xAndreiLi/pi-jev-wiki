---
title: Bypass-2FA token restrictions since August 2026
type: decision
topic: decisions
summary: Since August 2026, bypass-2FA tokens on npm cannot perform account or package-governance actions, and direct publishing with them is scheduled for removal in January 2027.
tags: [npm, tokens, 2fa, security, ci]
updated: 2026-09-20
sources: [raw/releasing/2026-09-20-releasing.md]
claims:
  - id: c1
    text: "Since August 2026, bypass-2FA tokens cannot perform account or package-governance actions."
    status: accepted
    support: 0.98
    evidence: [raw/releasing/2026-09-20-releasing.md]
files: []
---

# Bypass-2FA token restrictions since August 2026

**Status.** accepted

**Date.** 2026-09-20

## Context

- npm removed classic tokens in December 2025.
- Granular tokens with the **Bypass two-factor authentication** option enabled were the remaining way to publish from CI without interactive 2FA.
- npm announced that this capability would be restricted and later removed.

## Options considered

1. Continue using bypass-2FA granular tokens indefinitely — no longer viable due to policy restrictions.
2. Migrate to OIDC trusted publishing — recommended; eliminates long-lived tokens and provides automatic provenance.

## Decision

- Accept that bypass-2FA granular tokens are deprecated for direct publishing.
- Do not rely on them for new long-term CI setups.
- Prioritize migration to OIDC trusted publishing (GitHub Actions → npm).

## Consequences

- Existing CI workflows using bypass-2FA tokens will stop working in January 2027.
- Tokens created after August 2026 cannot manage account settings or package governance (adding/removing maintainers, configuring trusted publishers, etc.).
- The project must complete the OIDC migration before the January 2027 deadline to avoid manual interactive publishing.

## Evidence

- `docs/RELEASING.md` — "Since August 2026 bypass-2FA tokens cannot perform account or package-governance actions, and direct publishing with them is scheduled to be removed in January 2027."
