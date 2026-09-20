# Wiki TOC

> 24 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 6 | [toc/architecture.md](toc/architecture.md) |
| decisions | 9 | [toc/decisions.md](toc/decisions.md) |
| invariants | 8 | [toc/invariants.md](toc/invariants.md) |
| pi | 1 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Adjudication policy computed in code](architecture/adjudication-policy.md) — Thresholds and composite scores are computed in code, making Jev verdicts advisory and policy changes model-free. (2026-09-20)
- [Claim schema drift between the skill and code](architecture/gotcha-skill-schema-drift.md) — Historical: the llm-wiki skill was the only documentation of the page-claim schema and its status list had drifted from the code; SKILL.md now documents needs_recheck, reviewed, last_checked, needs_review, the YAML subset, and the rule to update it alongside the code. (2026-09-20)
- [Bypass-2FA token restrictions since August 2026](decisions/bypass-2fa-token-restrictions.md) — Since August 2026, bypass-2FA tokens on npm cannot perform account or package-governance actions, and direct publishing with them is scheduled for removal in January 2027. (2026-09-20)
- [Lint Queues Unbacked Claims](decisions/lint-queues-unbacked-claims.md) — The wiki lint process queues claims lacking accepted ledger entries as review items instead of deleting or rejecting them, because a missing ledger entry may be a bookkeeping gap rather than bad knowledge. (2026-09-20)
- [OIDC trusted publishing requires an existing npm package](invariants/oidc-requires-existing-package.md) — A trusted publisher (OIDC) can only be configured on a package that already exists on the npm registry; staged publishing explicitly cannot create a brand-new package. (2026-09-20)
