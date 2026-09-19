---
name: llm-wiki
description: "Use when working with the project knowledge wiki: consulting architecture/decisions before changes, ingesting documents, capturing session insights, or maintaining the wiki. Triggers: 'wiki', 'what do we know about', 'why is it built this way', 'ingest', 'capture insights', 'add to wiki'."
---

# Project Wiki (jev-wiki)

The project has a knowledge wiki at `docs/wiki/` (configurable) holding the **mental model** of
the system: how it is structured, why, and what a change touches. It is not a copy of the code.
Jev (a calibrated decision model) judges whether claims are grounded, derivable, durable, and
where they belong; you do the writing.

## The quality bar

File only what the repository cannot answer cheaply:

- **Delete test** — if deleting the page would just send a future agent back to reading code, it
  does not belong.
- **Decision test** — does it help decide *where a change belongs* or *what a change breaks*?

Good: module responsibilities and boundaries, dependency direction, data flow, invariants,
decisions with rationale, change-impact knowledge, historical attempts, external constraints,
domain glossary. Bad: function bodies, obvious implementation, transient task state, code excerpts.

## Layout

```
docs/wiki/
├── raw/<topic>/YYYY-MM-DD-slug.md   # immutable sources (never edit)
└── wiki/
    ├── index.md                     # TOC — generated, never hand-edit
    ├── log.md                       # append-only, generated
    ├── architecture/                # module-*.md · flow-*.md · layer-*.md
    ├── invariants/                  # invariant-*.md
    ├── decisions/                   # decision-*.md (ADR-style)
    ├── impact/                      # impact-*.md (derived)
    └── <topic>/                     # gotcha-*.md · glossary-*.md · concept-*.md · summary-*.md
```

## When to consult

Before architectural, cross-cutting, or unfamiliar changes; when planning work; when a project
term is unclear; before answering "how does X work here?".

1. `wiki_toc` — browse the table of contents (filter by topic/tag/query).
2. `wiki_ask` — find relevant pages for a question.
3. `read` the pages it returns, then cite them (`docs/wiki/wiki/...`) in your answer.
4. Never invent wiki content; if it is not there, say so and consider whether it should be.

## Operating the wiki

### Ingest a document (research channel)

1. `wiki_ingest` with `path` (or `text`) — it stores the raw source, extracts claims, and returns
   a Jev-verified brief.
2. Write or merge the recommended pages (guided mode: you write).
3. `wiki_finalize` with every touched page.

### Capture session insights (work channel)

1. Compose atomic insights with evidence pointers (files, commits, tests, user statements).
   No transient state, no code snippets, nothing derivable from the repo.
2. `wiki_insights` with the list — Jev filters (derivable/durable/sensitive), relates them to
   existing knowledge, and chooses placement.
3. Write or merge the recommended pages, then `wiki_finalize`.

## Page format

```markdown
---
title: Auth module
type: architecture/module
topic: architecture
summary: Owns token validation and session issuance.
tags: [auth, security]
updated: 2026-09-19
sources: [raw/auth/2026-09-19-auth-notes.md]
claims:
  - id: c1
    text: "Token validation lives in the auth module and is the only issuer of sessions."
    status: verified        # verified | user-stated | unsupported | contradicted | disputed | superseded
    support: 0.96
    evidence: ["raw/auth/2026-09-19-auth-notes.md"]
files: [src/auth/index.ts]
---

# Auth module

Responsibility, public surface, dependencies, invariants, and key files.

## Invariants
- ...

## Change impact
- ...

## See also
- [Session flow](../architecture/flow-session.md)
```

Rules:

- Every load-bearing claim points at raw evidence or a file/commit/test; numbers and quotes must
  exist verbatim in the source.
- Never silently rewrite history. Superseded or contradicted claims keep their text, get
  `status: superseded|disputed`, and link the newer claim/source.
- Relative links inside the wiki; project-relative paths when citing in conversation.
- One level of topic subdirectories; page names are kebab-case and describe the subject, not the
  source file.
- Prefer updating an existing page over creating a new one — but if nothing fits, create one and
  let the TOC absorb it.

## Maintenance

- If a page's claim is invalidated by code you changed this session, update it (or mark it
  `needs_recheck`) and mention it in your summary.
- When you notice a contradiction between pages, mark both with `status: disputed` and cross-link
  them; do not silently pick a winner.
- Report broken links and orphans to the user; `wiki_finalize` checks links on touched pages.

Templates live in `references/` next to this skill: `module.md`, `flow.md`, `invariant.md`,
`decision.md`, `gotcha.md`.
