# invariants

| Page | Type | Tags | Summary | Updated |
|------|------|------|---------|---------|
| [Generated files are never hand-edited](invariants/generated-files.md) | invariant | generated toc log | wiki/index.md and wiki/log.md are generated files and must never be hand-edited. | 2026-09-19 |
| [Jev returns typed decisions, never text](invariants/jev-typed-decisions.md) | invariant | jev types api | The Jev decision model must return typed decisions (noul, choice, score) rather than free-form text. | 2026-09-19 |
| [Load-bearing claims require verbatim evidence](invariants/claim-evidence.md) | invariant | claims evidence quality | Every load-bearing claim must point at verbatim evidence in a raw source or a file/commit/test. | 2026-09-19 |
| [Raw sources are immutable](invariants/raw-immutable.md) | invariant | raw immutability evidence | Raw sources under raw/ are immutable; the wiki only ever reads them. | 2026-09-19 |
| [Wiki layout derives from a single root](invariants/wiki-layout-atomic-root.md) | invariant | filesystem layout atomic paths | raw/ and wiki/ derive from wikiRoot, while runtime state is independently configurable via stateRoot, which may be absolute. | 2026-09-19 |
