---
title: before_agent_start can inject a message into the prompt batch
type: architecture/flow
topic: pi
summary: "A pi extension can return a custom message from the before_agent_start hook; pi appends it to the same batch as the user prompt, before the first provider request, so it is both rendered in the transcript and present in LLM context. display controls TUI rendering only, and a trailing message preserves the cached prompt prefix that a system-prompt change would drop."
tags: [pi, extension, hooks, injection, cache, workflow]
updated: 2026-10-04
sources: [raw/sessions/2026-10-04-session-2026-10-04-181406.md]
claims:
  - id: c1
    text: "An extension's `before_agent_start` handler may return a `custom_message`, and pi appends it to the same batch as the user prompt — after it, before the first provider request — so the message is both rendered in the transcript and present in LLM context. `display` controls TUI rendering only, so display-without-context requires `appendEntry` plus `registerEntryRenderer` instead."
    status: verified
    support: 0.85
    evidence: [docs/plans/AUTO-RETRIEVAL.md, raw/sessions/2026-10-04-session-2026-10-04-181406.md]
    reviewed: 2026-10-04
    last_checked: 2026-10-04
  - id: c2
    text: "Prefer a trailing injected message over a system-prompt section when adding per-prompt context: appending after the user prompt invalidates nothing the new turn would not invalidate anyway, while editing `systemPromptOptions` rewrites the leading prompt and drops the provider's cached prefix."
    status: verified
    support: 0.8
    evidence: [docs/plans/AUTO-RETRIEVAL.md, docs/plans/EFFICACY.md]
    reviewed: 2026-10-04
    last_checked: 2026-10-04
files: [src/auto-retrieve.ts, src/extension.ts]
---


# before_agent_start can inject a message into the prompt batch

**Status.** verified

**Date.** 2026-10-04

## Mechanism

`pi.on("before_agent_start", …)` sees the expanded prompt and its `systemPromptOptions`. A handler
may return `{ message: { customType, content, display, details } }`. Pi collects those messages and
appends them to the same batch as the user prompt, before the first provider request
(`@earendil-works/pi-coding-agent@0.85.1`: `dist/core/extensions/runner.js:1123-1145` collects them,
`dist/core/agent-session.js:1584-1592` builds the batch as user message, then `nextTurn` messages,
then handler messages).

A `custom_message` entry participates in LLM context and becomes a `user` message;
`display` controls TUI rendering only (`dist/core/session-manager.d.ts:100-115`). The primitives
therefore split cleanly:

| Want | Use |
|---|---|
| Visible + in context | `before_agent_start` returned message, or `pi.sendMessage` with `display: true` |
| In context, hidden from the user | `pi.sendMessage` with `display: false` |
| Visible, **not** in context | `pi.appendEntry` + `pi.registerEntryRenderer` |

Extension messages do not start a turn — only user-authored messages do — so an injected message
cannot recurse into another agent run (`dist/core/agent-session.js:449`).

## Why a trailing message and not a system-prompt section

Per-prompt context appended after the user prompt adds nothing that the new turn would not invalidate
anyway. Editing `systemPromptOptions` (or returning `systemPrompt`) rewrites the leading prompt and
drops the provider's cached prefix for the whole conversation — expensive in a project whose sessions
are 98.6% cache reads (`docs/plans/EFFICACY.md`).

## How to verify

Read the two dist locations above, or check the transcript: an injected brief appears as a distinct
styled block after the user's message, before the assistant's first token.

## Related

- [Auto-retrieval injects a Jev-gated wiki brief on every prompt](../decisions/auto-retrieval-injection.md)
- [pi extension module](../architecture/module-pi-extension.md)
