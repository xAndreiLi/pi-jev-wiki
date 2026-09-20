# decisions

| Page | Type | Tags | Summary | Updated |
|------|------|------|---------|---------|
| [Agent-managed review with user escalation for critical items](decisions/review-escalation.md) | decision | review escalation workflow | Review work is agent-managed. The user is only escalated for critical items such as security, breaking API changes, or data loss. | 2026-09-19 |
| [Bypass-2FA token restrictions since August 2026](decisions/bypass-2fa-token-restrictions.md) | decision | npm tokens 2fa security ci | Since August 2026, bypass-2FA tokens on npm cannot perform account or package-governance actions, and direct publishing with them is scheduled for removal in January 2027. | 2026-09-20 |
| [Decision ledger retention](decisions/decision-rejected-claims-stay-visible-in.md) | decision | decisions ledger audit threshold-tuning retention | Rejected claims remain visible in the decision ledger to support future threshold tuning audit. | 2026-09-19 |
| [Guided writing as default mode](decisions/guided-writing.md) | decision | workflow writing policy | Jev decides placement, the agent writes the content, and code enforces policy. | 2026-09-19 |
| [Lint Queues Unbacked Claims](decisions/lint-queues-unbacked-claims.md) | decision | lint claims review-queue ledger bookkeeping | The wiki lint process queues claims lacking accepted ledger entries as review items instead of deleting or rejecting them, because a missing ledger entry may be a bookkeeping gap rather than bad knowledge. | 2026-09-20 |
| [Provider-agnostic Jev client schema](decisions/provider-agnostic-schema.md) | decision | jev provider typesafe openrouter aimlapi configuration | Provider switching between TypeSafe, OpenRouter, and AI/ML API is configuration only, because every provider accepts the same System One request schema. | 2026-09-19 |
| [Retry Handling in Client](decisions/retry-handling-in-client.md) | decision | lint claims review-queue ledger bookkeeping | Unbacked claims are queued as review items rather than deleted, because a missing ledger entry may indicate a bookkeeping gap rather than bad knowledge. | 2026-09-19 |
| [Scope boundary — exclude derivable knowledge](decisions/scope-boundary.md) | decision | scope policy wiki | jev-wiki deliberately excludes anything a developer could re-derive from the repository in under a minute. | 2026-09-19 |
| [Wiki root defaults to docs/wiki](decisions/wiki-root-location.md) | decision | location workspace root | The wiki root defaults to docs/wiki so knowledge lives next to the code it describes. | 2026-09-19 |
