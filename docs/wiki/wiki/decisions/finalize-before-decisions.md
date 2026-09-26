---
title: Finalize the wiki before presenting decisions
type: decision
topic: decisions
summary: "Wiki writes and wiki_finalize complete before the task-ending response; when a response needs decisions, they come last in a labeled section, with no wiki-maintenance narration after them."
tags: [workflow, wiki, decisions, agents, procedure, decision]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-005931.md]
claims:
  - id: c1
    text: "Wiki writes must be finalized before composing the task-ending response; if a response requires decisions, present them in a labeled section at the very end, after wiki_finalize, with no wiki-maintenance narration following the decisions."
    status: user-stated
    support: 0.96
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-005931.md, "The response that you make for me at the end of your task where you ask for my decisions need to always be after the wiki finalize step. Right now, (not this time at least) the wiki finalize step runs and then my terminal is flooded with your decision making about maintaining the wiki. Add this to the wiki skill."]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [skills/llm-wiki/SKILL.md]
---

# Finalize the wiki before presenting decisions

**Status.** accepted

**Date.** 2026-09-26

## Context

- End-of-task responses were being followed by wiki bookkeeping: `wiki_finalize` output, capture
  briefs from the settle hooks, and the deliberation about what to file or decline. Andrei saw
  "the wiki finalize step runs and then my terminal is flooded with your decision making about
  maintaining the wiki" — maintenance chatter arriving after the question he was being asked.
- The decisions section of a response is the one part he must act on; anything after it competes
  with it and buries the call.

## Decision

- Complete every wiki write (page edits, review dispositions, captures) and call `wiki_finalize`
  **before** composing the response that ends the task.
- If that response asks for a decision, put the decisions in a clearly labeled section at the very
  end: no wiki bookkeeping after it, and no wiki-maintenance narration behind it.

## Consequences

- The user sees a settled wiki, then the question — not maintenance output after the question.
- The rule is enforced where agents read it: the `llm-wiki` skill ("Finalize before the final
  response") and the user-level AGENTS.md decisions rule.
- The capture hooks still fire after a turn settles by design; choosing `capture.cadence: commit`
  is the separate lever for reducing post-turn capture briefs.

## Related

- [Capture flow](../architecture/flow-capture.md)
- [Cross-wiki write routing](cross-wiki-writes.md)
