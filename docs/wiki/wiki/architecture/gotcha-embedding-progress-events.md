---
title: Embedding model emits progress for cached loads
type: gotcha
topic: architecture
summary: "A cached local embedding-model load still emits ~180 progress events in about a second, so a sink that forwards every event floods the terminal; model progress now goes to a throttled footer status line instead."
tags: [embeddings, progress, retrieval, ui, gotcha]
updated: 2026-09-26
sources: [raw/sessions/2026-09-26-session-2026-09-26-2317.md]
claims:
  - id: c1
    text: "The local embedding model emits progress callbacks while loading from cache, not only while downloading: the quality preset produced 182 events in 1.3 s, so an unthrottled progress sink floods the terminal on every reindex."
    status: verified
    support: 0.75
    evidence: [raw/sessions/2026-09-26-session-2026-09-26-2317.md, src/vector/embed.ts]
    reviewed: 2026-09-26
    last_checked: 2026-09-26
files: [src/vector/embed.ts, src/vector/index.ts, src/extension.ts]
---

# Embedding model emits progress for cached loads

**Symptom.** `wiki_finalize` (or `wiki_index rebuild`) prints a wall of lines like:

```
[jev-wiki] embedding model: tokenizer.json 91%
[jev-wiki] embedding model: tokenizer.json 92%
```

**Cause.** `createLocalProvider` forwards the transformers.js `progress_callback` for every file
event. That callback fires while the model is *loaded from the local cache*, not only on the first
download: the `quality` preset (Qwen3-Embedding-0.6B) emitted **182 events in 1.3 s** with the model
already cached. A sink that prints each event therefore emits ~180 console lines per reindex.

**Current handling.** `indexWiki` takes an optional `onProgress` sink instead of logging directly.
The extension wires it to `modelProgressSink`, which:

- with a UI, writes one footer status entry (`ctx.ui.setStatus("jev-wiki", …)`) throttled to one
  update per 250 ms, and clears it in a `finally` after indexing;
- without a UI (print/JSON modes), prints exactly one stable `[jev-wiki] embedding model: loading...`
  line and stays silent afterwards.

**Detection.** Point an `onProgress` sink at a counter and load a cached preset; more than a handful
of events means the sink needs throttling or deduplication. Event volume scales with the number of
model files, so per-file "ready" messages are as noisy as percentage updates.

**Related.**
- [Retrieval pipeline](flow-retrieval.md) — where embedding fits.
- [Capture flow](flow-capture.md) — `wiki_finalize` is the path that triggers reindexing.
