---
title: Wiki root defaults to docs/wiki
type: decision
topic: decisions
summary: The wiki root defaults to docs/wiki so knowledge lives next to the code it describes.
tags: [location, workspace, root]
updated: 2026-09-19
sources: [raw/sessions/2026-09-19-session-2026-09-19-1722.md]
claims:
  - id: c1
    text: The wiki root defaults to docs/wiki so knowledge lives next to the code it describes.
    status: user-stated
    support: 0.4
    evidence: [raw/sessions/2026-09-19-session-2026-09-19-1722.md]
    reviewed: 2026-09-19
files: []
---



# Wiki root defaults to docs/wiki

**Status.** accepted

**Date.** 2026-09-19

## Context

- The project workspace should contain both code and its associated knowledge.
- Keeping the wiki inside the project makes it version-controlled, discoverable, and portable.

## Decision

- Default the wiki root to `docs/wiki` within the project workspace.
- Knowledge lives next to the code it describes.

## Consequences

- The wiki is checked into the same repository as the code.
- Agents and developers can find documentation without leaving the project tree.
- Moving or renaming the project does not break wiki links.

## Evidence

- User directive: "we want the wiki in the project workspace"
