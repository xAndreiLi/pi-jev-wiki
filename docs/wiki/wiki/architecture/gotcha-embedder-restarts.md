---
title: "The shared embedder: one process, and the two ways to end up with three"
type: gotcha
topic: architecture
summary: "One local process owns the embedding model, started on demand over a pipe derived from the agent dir. Two traps cost real CPU when it was first run: Windows lets several processes bind the same pipe name (so a pipe name is not a single instance — the daemon takes a pid lock file), and the pipe hash must come from a canonicalised agent dir or the same directory spelled two ways yields two daemons and two model copies. A batch lost to a dying daemon now retries once instead of failing a whole wiki."
tags: [embeddings, index, pipes, single-instance, gotcha]
updated: 2026-10-09
sources: [raw/sessions/2026-10-08-session-2026-10-08-074620.md]
claims:
  - id: c1
    text: "A batch in flight when the embedder dies fails the whole index run for that wiki, because a wiki's chunks are embedded before any of them are written; the client now retries one batch after reconnecting, so a daemon that idle-exited or was replaced between batches is invisible to callers."
    status: disputed
    support: 0.67
    evidence: ["command: duplicate rebuild log 2026-10-08 — `FAIL pi-jev-wiki: The shared embedder connection closed.` after the daemon was killed mid-batch; the wiki had to be re-run", "file: src/vector/embedder/client.ts — embedBatch() drops the connection, ensures a daemon, and sends the same batch once more before reporting the error"]
    reviewed: 2026-10-08
    last_checked: 2026-10-09
files: [src/vector/embedder/server.ts, src/vector/embedder/client.ts]
---


# The shared embedder: one process, and the two ways to end up with three

**Status.** both traps observed while migrating the index on 2026-10-08; the retry is what the first
one cost.

## A pipe name is not a single instance

Windows allows several processes to listen on the same named pipe, and Node exposes no
first-instance flag, so two clients that start at the same moment each spawn a daemon: both load the
model (~700 MB apiece) and both serve the same pipe, while the client's handshake sees a perfectly
valid identity either way.

```
matching pipes: ["pi-jev-wiki-embed-ae92373b4220", "pi-jev-wiki-embed-cb63f65f63c3"]   # both connected
daemon 33196: 1982 CPU-s     orphan 10004: 466 CPU-s                                  # both embedding
```

The fix is a lock file next to the log (`<agent dir>/jev-wiki/embedder.log.lock`): the daemon reads
the pid inside, exits quietly if that pid is still alive, and otherwise claims the file with `wx`.
The client needs no knowledge of it — `waitForDaemon()` simply connects to the winner.

## Canonicalise the path before hashing it

The pipe is `sha1(canonical agent dir)`. Hashing the raw string means `C:/x`, `C:\x` and `C:\X`
produce different pipes for the same directory — one model copy each:

```
raw "C:/Users/liand/.pi/agent"  ─┐
raw "C:\Users\liand\.pi\agent"  ─┴→ canonical c:/users/liand/.pi/agent → cb63f65f63c3
```

`canonicalAgentDir()` resolves, normalises separators, and lowercases on Windows; the client cache
key uses it too, so one process reuses one client per identity.

## What the first migration proved

The 2026-10-08 rebuild embedded 2,075 chunks for nine registered wikis in 23 minutes into a 10.3 MB
`index.sqlite` (the PGlite directory it replaced was 67 MB), every wiki's stored fingerprint matched
the live embedder, and semantic queries answered in 88–160 ms — including the embedding call — with
the expected pages on top for both a failure-mode query and a workflow query.

## Known rough edge

Jobs queued for a client that has already disconnected are still computed and then discarded; there
is no per-connection cancellation yet. It costs latency, never correctness, and the idle exit drains
it.
