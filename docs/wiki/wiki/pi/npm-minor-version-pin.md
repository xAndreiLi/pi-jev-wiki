---
title: npm-installed extensions do not cross minor versions on update
type: gotcha
topic: pi
summary: "pi's npm store pins a ^<minor> dependency range; for 0.x packages that excludes the next minor, so an @latest update can report success while the installed copy stays old — install the explicit version instead."
tags: [pi, npm, install, update, gotcha]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-0041.md]
claims:
  - id: c1
    text: "An npm-installed extension does not cross minor versions through `pi update --extension <source>@latest` alone: pi's npm store records a `^<minor>` dependency range and for 0.x releases that excludes the next minor (`^0.7.1` does not match `0.8.0`), so the update reports success while the installed copy stays old; installing the explicit version rewrites the spec to `^0.8.0`."
    status: verified
    support: 0.97
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-0041.md, docs/RELEASING.md, "Observed 2026-09-26: @latest reported success while the store copy stayed 0.7.1; @0.8.0 installed 0.8.0 and rewrote the spec."]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
    corroborations: 3
    last_confirmed: 2026-09-26
files: [docs/RELEASING.md]
---




# npm-installed extensions do not cross minor versions on update

**Symptom.** After publishing 0.8.0, `pi update --extension npm:pi-jev-wiki@latest` printed
"Updated npm:pi-jev-wiki@latest", but the pi npm store's copy still read `0.7.1` — a new session
would have loaded the old extension. The `pi list` source spec said `@latest`, so nothing looked
wrong.

**Cause.** pi's npm store keeps a dependency spec of the form `^<version>`. For 0.x packages a caret
range pins the minor: `^0.7.1` means `>=0.7.1 <0.8.0`, so resolving that spec (which an `@latest`
update did) legitimately chooses 0.7.x and never 0.8.0.

**Avoidance.** Update to an explicit version: `pi update --extension npm:pi-jev-wiki@0.8.0`. That
rewrites the stored spec to `^0.8.0`, after which patch updates resolve normally. Confirm the store
copy rather than trusting the command output:
`node -p "require('~/.pi/agent/npm/node_modules/pi-jev-wiki/package.json').version"`, or inspect
`dependencies` in `~/.pi/agent/npm/package.json`.

**Detection.** Compare the three places that can disagree after an `@latest` update: the `pi list`
source spec, the store's dependency range, and the installed package's own version.

**Related.** [One install source only](one-install-source.md) ·
[Gallery page is live before browsable catalog](gallery-index-lag.md)

## Evidence

- `raw/sessions/2026-09-26-session-2026-09-26-0041.md` — capture of this claim (grounded 0.97).
- `docs/RELEASING.md` — release runbook now documents the explicit-version update step.
- Observed 2026-09-26: `@latest` reported success while the store copy stayed `0.7.1`; `@0.8.0`
  installed 0.8.0 and rewrote the spec.
