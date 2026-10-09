---
title: The installed copy could not start the embedder
type: gotcha
topic: architecture
summary: "1.0.0 shipped a shared embedder whose daemon only started from a checkout: Node refuses to strip TypeScript under node_modules, so the shipped `server.ts` entry died with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING and every npm install had no semantic search while the whole suite stayed green. The daemon now launches through a plain-JavaScript shim, and CI runs `npm run test:install` — the packed tarball, installed and driven in a throwaway project — on every push and before publishing."
tags: [index, embeddings, packaging, node, gotcha]
updated: 2026-10-08
sources: [raw/sessions/2026-10-08-session-2026-10-08-080652.md]
needs_review: true
claims:
  - id: c1
    text: "A checkout-green suite proves nothing about an installed package: only the installed layout sits under node_modules, so `npm run test:all` passed on the commit that shipped a daemon that could never start — the release gate has to install the packed tarball and drive that copy."
    status: verified
    support: 0.55
    evidence: ["command: publish run 37772751156 — every step green (npm ci, test:all, publish) for the commit whose installed copy failed with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING", "command: npm run test:install against the fixed tree — 'installed copy indexed 2 chunk(s) and returned 2 semantic hit(s)'", "file: scripts/install-test.ts — packs, installs into a throwaway project, indexes a two-page wiki with that copy and requires a semantic hit"]
    reviewed: 2026-10-08
    last_checked: 2026-10-09
files: [src/vector/embedder/daemon.mjs, src/vector/embedder/client.ts, scripts/install-test.ts, docs/RELEASING.md]
---


# The installed copy could not start the embedder

**Status.** found 2026-10-08 by installing the published 1.0.0 into a scratch project; fixed in 1.0.1.

## Symptom

Nothing worked, quietly. On an installed copy the daemon never appeared, so indexing waited out its
retry window and failed with `The shared embedder did not start`, the log file stayed empty, and
queries fell back to lexical search — while the same code in a checkout ran perfectly.

Run by hand from inside a scratch install, the real error appears immediately:

```
$ node node_modules/pi-jev-wiki/src/vector/embedder/server.ts …
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported
for files under node_modules, for
"file:///.../node_modules/pi-jev-wiki/src/vector/embedder/server.ts"
```

## Cause

The daemon was spawned as `node <package>/src/vector/embedder/server.ts` and relied on Node's
TypeScript type stripping. Node allows that everywhere **except under `node_modules`** — a rule about
the file's location, not about the file's content, and not something a flag changes. A checkout lives
outside `node_modules`, an install never does.

## Fix

`src/vector/embedder/daemon.mjs` — plain JavaScript, so Node runs it anywhere — loads the TypeScript
daemon through jiti, the loader pi itself uses for the extension, and calls its exported
`startFromCli()`. `server.ts` keeps its own entry guard so `node --experimental-strip-types server.ts`
still works in a checkout, and `jiti` is now a runtime dependency rather than a dev one.

## Why the tests missed it

`npm run test:all` runs from the checkout, so it exercises the one layout where the bug is invisible.
CI was green, the artifact was verified (right files, right manifest, attested provenance), and the
feature was still dead for every installer.

The gate that closes the class: **`npm run test:install`** packs the package, installs the tarball
into a throwaway project, indexes a two-page wiki with *that* copy and requires a semantic hit. CI
runs it on every push and pull request, and again before publishing a tag, with the model directory
cached between runs — the check no longer depends on anyone remembering it. `test:all` stays
checkout-only; this gate lives beside it.

## Worth generalising

Anything a published package **spawns** or executes as a file — daemons, workers, CLI entry points —
has to be runnable from under `node_modules`. TypeScript is fine for code a loader executes (the
extension itself, imported by pi's jiti), but not for a file another `node` process is asked to start.
