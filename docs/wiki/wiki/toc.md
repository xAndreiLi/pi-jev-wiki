# Wiki TOC

> 22 pages across 3 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 5 | [toc/architecture.md](toc/architecture.md) |
| decisions | 9 | [toc/decisions.md](toc/decisions.md) |
| invariants | 8 | [toc/invariants.md](toc/invariants.md) |

## Recently updated
- [Bypass-2FA token restrictions since August 2026](decisions/bypass-2fa-token-restrictions.md) — Since August 2026, bypass-2FA tokens on npm cannot perform account or package-governance actions, and direct publishing with them is scheduled for removal in January 2027. (2026-09-20)
- [Lint Queues Unbacked Claims](decisions/lint-queues-unbacked-claims.md) — The wiki lint process queues claims lacking accepted ledger entries as review items instead of deleting or rejecting them, because a missing ledger entry may be a bookkeeping gap rather than bad knowledge. (2026-09-20)
- [OIDC trusted publishing requires an existing npm package](invariants/oidc-requires-existing-package.md) — A trusted publisher (OIDC) can only be configured on a package that already exists on the npm registry; staged publishing explicitly cannot create a brand-new package. (2026-09-20)
- [Package-scoped granular tokens cannot create new npm packages](invariants/granular-token-all-packages.md) — A package-scoped granular access token cannot create a new package name on npm; the 'All Packages' permission is required for initial package creation. (2026-09-20)
- [package.json repository fields must point to the real repo before publishing](invariants/package-json-repository-fields.md) — The repository, homepage, and bugs fields in package.json must point at the real repository before publishing to npm. (2026-09-20)
