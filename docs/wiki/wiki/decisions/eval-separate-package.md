---
title: The evaluator ships as a separate package
type: decision
topic: decisions
summary: "pi-wiki-eval is its own npm package rather than a tool inside pi-jev-wiki, because it has to measure sessions where pi-jev-wiki is absent — the wiki-off arm must run through the identical code path as the wiki-on arm, and a tool living inside the measured package cannot do that."
tags: [evaluation, packaging, measurement, decision]
updated: 2026-10-01
sources: [raw/sessions/2026-10-01-session-2026-10-01-020321.md]
claims:
  - id: c1
    text: "The efficacy evaluator ships as its own package (pi-wiki-eval) rather than as a tool inside pi-jev-wiki, because it must be able to measure a session with the extension absent — the wiki-off arm has to run through the identical code path, and a tool inside the measured package could not do that. It reads pi's session JSONL and the wiki's on-disk state, with no dependency on pi-jev-wiki internals."
    status: verified
    support: 0.62
    evidence: [raw/sessions/2026-10-01-session-2026-10-01-020321.md, docs/plans/EFFICACY.md, packages/pi-wiki-eval/README.md]
    reviewed: 2026-10-01
    last_checked: 2026-10-02
files: [packages/pi-wiki-eval, docs/plans/EFFICACY.md]
---


# The evaluator ships as a separate package

**Status.** accepted — directed by Andrei on 2026-10-01: *"Let's begin implementation on a
sub-package that we can deploy as a separate package to npm/pi. This should be a standalone
extension that users can use to benchmark the usage and efficacy of the wiki."*

**Date.** 2026-10-01

## Context

- The efficacy question — does the wiki make agents better? — needs both arms of a comparison:
  sessions with the wiki and sessions without it.
- A tool registered by pi-jev-wiki only exists when pi-jev-wiki is installed, so it can never
  observe the arm in which it is uninstalled. Anything it measured would be self-reported by the
  system under test.
- The wiki's value grows with use, so a user's own history is the natural first dataset — and that
  history contains sessions from before the package was installed, which a self-measuring tool
  cannot reach.

## Decision

- Ship the evaluator as `pi-wiki-eval`, a standalone package under `packages/`, with its own
  version, tests, release, and README.
- Keep it free of any import from pi-jev-wiki's source. Everything it needs — episode boundaries,
  provider usage, tool calls, retrieval pages, page-to-file links — is read from files both systems
  already write.
- Make it read-only and offline, and exclude prompt text by default, so that running it on a real
  project is not a privacy decision.

## Consequences

- Both arms are measured by one code path, so a difference between them cannot be an artifact of
  two instruments.
- The package must tolerate pi-jev-wiki's absence: no wiki means zero wiki metrics, which is the
  correct reading of a control run rather than an error.
- Two things to release and document instead of one, and the version-boundary gotcha applies
  separately: it must be installed at an explicit version, not `@latest`.
- The join keys (session JSONL shape, `metrics.jsonl`, frontmatter `files:`) become an implicit
  contract with pi-jev-wiki. Nothing enforces it, so a change on either side can silently degrade a
  metric — the reason the parsing rules are pinned by tests.

## Evidence

- `packages/pi-wiki-eval/README.md` — surfaces, inputs, and the read-only guarantee.
- `docs/plans/EFFICACY.md` §4.1 — the invariant that the analyzer must not require the extension to
  be loaded, and §9 for the delivered work items.
- `raw/sessions/2026-10-01-session-2026-10-01-020321.md` — the claim as filed.
