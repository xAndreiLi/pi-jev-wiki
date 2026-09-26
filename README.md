# pi-jev-wiki

[![npm version](https://img.shields.io/npm/v/pi-jev-wiki.svg)](https://www.npmjs.com/package/pi-jev-wiki)
[![license](https://img.shields.io/npm/l/pi-jev-wiki.svg)](LICENSE)

**Give your agents a long-term memory they can actually trust.** `pi-jev-wiki` builds a living,
interconnected wiki — a knowledge graph in plain markdown — from your documents, sessions, and
agent insights. Every claim is vetted by **Jev** (TypeSafe's calibrated decision model) for what is
factual, grounded, and worth keeping, so the wiki stays concise instead of becoming another dumping
ground. Agents search it on demand across every registered wiki, and you can read, edit, and
version it like any other Markdown.

Works for any domain: a project's mental model (module boundaries, invariants, decisions, change
impact), personal and life knowledge, research notes — anything an agent should remember between
sessions.

> **Naming:** the package and repository are **`pi-jev-wiki`**. The extension, its tools, and its
> config and state files keep the shorter `jev-wiki` name — `.pi/jev-wiki.json`,
> `~/.pi/agent/jev-wiki.json`, `docs/wiki/.jev-wiki/`.

## Why agents keep consulting it

- **Never injected.** Nothing is pushed into the context window; the table of contents is exposed
  like a skill and the agent reads what it needs, when it needs it.
- **Vetted, not dumped.** Jev gates what enters: grounded in evidence, durable, non-duplicative,
  and free of secrets. The wiki is not a second copy of your repository.
- **Searchable.** Lexical (index/BM25), semantic (local embeddings, no API calls), or hybrid
  retrieval — across **all registered wikis** from any session.
- **Auditable.** Every claim carries evidence and a lifecycle status; every decision lands in a
  ledger. Contradictions become visible disputes, never silent edits.
- **Portable.** Plain Markdown in your project (Obsidian-compatible, git-friendly); the semantic
  index is a derived cache you can rebuild or delete at any time.

## How knowledge is vetted

Jev acts as an arbiter and reminder on what is grounded, derivable, durable, and where it belongs;
the agent decides and writes, with the final say, and code owns every threshold.

1. **Extraction** — a source is staged immutably in `raw/` and split into atomic claims with
   verbatim quotes.
2. **Judgment** — Jev scores each claim for groundedness, derivability, durability, importance,
   duplication, sensitivity, and placement, then code maps those scores to a decision.
3. **Filing** — accepted claims are written into topic pages with `status`, `support`, and
   `evidence`; duplicates reinforce existing claims instead of creating noise.
4. **Review** — below-threshold and disputed claims go to the agent-owned review queue; only
   critical items escalate to the user. Overrides are allowed and recorded in the ledger.
5. **Upkeep** — file-linked claims are re-verified against commits (`wiki_sync`), lint catches
   stale, orphaned, or unbacked claims, and superseded knowledge is linked, never deleted.

## What it does

| Tool | Purpose |
|---|---|
| `wiki_toc` | the local wiki's contents (topic/tag/query filters), another registered wiki by name, or the cross-wiki catalog with index health (`scope: all`) |
| `wiki_ask` | search pages and excerpts (auto / index / BM25 / vector / hybrid / qmd), with `scope: all` across registered wikis |
| `wiki_index` | manage the semantic index: `status`, `model`, `discover`, `rebuild`, `add`/`remove`, `enable`/`disable` |
| `wiki_ingest` | ingest a document: raw source → claims → Jev verdicts → placement brief |
| `wiki_insights` | capture agent insights, Jev-filtered and placed |
| `wiki_finalize` | update TOC/log after writing pages, check links, record overrides, refresh the index |
| `wiki_sync` | re-verify file-linked claims against commits since the last sync |
| `wiki_review` | list or resolve review items (bulk resolve supported); critical items escalate to the user |
| `wiki_lint` | health checks: TOC, links, orphans, unbacked claims, contradictions, duplicates |
| `wiki_remove` | delete obsolete pages and their TOC entries |
| `wiki_structure` | deterministic module/dependency map and architecture coverage |
| `wiki_triage` | explain rejected claims: scores, whether the problem is evidence or policy, and the fix |
| `wiki_doctor` | config, key, lock, ledger, queue, git/sync, search health |
| `wiki_setup` | inspect or configure the Jev API key (TypeSafe or OpenRouter) |
| `wiki_status` | pages, raw sources, ledger, consultations, Jev usage |
| `/wiki:ingest`, `/wiki:capture`, `/wiki:sync`, `/wiki:review`, `/wiki:lint`, `/wiki:status` | user-facing commands |

**Semantic search is local-first.** Embeddings run on your machine (`@huggingface/transformers`)
and vectors live in an embedded Postgres with pgvector (`@electric-sql/pglite`). No API keys, no
Docker, no Python, and nothing leaves the machine. If the optional dependencies or the index are
missing, everything degrades gracefully to keyword search.

## Install

```bash
pi install npm:pi-jev-wiki                        # published release
pi install /path/to/pi-jev-wiki                   # local folder
pi install git:github.com/xAndreiLi/pi-jev-wiki@v0.5.0
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

## Search in practice

`wiki_ask` picks a retrieval mode automatically (`search.engine: "auto"` → hybrid when an index
exists, keyword otherwise) and can search every registered wiki:

| Mode | What it does |
|---|---|
| `keyword` | TOC/index or BM25 over page text; zero dependencies |
| `semantic` | cosine KNN over claim- and section-level embeddings |
| `hybrid` | **RRF fusion** of BM25 and vector ranks — the default once indexed |
| `scope: "all"` | searches every registered wiki (life wiki, project wikis, WSL projects), tagging results `[wiki-name]` with page, claim id, kind, and status |

Choosing the embedding model happens once, before the first build; the agent asks and persists the
answer with `wiki_index action=model`:
| Preset | Model | Download | Dims | Best for |
|---|---|---|---|---|
| `performance` | EmbeddingGemma-300M (q8) | ~309 MB | 768 | everyday use, multilingual, fastest |
| `quality` | Qwen3-Embedding-0.6B (q8) | ~614 MB | 1024 | maximum retrieval quality |

First run: `wiki_index action=rebuild` downloads the model once into `<agent dir>/jev-wiki/models`
and builds the index; afterwards `wiki_finalize` keeps touched pages in sync automatically. Queries
never trigger a download — a cold index silently falls back to keyword search. Existing wikis are
found with `wiki_index action=discover` (scans the home directory and WSL distros), adopted with
`register=true`, and indexed with `rebuild all=true`. Switching presets re-embeds everything and
purges the previous model's vectors per wiki.

## Configuration

Optional overrides in `~/.pi/agent/jev-wiki.json` or project `.pi/jev-wiki.json`
(see `src/config.ts` for all keys):

```json
{
  "provider": "typesafe",
  "wikiRoot": "docs/wiki",
  "globalWikiRoot": null,
  "writer": { "mode": "guided" },
  "review": { "autoAcceptUserStated": true },
  "thresholds": { "autoAccept": 0.8, "minDerivable": 0.5 },
  "search": {
    "engine": "auto",
    "vector": { "enabled": true, "model": "performance", "scan": { "wsl": true } },
    "jev": { "rerank": "auto", "sufficiency": true }
  }
}
```

The optional `globalWikiRoot` adds a read-only cross-project vault: `wiki_ask` also searches that
wiki and tags its results `[global vault]`. It resolves against the pi agent dir when relative.

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

`raw/` and `wiki/` are the source of truth. Runtime state lives in `docs/wiki/.jev-wiki/`
(gitignored): the decision ledger (`decisions.jsonl`), the raw-source hash index, and the session
log. The semantic index lives at `<agent dir>/jev-wiki/` and is always disposable.

## Development

```bash
npm install
npm run test:all      # typecheck + unit + scale + vector tests (offline)
npm run smoke         # deterministic checks + live Jev round-trips
```

## Repository layout

```text
src/          pi extension, Jev client, pipelines, wiki primitives, vector search
skills/       llm-wiki skill + page templates (the schema layer)
scripts/      unit, smoke, paging, scale, and vector tests
docs/
  notes/      design notes (e.g. semantic-search.md)
  plans/      PLAN.md (master plan) + plans index
  DESIGN.md   detailed technical design
  CRITIQUE.md pre-implementation critique and efficiency evaluation
  HARDENING.md hardening roadmap with statuses
  wiki/       this project's own knowledge wiki (dogfood)
  RELEASING.md release runbook
research/     source material gathered during design
```

The published npm package ships only `src/`, `skills/`, `README.md`, and `LICENSE`; everything
under `docs/` and `research/` stays in the repository.

## Status

**Published:** [`pi-jev-wiki@0.5.0`](https://www.npmjs.com/package/pi-jev-wiki) — CI-published with
SLSA provenance (`0.2.0`, the first release, was an interactive publish and has no attestation).
Listed on the [pi package gallery](https://pi.dev/packages/pi-jev-wiki).

0.5.0 adds cross-wiki semantic search (PGlite + pgvector, `performance`/`quality` model presets,
RRF hybrid retrieval), wiki discovery and adoption, the embedding-model choice flow, advisory Jev
verdicts with a recorded override ledger, bulk review resolution, and the first-run/shutdown fixes.

**Unreleased on `main`:** the cross-wiki catalog (`wiki_toc scope=all`) with per-wiki TOC
manifests and staleness flags, Jev retrieval judgments (batched rerank + evidence sufficiency),
wiki-tagged lexical results, granularity-aware fusion, and generated-file exclusion from the index.

Implemented through P3: both intake channels (research ingest + agent insights), architecture-first
pages, TOC/log, decision ledger, change-driven invalidation (`wiki_sync`), agent-managed review,
draft/auto writers with adaptive risk, pluggable search (index/BM25/qmd plus the vector engine),
lint/consolidation checks, redaction, cross-process locking, and offline unit + scale + vector tests.

Not yet done: the decision-quality evaluation harness (recall@5/MRR benchmarks to tune the default
retrieval mode), OIDC trusted publishing, server-Postgres and cloud embedding providers, and the
remaining hardening items tracked in [`docs/HARDENING.md`](docs/HARDENING.md). See
[`docs/RELEASING.md`](docs/RELEASING.md) for the release process.
