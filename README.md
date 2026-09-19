# jev-wiki

A pi package that gives coding agents a maintained **mental model of a project**: module
responsibilities, boundaries, data flow, invariants, decisions, and change impact — stored as a
markdown wiki and maintained with **Jev** (TypeSafe's calibrated decision model).

Jev decides what is grounded, derivable, durable, and where it belongs. The agent writes. Code
owns every threshold.

- Read [`PLAN.md`](PLAN.md) for the design and phases.
- Read [`CRITIQUE.md`](CRITIQUE.md) for the risk analysis and efficiency evaluation.
- Research sources live in [`research/`](research/README.md).

## What it does

| Tool | Purpose |
|---|---|
| `wiki_toc` | the wiki table of contents (filter by topic/tag/query) |
| `wiki_ask` | find pages and excerpts relevant to a question |
| `wiki_ingest` | ingest a document: raw source → claims → Jev verdicts → placement brief |
| `wiki_insights` | capture agent insights from a work session, Jev-filtered and placed |
| `wiki_finalize` | update TOC/log after writing pages, check links |
| `wiki_status` | pages, raw sources, ledger, Jev usage |
| `/wiki:ingest <path>` · `/wiki:capture` · `/wiki:status` | commands |

The wiki is **never injected** into sessions. The table of contents is available like a skill
(`wiki_toc` + the `llm-wiki` skill); the agent consults it on demand.

## Install

```bash
pi install /path/to/jev-wiki
# or from npm/git once published
```

For development, load it directly:

```bash
pi -e ./src/extension.ts --skill ./skills/llm-wiki
```

## Configuration

The API key comes from a project-root `.env` (gitignored):

```bash
JEV_TOKEN=your-typesafe-token
```

Or use pi's existing OpenRouter login. Optional overrides in `~/.pi/agent/jev-wiki.json` or
project `.pi/jev-wiki.json` (see `src/config.ts` for all keys):

```json
{
  "provider": "typesafe",
  "model": "jev-latest",
  "wikiRoot": "docs/wiki",
  "writer": { "mode": "guided" },
  "thresholds": { "autoAccept": 0.8, "minDerivable": 0.5 }
}
```

Provider presets: `typesafe` (default), `openrouter`, `aimlapi`.

## Wiki layout

```
docs/wiki/
├── raw/<topic>/YYYY-MM-DD-slug.md   # immutable sources (documents + session captures)
└── wiki/
    ├── index.md                     # generated table of contents
    ├── log.md                       # generated append-only log
    ├── architecture/                # module-*, flow-*, layer-*
    ├── invariants/                  # invariant-*
    ├── decisions/                   # decision-* (ADR-style)
    ├── impact/                      # impact-* (derived)
    └── <topic>/                     # gotcha-*, glossary-*, concept-*, summary-*
```

Runtime state lives in `docs/wiki/.jev-wiki/` (gitignored): the decision ledger
(`decisions.jsonl`), raw-source hash index, and session log.

## Development

```bash
npm install
npx tsc --noEmit      # typecheck
npm run smoke         # deterministic checks + live Jev round-trips
```

## Status

P0 (walking skeleton) implemented: both intake channels (research ingest + agent insights),
architecture-first pages, TOC/log, decision ledger, Jev client with retries and usage accounting,
guided writing. See `PLAN.md` §9 for P1–P3 (change-driven invalidation, paged routing beyond 250
pages, agent-managed review queue, lint, decision-quality evaluation).
