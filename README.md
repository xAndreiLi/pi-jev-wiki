# jev-wiki

A pi package that gives coding agents a maintained **mental model of a project**: module
responsibilities, boundaries, data flow, invariants, decisions, and change impact — stored as a
markdown wiki and maintained with **Jev** (TypeSafe's calibrated decision model).

Jev decides what is grounded, derivable, durable, and where it belongs. The agent writes. Code
owns every threshold.

- Read [`PLAN.md`](docs/plans/PLAN.md) for the design and phases.
- Read [`CRITIQUE.md`](docs/CRITIQUE.md) for the risk analysis and efficiency evaluation.
- Research sources live in [`research/`](research/README.md).

## What it does

| Tool | Purpose |
|---|---|
| `wiki_toc` | the wiki table of contents (compact above 60 pages, per-topic tables) |
| `wiki_ask` | find pages and excerpts (index / BM25 / qmd engine) |
| `wiki_ingest` | ingest a document: raw source → claims → Jev verdicts → placement brief |
| `wiki_insights` | capture agent insights, Jev-filtered and placed |
| `wiki_finalize` | update TOC/log after writing pages, check links |
| `wiki_sync` | re-verify file-linked claims against commits since the last sync |
| `wiki_review` | list or resolve review items; critical items escalate to the user |
| `wiki_lint` | health checks: TOC, links, orphans, unbacked claims, contradictions, duplicates |
| `wiki_remove` | delete obsolete pages and their TOC entries |
| `wiki_structure` | deterministic module/dependency map and architecture coverage |
| `wiki_doctor` | config, key, lock, ledger, queue, git/sync, search health |
| `wiki_setup` | inspect or configure the Jev API key (TypeSafe or OpenRouter) |
| `wiki_status` | pages, raw sources, ledger, consultations, Jev usage |
| `/wiki:ingest`, `/wiki:capture`, `/wiki:sync`, `/wiki:review`, `/wiki:lint`, `/wiki:status` | user-facing commands |

The wiki is **never injected** into sessions. The table of contents is available like a skill
(`wiki_toc` + the `llm-wiki` skill); the agent consults it on demand.

## Install

```bash
pi install /path/to/jev-wiki        # local folder
pi install npm:jev-wiki             # once published
pi install git:github.com/<owner>/jev-wiki@v0.2.0
```

For development, load it directly:

```bash
pi -e ./src/extension.ts --skill ./skills/llm-wiki
```

## API keys

Both supported providers speak the same Jev Decisions schema:

| Provider | Env var | Endpoint | Context | Notes |
|---|---|---|---|---|
| **TypeSafe** (official, default) | `TYPESAFE_API_KEY` (or `JEV_TOKEN`) | `https://api.typesafe.ai/v1/systemone` | 64k | $0.042/Mtok input, output free |
| **OpenRouter** | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/alpha/decisions` | 32k advertised | set `provider: "openrouter"`; or reuse pi's `/login openrouter` credential |

Put the key in a project-root `.env` (gitignored — `wiki_doctor` verifies):

```bash
TYPESAFE_API_KEY=...     # TypeSafe
# or
OPENROUTER_API_KEY=...   # OpenRouter
```

Or reference it from config with `$VAR` indirection:

```json
{ "provider": "openrouter", "apiKey": "$OPENROUTER_API_KEY", "model": "~typesafe/jev-latest" }
```

When a key is missing, ask the agent to run `wiki_setup`:

- `action=status` — provider, endpoint, and where the key came from (never the value)
- `action=guide provider=typesafe|openrouter` — exact env var, file, and config steps
- `action=write-env provider=... apiKey=...` — writes to `.env` after checking gitignore
- `action=test` — one tiny live call to verify connectivity and auth

## Configuration

Optional overrides in `~/.pi/agent/jev-wiki.json` or project `.pi/jev-wiki.json`
(see `src/config.ts` for all keys):

```json
{
  "provider": "typesafe",
  "model": "jev-latest",
  "wikiRoot": "docs/wiki",
  "writer": { "mode": "guided" },
  "thresholds": { "autoAccept": 0.8, "minDerivable": 0.5 }
}
```

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

## Repository layout

```text
src/          pi extension, Jev client, pipelines, wiki primitives
skills/       llm-wiki skill + page templates (the schema layer)
scripts/      unit, smoke, paging, and scale tests
docs/
  plans/      PLAN.md (master plan) + plans index
  DESIGN.md   detailed technical design
  CRITIQUE.md pre-implementation critique and efficiency evaluation
  HARDENING.md hardening roadmap with statuses
  notes/      source notes used for dogfooding
  wiki/       this project's own knowledge wiki (dogfood)
research/     source material gathered during design
```

The published npm package ships only `src/`, `skills/`, `README.md`, and `LICENSE`; everything
under `docs/` and `research/` stays in the repository.

## Status

P0 (walking skeleton) implemented: both intake channels (research ingest + agent insights),
architecture-first pages, TOC/log, decision ledger, Jev client with retries and usage accounting,
guided writing. See `docs/plans/PLAN.md` §9 for P1–P3 (change-driven invalidation, paged routing beyond 250
pages, agent-managed review queue, lint, decision-quality evaluation).
