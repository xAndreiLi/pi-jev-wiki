/**
 * Re-embed every registered wiki into the index store.
 *
 * Used for migrations (the PGlite → SQLite swap on 2026-10-08) and as the recovery path after a
 * store reset: the store is a derived cache, so this only needs the pages and the shared embedder.
 *
 * Run: npm run rebuild [wiki...]
 */
import { loadConfig } from "../src/config.ts";
import { indexWiki } from "../src/vector/index.ts";
import { readRegistry, resolveWikiRoot, setWikiRoot } from "../src/vector/registry.ts";

const loaded = loadConfig(process.cwd());
const agentDir = loaded.agentDir;
const vector = loaded.config.search.vector;
if (!vector.enabled) {
	console.error("search.vector.enabled is false — nothing to rebuild.");
	process.exit(2);
}

const only = new Set(process.argv.slice(2));
const targets = (await readRegistry(agentDir)).wikis.filter((entry) => entry.enabled && (only.size === 0 || only.has(entry.name)));
console.log(`agent dir: ${agentDir}`);
console.log(`preset: ${vector.model}${vector.dtype ? ` (${vector.dtype})` : ""} — rebuilding ${targets.length} wiki(s)`);

let chunks = 0;
let failures = 0;
for (const entry of targets) {
	const started = Date.now();
	try {
		const root = await resolveWikiRoot(entry.root).catch(() => entry.root);
		if (root !== entry.root) await setWikiRoot(agentDir, entry.name, root);
		const report = await indexWiki({
			agentDir,
			wiki: entry.name,
			root,
			model: vector.model,
			...(vector.dtype ? { dtype: vector.dtype } : {}),
			...(vector.dimensions ? { dimensions: vector.dimensions } : {}),
			onProgress: (message) => process.stdout.write(`     ${entry.name}: ${message}\r`),
		});
		chunks += report.total;
		process.stdout.write("\r\x1b[2K");
		console.log(`ok   ${entry.name}: ${report.embedded} embedded, ${report.skipped} unchanged, ${report.removed} removed, ${report.total} chunks (${Date.now() - started} ms)`);
	} catch (error) {
		failures += 1;
		console.error(`FAIL ${entry.name}: ${(error as Error).message}`);
	}
}
console.log(`done: ${chunks} chunks in ${targets.length - failures}/${targets.length} wiki(s)`);
process.exit(failures > 0 ? 1 : 0);
