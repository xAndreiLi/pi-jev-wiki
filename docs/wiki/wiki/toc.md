# Wiki TOC

> 45 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 17 | [toc/architecture.md](toc/architecture.md) |
| decisions | 14 | [toc/decisions.md](toc/decisions.md) |
| invariants | 11 | [toc/invariants.md](toc/invariants.md) |
| pi | 3 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Degraded search is indistinguishable from an empty wiki](architecture/gotcha-silent-search-degradation.md) — A wiki_ask whose vector half fails returns local-wiki results, tagged and scored like real matches, with no warning in the default hybrid path — so an agent reading a low-recall result set concludes the knowledge is absent and re-derives what the wiki already holds. (2026-10-01)
- [Efficacy measurement substrate](architecture/flow-eval-substrate.md) — Agent-side cost, context, and discovery accounting derives from pi's own session JSONL rather than from instrumenting the package, and because the wiki is committed alongside the code, code and knowledge can be rewound to the same commit for a hindsight-free comparison. (2026-10-01)
- [pi-wiki-eval — the measurement package](architecture/module-pi-wiki-eval.md) — A separate npm package that measures where an agent's context went and whether the wiki replaced codebase discovery: it derives episodes, cost, tool buckets, and the rediscovery join entirely from pi's session JSONL and the wiki's on-disk state, with no dependency on this extension. (2026-10-01)
- [The A/B evaluation harness](architecture/eval-harness.md) — The controlled wiki-on/wiki-off experiment: task cards run in throwaway clones under neutral temp paths, with the answer pruned, graders installed only after the agent, each arm's tool loadout verified, every session scanned for contamination, and fairness self-tested from the agent's side with a stub pi. (2026-10-01)
- [The A/B harness leaked the grader, the arm identity and the experiment (audit 2026-10-01)](architecture/gotcha-eval-harness-leaks.md) — An audit of r1-run-2026-10-01T08-44-45 and the E1 pilot found that every arm could read its hidden grader. The task copy's path named the harness, the run and the arm, the judge could see which arm wrote each diff, the brief arm got almost no knowledge, and wiki-nocapture still captured. E1 and R1 numbers therefore do not support conclusions about the wiki. (2026-10-01)
