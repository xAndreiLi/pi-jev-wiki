---
name: llm-wiki
description: "Use when working with the project knowledge wiki: consulting architecture/decisions before changes, ingesting documents, capturing session insights, or maintaining the wiki. Triggers: 'wiki', 'what do we know about', 'why is it built this way', 'ingest', 'capture insights', 'add to wiki'."
---

# Project Wiki (jev-wiki)

The project has a knowledge wiki at `docs/wiki/` (configurable) holding the **mental model** of
the system: how it is structured, why, and what a change touches. It is not a copy of the code.
Jev (a calibrated decision model) judges whether claims are grounded, derivable, durable, and
where they belong; you do the writing.

**Read [How claims are judged](#how-claims-are-judged) before composing insights.** Most
rejections are phrasing or evidence problems that are easy to avoid once you know the gates.

## Setup (when no key is configured)

If Jev calls fail with an authentication error, or the user asks how to connect a provider:

1. `wiki_setup action=status` — shows the provider, endpoint, and where the key came from (never the value).
2. `wiki_setup action=guide provider=typesafe|openrouter` — exact env var, file, and config steps.
3. Ask the user for the key, then either have them add it to the project `.env` or write it with
   `wiki_setup action=write-env provider=... apiKey=...` (this checks that `.env` is gitignored first).
4. `wiki_setup action=test` — one tiny live call to verify connectivity and auth.

Never print the key value. TypeSafe uses `TYPESAFE_API_KEY` (`JEV_TOKEN` also works); OpenRouter
uses `OPENROUTER_API_KEY` with provider `openrouter`, or pi's own `/login openrouter` credential.

## How claims are judged

You are the writer; Jev decides. These are the criteria, in the order they are applied.

### The quality bar

File only what the repository cannot answer cheaply:

- **Delete test** — if deleting the page would send a future agent straight back to reading code,
  it does not belong. The one exception is high-importance framing (see the framing gate).
- **Decision test** — does it help decide *where a change belongs* or *what a change breaks*?

Good: module responsibilities and boundaries, dependency direction, data flow, invariants,
decisions with rationale, change-impact knowledge, historical attempts, external constraints,
domain glossary, gotchas that cost real debugging time.

Bad: function bodies, obvious implementation, transient task state, code excerpts, restated docs.

### What Jev scores

Every claim is judged against the evidence you attach, and returns calibrated scores:

| Score | Question |
|---|---|
| `grounded` | Does the evidence state or directly imply the claim? |
| `derivable` | Could a developer re-derive this from the repository in under a minute? |
| `durable` | Will it still be true and useful in a month? |
| `importance` | How load-bearing is it? (ephemeral → contextual → durable → canonical) |
| `criticality` | How costly is acting on it incorrectly? |
| `already_known` | Does the wiki already hold it? |
| `trustTier` | Basis of the claim: `source_document`, `verified_in_repo`, `user_stated`, `inference`, `speculation` |

### The decision gates, in order

| # | Condition | Outcome |
|---|---|---|
| 1 | `sensitive` ≥ 0.9 | **rejected** — secrets and PII are never filed |
| 2 | `derivable` ≥ 0.5 | **rejected** as implementation detail, *except* high-importance framing (below) |
| 3 | `already_known` ≥ 0.9 | **rejected** as duplicate — reinforce or extend the existing claim |
| 4 | `grounded` ≥ 0.8 and `importance` ≥ 1 | **filed**, or **reinforced** when it extends or agrees with existing claims |
| 5 | `grounded` ≥ 0.7 | **queued for review** (below auto-accept) |
| 6 | `grounded` < 0.7 | filed only with trust tier `user_stated` (stored with lower status) or `verified_in_repo`; `inference` and `speculation` never file |
| 7 | otherwise | **rejected** as unsupported |

**Framing gate (the exception to #2):** architecture, invariant, and decision claims with
`importance` ≥ 0.6 are **queued for confirmation** when Jev rates them derivable, instead of being
dropped. The reason: a future agent needs the frame even when the code technically contains the
pieces. Lower-importance derivable claims still fail the delete test.

### Evidence that passes

Attach evidence that *states* what you claim — Jev reads it.

| Kind | Use it for | Notes |
|---|---|---|
| `commit` | decisions and rationale | The strongest artifact for *why*. Use the hash of the commit that introduced the change; its message is read. |
| `source` | external knowledge, docs | Include a verbatim quote. Paraphrases fail grounding. |
| `user` | policies the user stated | Filed with `status: user-stated` (lower trust), not verified. |
| `file` | code-visible structure | The extension reads and excerpts the file for Jev. A bare path does not ground *intent* or *rationale* — pair it with a commit or a quote for "why" claims. |
| `command` / `test` | reproducible behavior | Include the command and the observed output. |

### Phrasing rules

- **Atomic**: one claim, one idea. Split mechanism, rationale, and consequence into separate claims.
- **Scope to the evidence**: if the quote supports X, do not claim X and Y.
- **Separate *what* from *why***: "the client retries on 429" is derivable → rejected; "retries
  live in the client because provider gateways implement Retry-After inconsistently" is rationale → durable.
- **Prefer framing over detail**: decisions, invariants, boundaries, and gotchas over implementation facts.
- **Name the kind**: `decision`, `invariant`, `architecture`, `gotcha`, `pattern`, `procedure`,
  `fact`, `preference` — it decides which gate applies.

### Pre-submission checklist

1. Can another agent re-derive it in a minute from the repo? → don't submit, or submit it as
   high-importance framing.
2. Can I point to a quote, commit, or user sentence that states it? → if not, it will be rejected
   as unsupported.
3. Is it transient task state? → don't submit.
4. Does the wiki already say it? → reinforce or extend the existing page instead.
5. Is it code-visible but load-bearing framing? → submit as architecture/invariant/decision; it
   will be queued rather than dropped.

### Thresholds and calibration

Defaults: `autoAccept` 0.8, `minSupport` 0.7, `minDerivable` 0.5, `framingImportance` 0.6,
`minImportance` 1. They are configurable in `.pi/jev-wiki.json` (project) or
`~/.pi/agent/jev-wiki.json` (global). If rejections look wrong for this project, run
`wiki_triage`: it reports the accepted vs rejected score ranges and flags overlapping thresholds.

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

### When a claim is rejected

Rejections are diagnosable — run `wiki_triage` to see the scores, the reason, and the fix for each:

- **derivable from code**: add what the code cannot show — a commit message (evidence `kind: commit`),
  a source quote, or the rationale behind the decision. High-importance architecture, invariant, and
  decision framing is queued for confirmation instead of dropped.
- **unsupported**: attach evidence that *states* the claim: a verbatim quote, the commit that
  introduced it, or the user's own words (`kind: user`). A file reference without a supporting
  passage is not enough.
- **duplicate**: find the page that covers it and reinforce or extend it instead of filing a new claim.
- **sensitive**: never file it; redact secrets and PII first.

If a rejected claim still matters after applying the remedy, re-submit it with the better evidence
rather than writing it by hand. If it does not survive re-submission, tell the user why — a
correctly rejected claim is a working system, not a failure.

### Ingest a document (research channel)

1. `wiki_ingest` with `path` (or `text`) — it stores the raw source, extracts claims, and returns
   a Jev-verified brief.
2. Write or merge the **accepted** pages (guided mode: you write).
3. `wiki_finalize` with every touched page.

### Capture session insights (work channel)

1. Compose atomic insights against the [criteria](#how-claims-are-judged). For decisions, attach
   the introducing commit; for policy, the user's words; for documents, a verbatim quote.
2. `wiki_insights` with the list — Jev filters, relates them to existing knowledge, and chooses
   placement. File evidence is read and excerpted for Jev, which grounds the decision.
3. Write or merge the **accepted** pages, then `wiki_finalize`. If a claim is queued under the
   framing gate, it is worth filing: confirm it via `wiki_review` and write the page.

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
