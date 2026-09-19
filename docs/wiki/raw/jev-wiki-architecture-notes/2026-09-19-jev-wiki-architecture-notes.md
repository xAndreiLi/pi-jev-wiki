---
title: jev-wiki architecture notes
type: raw-source
source: null
collected: 2026-09-19
sha256: c8c79d9b75e111512eaa4fce996da00f83a50eb9a0b2e4542c915b6e09fb22a6
---

# jev-wiki architecture notes

## Purpose

jev-wiki is a pi package that gives coding agents a maintained mental model of a project. It
stores architecture-level knowledge — module responsibilities, boundaries, invariants, decisions,
and change impact — in a markdown wiki. It deliberately excludes anything a developer could
re-derive from the repository in under a minute.

## Components

The pi extension registers a small set of tools: `wiki_toc`, `wiki_ask`, `wiki_ingest`,
`wiki_insights`, and `wiki_finalize`. The extension owns staging, Jev adjudication, placement, and
TOC/log bookkeeping. A separate Jev client speaks to TypeSafe's System One API; Jev returns typed
decisions (`noul`, `choice`, `score`), never text.

## Invariants

- Raw sources under `raw/` are immutable; the wiki only ever reads them.
- `wiki/index.md` and `wiki/log.md` are generated files and are never hand-edited.
- Every load-bearing claim must point at verbatim evidence in a raw source or a file/commit/test.
- The wiki is never injected into agent sessions; the agent consults the table of contents on
  demand, like a skill.

## Decisions

- TypeSafe direct is the default provider because it offers a 64k context window; OpenRouter
  remains a config-level alternative.
- Guided writing is the default mode: Jev decides, the agent writes, and code enforces policy.
- Review work is agent-managed. The user is only escalated for critical items such as security,
  breaking API changes, or data loss.

## Flows

Ingest: a source is staged into `raw/`, claims are extracted with the session model, Jev verifies
groundedness and derivability, chooses placement, and returns a brief. The agent then writes or
merges pages and calls `wiki_finalize`.

Capture: at the end of work the agent composes an insight list with evidence pointers. Jev filters
and places each insight, and the agent writes the resulting updates.
