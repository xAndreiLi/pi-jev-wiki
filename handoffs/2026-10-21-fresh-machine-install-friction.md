# Handoff — fresh-machine install friction, 2026-10-21

**Date:** 2026-10-21 · **Repo:** `pi-jev-wiki` 1.0.4 (installed copy at `/Users/andreili/.pi/agent/npm`)
**Machine:** macOS 26.5.1 arm64 · node 26.9.0 · npm 12.2.0
**Context:** Andrei — *"Set up the wiki on this machine for this project"*, then *"Build the semantic index
with performance preset"* · **Status:** notes only; nothing here is started

## What this setup did

- New machine, empty `~/.pi/agent/jev-wiki`. TypeSafe key written to the project `.env` via
  `wiki_setup action=write-env`; Jev reachable in 260 ms on `jev-1.13.0`.
- `wiki_sync` initialized a baseline (`dd75f12`), three curated pages were hand-written after
  `wiki_ingest mode=auto` had fragmented one document into six, and the index was built with the
  `performance` preset: 31 chunks, model cached at ~331 MB, embedder pid serving.
- Getting the embedder to start at all took four separate failures (P1–P4 below). The final state is
  healthy — `wiki_doctor` 16 ok / 0 warn / 0 fail, 31 chunks — but the path there was mostly spent
  decoding messages that named the wrong problem.

## P1 — A blanket `catch` reports every import failure as "missing dependency"

**Observed.** `src/vector/embed.ts:128-138` (`loadTransformers`) wraps the dynamic import:

```ts
} catch (error) {
	throw new Error(
		"Semantic search needs the optional dependency @huggingface/transformers. Install it or set search.vector.enabled false.",
		{ cause: error },
	);
}
```

The package *was* installed. The real error, obtained by running the import by hand, was a corrupt
transitive native module:

```
Error: Could not load the "sharp" module using the darwin-arm64 runtime
… dlopen(…/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node)
Library not loaded: @rpath/libvips-cpp.8.18.7.dylib
(segment '__TEXT' load command content extends beyond end of file)
```

`sharp` is not a direct dependency — it arrives under `@huggingface/transformers` — so the name in the
message sent the diagnosis to the wrong package. The `cause` is attached but never printed, and the
text is also what lands in `embedder.log`, so the log inherits the wrong diagnosis.

**Fix direction.** Two lines, no new machinery:

1. Include the cause text: `… (${(error as Error).message})` — enough on its own to distinguish
   `Cannot find package` from `Could not load the "sharp" module`.
2. Classify the native-load case (`/Could not load the ".*" module|ERR_DLOPEN_FAILED|Library not loaded|dlopen\(/`)
   and, instead of "install it", print the repair:

   ```
   A native dependency failed to load: <cause>
   Repair: rm -rf <agentDir>/node_modules/@img <agentDir>/node_modules/sharp
           && npm install --prefix <agentDir> --include=optional sharp
   ```

Keep `{ cause }`; `util.inspect` on the cause is the debugging path of last resort.

**Priority** high (it is the first message every broken install sees) · **Size** small.

## P2 — The tool-level error discards the log tail

**Observed.** `wiki_index action=rebuild` and `search.vector.enabled` failures surface
`The shared embedder did not start — see …/embedder.log` (`src/vector/embedder/client.ts:286`,
`src/extension.ts:1909`). The log did contain a `failed to start:` line, but reaching it required a
`tail` outside the agent loop — one extra round trip on a failure the tool already knows the reason
for. `wiki_index status` prints pid and chunk counts and says nothing about a prior failed start.

**Fix direction.** Read the last `failed to start` line from `embedderLogPath(agentDir)` and append it
to the embedder-not-started error; show the same line as an `embedder: last failure …` row in
`wiki_index status` when the log's newest failure is post-start. One helper, two call sites.

**Priority** medium · **Size** small.

## P3 — An interrupted install leaves an undeclared, silently prunable dependency

**Observed.** The `@huggingface/transformers` install was killed at a 60 s harness timeout *after* the
files landed and *before* npm wrote `package.json`. The following `npm install sharp` rebuilt the
manifest and lock from the lockfile, dropping the entry. `@huggingface/transformers` stayed in
`node_modules` as an orphan: `import` worked, `wiki_index` worked, and the next `npm install` in
`/Users/andreili/.pi/agent/npm` would have deleted it — reintroducing P1's misleading message weeks
later with no code change to blame. It was caught only by diffing `package.json` against `node_modules`.

**Fix direction.** A `doctor` check after the `vector registry` row (`src/doctor.ts:169-186`), active
only when `search.vector.enabled`:

