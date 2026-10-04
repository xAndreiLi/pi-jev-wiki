# Wiki TOC

> 49 pages across 4 topics. Per-topic tables: `toc/<topic>.md`. Full machine index: `index.md`.

| Topic | Pages | Table |
|-------|-------|-------|
| architecture | 19 | [toc/architecture.md](toc/architecture.md) |
| decisions | 15 | [toc/decisions.md](toc/decisions.md) |
| invariants | 11 | [toc/invariants.md](toc/invariants.md) |
| pi | 4 | [toc/pi.md](toc/pi.md) |

## Recently updated
- [Auto-retrieval injects a Jev-gated wiki brief on every prompt](decisions/auto-retrieval-injection.md) — The session wiki is searched on every prompt and a Jev-gated, budgeted <auto-retrieval> brief is injected before the first provider request; it is session-wiki-only, fails closed, and is logged as op auto — never as a consultation. (2026-10-04)
- [before_agent_start can inject a message into the prompt batch](pi/before-agent-start-injection.md) — A pi extension can return a custom message from the before_agent_start hook; pi appends it to the same batch as the user prompt, before the first provider request, so it is both rendered in the transcript and present in LLM context. display controls TUI rendering only, and a trailing message preserves the cached prompt prefix that a system-prompt change would drop. (2026-10-04)
- [A vector store that will not open is rebuilt, not repaired](architecture/gotcha-corrupt-vector-store-recovery.md) — A corrupt PGlite store (~/.pi/agent/jev-wiki/vector) aborts every open with a checkpoint PANIC, and wiki_ask quietly falls back to lexical search. The store is a derived cache, so delete the directory and rebuild all wikis; it works from the running session because PGliteVectorDb only caches its handle after initialization succeeds. (2026-10-02)
- [Eval cards must target committed files — a gitignored AGENTS.md is absent from every arm](architecture/gotcha-eval-cards-ignored-files.md) — Every eval arm's working tree is a git clone checked out at the base commit, so files the testbed gitignores — discord-assistant's AGENTS.md, memory/, .env — exist in no arm. A card that requires changing a gitignored file, or a grader that reads one, is unsatisfiable; anchor on committed files, and on AGENTS.example.md where the live file is ignored. (2026-10-02)
- [Degraded search is indistinguishable from an empty wiki](architecture/gotcha-silent-search-degradation.md) — A wiki_ask whose vector half fails returns local-wiki results, tagged and scored like real matches, with no warning in the default hybrid path — so an agent reading a low-recall result set concludes the knowledge is absent and re-derives what the wiki already holds. (2026-10-01)
