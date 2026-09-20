---
name: llm-wiki
description: "Use when working with the project knowledge wiki: consulting architecture/decisions before changes, ingesting documents, capturing session insights, or maintaining the wiki. Triggers: 'wiki', 'what do we know about', 'why is it built this way', 'ingest', 'capture insights', 'add to wiki'."
---

# Project Wiki (jev-wiki)

The project has a knowledge wiki at `docs/wiki/` (configurable) holding the **mental model** of
the system: how it is structured, why, and what a change touches. It is not a copy of the code.
Jev (a calibrated decision model) judges whether claims are grounded, derivable, durable, and
where they belong; you do the writing.

## Setup (when no key is configured)

If Jev calls fail with an authentication error, or the user asks how to connect a provider:

1. `wiki_setup action=status` — shows the provider, endpoint, and where the key came from (never the value).
2. `wiki_setup action=guide provider=typesafe|openrouter` — exact env var, file, and config steps.
3. Ask the user for the key, then either have them add it to the project `.env` or write it with
   `wiki_setup action=write-env provider=... apiKey=...` (this checks that `.env` is gitignored first).
4. `wiki_setup action=test` — one tiny live call to verify connectivity and auth.

Never print the key value. TypeSafe uses `TYPESAFE_API_KEY` (`JEV_TOKEN` also works); OpenRouter
uses `OPENROUTER_API_KEY` with provider `openrouter`, or pi's own `/login openrouter` credential.

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

### Respect the verdicts

Jev's adjudication is binding: write only claims the brief marks **File** or **Reinforce**.
Rejected claims are **not** written to the wiki — even when the user explicitly asks for that
content. Report what was rejected and why, so the user can supply better evidence or a stronger
artifact. Never hand-write a rejected claim into a page.

### When an insight is rejected

Rejections are diagnosable — run `wiki_triage` to see the scores, the reason, and the fix for each:

- **derivable from code**: add what the code cannot show — a commit message (evidence `kind: commit`),
  a source quote, or the rationale behind the decision. High-importance architecture, invariant, and
  decision framing is queued for confirmation instead of dropped.
- **unsupported**: attach evidence that *states* the claim: a verbatim quote, the commit that
  introduced it, or the user's own words (`kind: user`). Referencing a file without a supporting
  passage is not enough.
- **duplicate**: find the page that covers it and reinforce or extend it instead of filing a new claim.
- **sensitive**: never file it; redact secrets and PII first.

If a rejected claim still matters after the remedy, re-submit it with the better evidence rather
than writing it by hand.

### Ingest a document (research channel)

1. `wiki_ingest` with `path` (or `text`) — it stores the raw source, extracts claims, and returns
   a Jev-verified brief.
2. Write or merge the **accepted** pages (guided mode: you write).
3. `wiki_finalize` with every touched page.

### Capture session insights (work channel)

1. Compose atomic insights with evidence pointers (files, commits, tests, user statements).
   No transient state, no code snippets, nothing derivable from the repo.
2. `wiki_insights` with the list — Jev filters (derivable/durable/sensitive), relates them to
   existing knowledge, and chooses placement. Include file/commit evidence: file evidence is read
   and excerpted for Jev, which grounds the decision.
3. Write or merge the **accepted** pages, then `wiki_finalize`.

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