- manifest declares `@huggingface/transformers` in `package.json` of the agent dir **and**
  `node_modules/@huggingface/transformers/package.json` exists → `ok`;
- present but undeclared → `warn "undeclared in <agentDir>/package.json; the next npm install prunes
  it — npm install --prefix <agentDir> @huggingface/transformers"`;
- declared but absent → `warn "missing; npm install --prefix <agentDir>"`.

Package resolution for the check should start from the plugin's own path (`createRequire(import.meta.url)`),
not `process.cwd()`.

**Priority** high (silent, delayed, and blames nothing) · **Size** small.

## P4 — Install preconditions are undocumented, and npm 12 gates postinstalls

**Observed.** Two environment traps, neither of which the plugin mentions anywhere the user looks:

1. `npm install` into `/Users/andreili/.pi/agent/npm` dies with `EACCES` on `~/.npm/_cacache`
   (`Your cache folder contains root-owned files … run: sudo chown -R 501:20 "/Users/andreili/.npm"`).
   The workaround that avoids sudo is a private cache: `npm install --cache /tmp/pi-npm-cache <pkg>`.
   This recurs on every extension install until the cache ownership is fixed.
2. npm 12 refuses install scripts: `npm warn install-scripts onnxruntime-node@1.30.0 (postinstall …)
   Run npm install-scripts approve <pkg> to allow`, likewise `protobufjs`. Embeddings worked without
   approving them because the `.node` binary ships in the tarball (`node_modules/onnxruntime-node/bin/
   napi-v6/darwin/arm64/onnxruntime_binding.node`), but that is luck, not a verified configuration.

**Fix direction.** A short "If semantic search will not start" block in `README.md` and in the
`wiki_setup action=guide` text (both `typesafe` and `openrouter` paths), covering: private-cache
install, the sharp repair from P1, `npm install-scripts approve onnxruntime-node protobufjs` when the
warning appears, and the check `node -e "import('sharp').then(()=>console.log('ok'))"`. No new tool
action — `wiki_doctor` reports the state and the guide prints the commands.

**Priority** low (documentation, but it is the difference between a 5-minute fix and an hour)
· **Size** small.

## P5 — `rebuild` refuses before the model is chosen, without saying so

**Observed.** `wiki_index action=rebuild` → `Embedding model not chosen yet`. The next step is
`wiki_index action=model performance|quality`, which is only discoverable from the tool descriptions,
and the choice re-embeds every registered wiki, so it is not a decision to make by guessing.

**Fix direction.** Append the affordance to the error: `… run wiki_index action=model
performance|quality first (re-embeds every registered wiki)`. One string.

**Priority** low · **Size** trivial.

## Verification plan

1. `npm run test:install` (`scripts/install-test.ts`) already installs the packed tarball into a
   throwaway project. Add a case that installs with `--omit=optional` and asserts (a) `wiki_doctor`
   reports `vector deps: missing` with the install command, (b) a `wiki_index action=rebuild` error
   contains `Cannot find package` — i.e. the cause is named, not replaced.
2. Native-load path, locally: rename one dylib
   (`mv ~/.pi/agent/npm/node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib{,.bak}`),
   run `wiki_index action=rebuild`, confirm the message names `sharp` and prints the repair, then
   restore. The model is already cached, so this is seconds, not a 300 MB download.
3. Orphan path, no install needed: run the P3 helper against a temp directory holding a
   `package.json` without the entry and a `node_modules/@huggingface/transformers/package.json`, and
   assert the `warn` text; a second fixture with the entry declared and the directory absent asserts
   the other branch.

Do P1 first (it makes the other three self-describing while being worked on), then P2, then P3;
P4/P5 are independent and can land any time.

## Adjacent, not addressed here

- `wiki_ingest mode=auto` on a prose document fragments it by claim kind (six pages, 505 lines, each
  carrying a copy of the source). Curated ingest is the right tool; the auto mode's placement rules
  are a separate question.
- Jev rejected 9 of 14 claims citing verbatim source text as *not grounded* or *derivable* during this
  setup, all filed with recorded overrides. The calibration question belongs with the grounding work,
  not here.

## Cross-references

- The project-side record of the same two traps:
  `/Users/andreili/Development/cultivation-game/docs/wiki/wiki/tooling/semantic-search-setup.md`.
- Embedder lifecycle and the log path: `docs/wiki/wiki/architecture/flow-retrieval.md`.
- Earlier install-layout findings: `handoffs/2026-10-01-search-fallback-and-evidence-diagnostics.md`.
