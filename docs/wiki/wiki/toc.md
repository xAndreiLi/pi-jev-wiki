# Wiki TOC

> 43 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 15 | [toc/architecture.md](toc/architecture.md) |
| decisions | 14 | [toc/decisions.md](toc/decisions.md) |
| invariants | 11 | [toc/invariants.md](toc/invariants.md) |
| pi | 3 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Degraded search is indistinguishable from an empty wiki](architecture/gotcha-silent-search-degradation.md) — A wiki_ask whose vector half fails returns local-wiki results, tagged and scored like real matches, with no warning in the default hybrid path — so an agent reading a low-recall result set concludes the knowledge is absent and re-derives what the wiki already holds. (2026-10-01)
- [Efficacy measurement substrate](architecture/flow-eval-substrate.md) — Agent-side cost, context, and discovery accounting derives from pi's own session JSONL rather than from instrumenting the package, and because the wiki is committed alongside the code, code and knowledge can be rewound to the same commit for a hindsight-free comparison. (2026-10-01)
- [pi-wiki-eval — the measurement package](architecture/module-pi-wiki-eval.md) — A separate npm package that measures where an agent's context went and whether the wiki replaced codebase discovery: it derives episodes, cost, tool buckets, and the rediscovery join entirely from pi's session JSONL and the wiki's on-disk state, with no dependency on this extension. (2026-10-01)
- [The A/B evaluation harness](architecture/eval-harness.md) — The controlled wiki-on/wiki-off experiment: task cards replayed from a repository's own commits, run in throwaway clones whose target commit is pruned to be unreachable, with each arm's tool loadout verified from the session before any number is trusted. (2026-10-01)
- [Wiki maintenance is not wiki consultation](architecture/gotcha-wiki-consultation-vs-maintenance.md) — Counting every `wiki_*` call as consultation overstates use badly, because capture and upkeep dominate: splitting reads from writes dropped the measured rate from 93% to 30% on this repository, 87% to 60% on calisthenics, and 80% to 30% on discord-assistant. (2026-10-01)
