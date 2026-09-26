---
title: Extension loads at session start
type: invariant
topic: invariants
summary: "The extension is loaded when a session starts, so a plugin upgrade or a capture feature the running version lacks needs /reload or a new session; config files are re-read per event, so cadence edits apply on the next settle."
tags: [extension, lifecycle, reload, configuration, capture]
updated: 2026-09-26
sources: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md]
claims:
  - id: c1
    text: "The extension is loaded at session start: a plugin upgrade, a new capture feature, or a tool-schema change applies only to sessions started afterwards — the running session keeps its loaded version and needs /reload or a new session."
    status: verified
    support: 0.9
    evidence: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
  - id: c2
    text: "Config files are re-read per event (loadConfig caches nothing), so editing capture.cadence or another config value takes effect on the next settled task without a reload; only plugin code is fixed for the session."
    status: verified
    support: 0.85
    evidence: [raw/session-capture-2026-09-26/2026-09-26-session-capture-2026-09-26-home-session-moved-from-the-life.md, src/config.ts, src/extension.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/config.ts, src/extension.ts]
---

# Extension loads at session start

**Invariant.** pi loads the extension module when a session starts. Anything baked into that loaded
module — the plugin version, the registered tool schemas, whether a capture feature exists at all —
is fixed for the session's lifetime. A session whose loaded version predates a feature cannot use
that feature retroactively: upgrading the plugin takes effect in the next session, or after
`/reload` in the running one.

**Not frozen: config values.** `loadConfig` reads the global and project configuration files on
every call and caches nothing; the `agent_settled` handler calls it fresh before
`resolveCaptureTriggers`. Editing `capture.cadence` (or another config key) therefore takes effect
on the next settled task — no reload needed. Only plugin *code* requires a reload.

**Practical consequences.**

- After `pi install` of a new version, start a new session (or `/reload`) before relying on its
  features; a running session keeps the old behaviour.
- After editing `.pi/jev-wiki.json` or the user config, the next event already sees the new values.
- For development, load the working copy with `pi -e ./src/extension.ts --skill ./skills/llm-wiki`
  rather than installing a second copy — see [One install source only](../pi/one-install-source.md).

## Related

- [Capture flow](../architecture/flow-capture.md)
- [One install source only](../pi/one-install-source.md)
