---
title: One install source only
type: gotcha
topic: pi
summary: "npm is the supported install for pi-jev-wiki; a repository clone is a development tree, not an install path. Whichever source you use, register exactly one — a second copy makes pi refuse to load the extension with tool-conflict errors."
tags: [install, pi-package, tool-conflict, pi, npm]
updated: 2026-10-09
sources: [raw/sessions/2026-09-26-session-2026-09-26-2307.md, raw/sessions/2026-10-09-session-2026-10-09-045526.md]
claims:
  - id: c1
    text: "pi-jev-wiki must be installed from exactly one source at a time — npm package, local folder, or git — because registering two copies makes pi refuse to load the extension with 'Tool \"wiki_*\" conflicts with …': every tool name is registered twice."
    status: verified
    support: 0.9299999999999999
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-2307.md, README.md, docs/wiki/wiki/pi/one-install-source.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-28
    corroborations: 4
    last_confirmed: 2026-09-26
  - id: c2
    text: "A packed-artifact smoke test must run with extension discovery disabled (`pi -ne -e <packed>/src/extension.ts`) because a registered npm install would otherwise register a second copy and hit the same tool-conflict failure."
    status: verified
    support: 0.9099999999999999
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-2307.md, pi -ne -e …, docs/wiki/wiki/pi/one-install-source.md]
    reviewed: 2026-09-26
    last_checked: 2026-09-28
    corroborations: 3
    last_confirmed: 2026-09-26
  - id: c3
    text: "The supported way to use pi-jev-wiki is the published npm package (`pi install npm:pi-jev-wiki`); a repository clone is a development tree and never an install path for consumers, so an agent handed the repository installs from npm instead of cloning it."
    status: verified
    support: 0.97
    evidence: [README.md, raw/sessions/2026-10-09-session-2026-10-09-045526.md]
    reviewed: 2026-10-09
    last_checked: 2026-10-09
files: [README.md]
---








# One install source only

**Symptom.** After adding a second copy of the extension (for example installing the npm release while a
local dev tree is still registered), pi refuses to load the extension and every `wiki_*` tool is
missing.

**Cause.** pi registers each tool name at load time. Two registered copies of `pi-jev-wiki` register
every tool twice, so loading fails with `Tool "wiki_*" conflicts with …`.

**Fix.** Keep one source: `pi list` shows the registered extensions, and `pi remove <source>` drops
the duplicate. Use the published package:

```bash
pi install npm:pi-jev-wiki
```

A repository clone is a development tree, not an install path: an agent handed the repository
installs from npm rather than cloning it. Pinning a branch or a commit is the one reason to reach
for another source (`pi install git:github.com/xAndreiLi/pi-jev-wiki@<ref>`), and it still counts as
the one source.

**Packed-artifact smoke tests.** Verifying a packed release while the npm install is registered
would register two copies and hit the same conflict. Run it with discovery disabled and the packed
extension loaded explicitly:

```bash
pi -ne -e /tmp/pi-jev-wiki/package/src/extension.ts --skill /tmp/pi-jev-wiki/package/skills/llm-wiki
```

**Development instead of a second install.** Load the working copy with the documented dev command
rather than adding a second install entry:

```bash
pi -e ./src/extension.ts --skill ./skills/llm-wiki
```

**Detection.** Tool conflicts appear at session start and name the duplicated tool; `pi list` is the
authoritative view of what is registered.

**Related.** Session workflow knowledge (dev-tree loading via `pi -e`, and that extensions load at
session start so config or plugin changes need `/reload` or a new session) currently lives in the
life wiki's `pi-jev-wiki-session-workflow` page rather than here; it is repo-relevant and slated to
move once cross-wiki write routing exists.
