# invariants

| Page | Type | Tags | Summary | Updated |
|------|------|------|---------|---------|
| [Filing boundaries](invariants/filing-boundaries.md) | invariant | adjudication boundaries sensitive injection contradictions | Two boundaries are absolute even though Jev verdicts are advisory: sensitive content and injected instructions are never filed, and contradictions are never resolved silently. | 2026-09-26 |
| [Generated files are never hand-edited](invariants/generated-files.md) | invariant | generated toc log | wiki/index.md and wiki/log.md are generated files and must never be hand-edited. | 2026-09-19 |
| [Jev returns typed decisions, never text](invariants/jev-typed-decisions.md) | invariant | jev types api | The Jev decision model must return typed decisions (noul, choice, score) rather than free-form text. | 2026-09-19 |
| [Load-bearing claims require verbatim evidence](invariants/claim-evidence.md) | invariant | claims evidence quality | Every load-bearing claim must point at verbatim evidence in a raw source or a file/commit/test. | 2026-09-19 |
| [OIDC trusted publishing requires an existing npm package](invariants/oidc-requires-existing-package.md) | invariant | npm publishing oidc provenance | A trusted publisher (OIDC) can only be configured on a package that already exists on the npm registry; staged publishing explicitly cannot create a brand-new package. | 2026-09-20 |
| [Package-scoped granular tokens cannot create new npm packages](invariants/granular-token-all-packages.md) | invariant | npm tokens publishing granular | A package-scoped granular access token cannot create a new package name on npm; the 'All Packages' permission is required for initial package creation. | 2026-09-20 |
| [package.json repository fields must point to the real repo before publishing](invariants/package-json-repository-fields.md) | invariant | npm package.json publishing metadata | The repository, homepage, and bugs fields in package.json must point at the real repository before publishing to npm. | 2026-09-20 |
| [Raw sources are immutable](invariants/raw-immutable.md) | invariant | raw immutability evidence | Raw sources under raw/ are immutable; the wiki only ever reads them. | 2026-09-19 |
| [Wiki layout derives from a single root](invariants/wiki-layout-atomic-root.md) | invariant | filesystem layout atomic paths | raw/ and wiki/ derive from wikiRoot, while runtime state is independently configurable via stateRoot, which may be absolute. | 2026-09-26 |
