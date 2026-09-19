# Research artifacts (2026-09-19)

Primary sources fetched during the design of `jev-wiki`. Everything here is a local copy for
reference; see [`../docs/DESIGN.md`](../docs/DESIGN.md) for the synthesis.

## Jev / TypeSafe AI

| File | Source | What it contains |
|---|---|---|
| `typesafe-blog.md` | https://typesafe.ai/blog/introducing-system-one-models-and-jev | Launch post: System One models, RLCD, speed/cost claims, hallucination/type-safety, demos |
| `typesafe-intro.md` | https://docs.typesafe.ai/introduction | Primitives overview (choice/score/noul), atomic questions |
| `ts-primitives.md`, `ts-primitives-choice.md`, `ts-primitives-score.md`, `ts-primitives-noul.md`, `ts-primitives-advanced.md` | docs.typesafe.ai/primitives/* | Exact question semantics, limits (255 options, 2–10 levels), examples |
| `ts-confidence.md` | docs.typesafe.ai/confidence | Confidence derivation and how to use it |
| `ts-concepts-state.md` / `ts-state.md` | docs.typesafe.ai/concepts/state | Accepted `state` shapes (string/object/array), text-only |
| `ts-models.md` | docs.typesafe.ai/models | `jev-1.13.0` / `jev-latest`, pricing, rate limits, 64k context / 32k state budget |
| `ts-jaggedness.md` | docs.typesafe.ai/model-jaggedness/jev-1.13 | Known weaknesses: literal reading, no math/dates/counting, large-state decay, adversarial content |
| `ts-concepts-how-to-build-with-system-one.md` | docs.typesafe.ai/concepts/how-to-build-with-system-one | Code-in-control architecture, decomposition, weights in code |
| `ts-patterns*.md` | docs.typesafe.ai/patterns/* | Speculative fan-out, confidence-gated routing, composite scoring |
| `ts-sdk-js.md` | docs.typesafe.ai/sdk/javascript | `@typesafe-ai/sdk` quickstart (we may just use `fetch`) |
| `typesafe-llms.txt` | docs.typesafe.ai/llms.txt | Full documentation index |
| `aimlapi-jev.md` | docs.aimlapi.com/.../typesafe/jev | Gateway `POST /v1/decisions` schema + worked request/response |
| `openrouter-jev.md` | openrouter.ai endpoints + example repo + community note | OpenRouter Decisions API contract (config alternative; project now uses a TypeSafe token directly) |
| `marktechpost.md`, `llmreference.md` | news | Third-party summaries / model card notes |

Key endpoint: `POST https://api.typesafe.ai/v1/systemone` (`Authorization: Bearer <key>`).
Verified reachable from this machine (403 without a key). No key present locally.

## Karpathy's LLM wiki

| File | Source | What it contains |
|---|---|---|
| `karpathy-llm-wiki-gist.md` | https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f | The original idea file: three layers, ingest/query/lint, index.md + log.md, tips |
| `astrohan-SKILL.md` | https://github.com/Astro-Han/karpathy-llm-wiki | Production `SKILL.md`: grounding invariant, triage, cascade rules, lint fix/report split |
| `llmwiki-v2-gist.md` | https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2 | Extensions: lifecycle/confidence, supersession, forgetting, graph, automation, privacy |
| `ts-patterns-fanout.md` | docs.typesafe.ai/patterns/fan-out | How to pack many questions into one request |

Also referenced: qmd (https://github.com/tobi/qmd) — local BM25 + vector + rerank search for
markdown, CLI and MCP, the recommended upgrade path once `index.md` stops scaling.

## pi harness notes (read in place, not copied)

All under `C:\Users\liand\AppData\Local\pi-node\current\node_modules\@earendil-works\pi-coding-agent\`:

- `docs/extensions.md` — tools, commands, events, `ctx.ui`, `withFileMutationQueue`, nested model calls
- `docs/packages.md` — packaging extensions/skills/prompts, `pi` manifest, npm/git/local sources
- `docs/skills.md` — skill format and discovery (the schema layer)
- `examples/extensions/structured-output.ts`, `todo.ts`, `custom-compaction.ts` — patterns used by the design
- `examples/plugins/pi-example-plugin` — experimental Chord facets; not the plugin model we need
