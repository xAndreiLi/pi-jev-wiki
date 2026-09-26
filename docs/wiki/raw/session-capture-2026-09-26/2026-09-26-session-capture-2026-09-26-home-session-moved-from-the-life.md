---
title: "Session capture 2026-09-26 (home session, moved from the life wiki)"
type: raw-source
source: life wiki raw/sessions/2026-09-26-session-2026-09-26-2301.md (moved to the package wiki 2026-09-26)
collected: 2026-09-26
sha256: 7ecf72779aaeb9128d170672063a274c2331927b4d1d7987d7d4b4d523f95d13
---

---
title: Session capture 2026-09-26 (settled)
type: raw-source
source: session
collected: 2026-09-26
sha256: 55674a748400388acf1a3512598f6bef8e0bb075b72e2e26316bdfbaac89f499
---

### pi-jev-wiki must be installed from exactly one source at a time (npm package OR local folder OR git); registering two copies causes every wiki_* tool to fail loading with 'Tool conflicts' errors.
Kind: gotcha
Evidence:
- user: I am getting this error now when trying to start pi after installing the latest update of the wiki
- commit: df0989d — "docs(readme): warn about duplicate extension installs"
Verdict: reject_unsupported (grounded 0.05, derivable 0.25, importance 0.24, criticality 0.46)

### During pi-jev-wiki development, load the local tree with `pi -e ./src/extension.ts --skill ./skills/llm-wiki` instead of adding a second install entry.
Kind: procedure
Evidence:
- command: pi -e ./src/extension.ts --skill ./skills/llm-wiki — "For future development, use the documented dev path instead of a second install:"
Verdict: file (grounded 0.94, derivable 0.47, importance 0.45, criticality 0.13)

### Wiki capture cadence is configurable via `capture.cadence` with values `manual` (default) | `task` (after each settled task, Jev pre-screened, 10-min debounce) | `commit` (only when a new git HEAD is observed, no debounce, detects commits made outside the agent).
Kind: feature
Evidence:
- file: docs/DESIGN.md — "## 8.1 Capture cadence"
- file: CHANGELOG.md — "Configurable capture cadence: `capture.cadence` = `manual` (default; explicit capture only) | `task` (after each settled task, debounced) | `co"
Verdict: reject_unsupported (grounded 0.03, derivable 0.31, importance 0.52, criticality 0.37)

### The legacy `capture.onSettle: true` alias still enables task-equivalent capture and works on plugin versions before `cadence` existed (e.g. 0.4.0 in WSL), so older installs can be configured forward-compatibly before upgrading.
Kind: pattern
Evidence:
- file: .pi/jev-wiki.json — "{ "capture": { "cadence": "task", "onSettle": true } }"
- user: WSL has no config at all, so those wikis are still on manual cadence.
Verdict: reject_unsupported (grounded 0.04, derivable 0.18, importance 0.24, criticality 0.33)

### A wiki session's extension is captured at session start, so changing `capture.cadence` (or upgrading the plugin) does not take effect for the running session — `/reload` or a new session is required.
Kind: gotcha
Evidence:
- command: This session isn't capturing because it predates the feature. If you run /reload (or just start the next session), it'll pick up 0.7.0
Verdict: file (grounded 0.84, derivable 0.48, importance 0.55, criticality 0.23)

### Capture target wiki is resolved from the session's working directory, not from where the agent was invoked conceptually — running pi from home files captures into the life wiki rather than a repo wiki.
Kind: invariant
Evidence:
- command: this session runs from your home, so captures land in the life wiki, not the repo wiki
Verdict: file (grounded 0.87, derivable 0.48, importance 0.60, criticality 0.52)

### Jev's pre-screen gates task-cadence captures: only tasks scoring at or above 0.6 are extracted; trivial smoke-test tasks (e.g. 'call wiki_status') are screened as skip by design and leave no wiki trace.
Kind: invariant
Evidence:
- test: 2 × capture.screen at 02:59:23 / 02:59:33 — Jev screened both at skip (worth 0.39, 0.47), correctly refusing to capture "call wiki_status" tasks
Verdict: file (grounded 0.47, derivable 0.41, importance 0.47, criticality 0.36)
