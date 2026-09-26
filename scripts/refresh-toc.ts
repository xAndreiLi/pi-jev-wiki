/**
 * Refresh every registered wiki's TOC and derived manifest from its existing
 * entries. Safe migration for wikis created before manifests existed: it reads
 * the current TOC and rewrites index.md/toc/ + .jev-wiki/toc.json, changing no
 * knowledge content.
 *
 * Usage: npm run toc:refresh [-- <cwd>]
 */
import { loadConfig } from "../src/config.ts";
import { resolveLayout } from "../src/wiki/layout.ts";
import { updateIndex } from "../src/wiki/toc.ts";
import { readRegistry } from "../src/vector/registry.ts";

const cwd = process.argv[2] ?? process.cwd();
const loaded = loadConfig(cwd);
const registry = await readRegistry(loaded.agentDir);
if (registry.wikis.length === 0) {
	console.log("No wikis registered.");
	process.exit(0);
}

let failures = 0;
for (const wiki of registry.wikis) {
	try {
		const layout = resolveLayout(wiki.root, ".", loaded.config.stateRoot);
		const entries = await updateIndex(layout, (current) => current);
		console.log(`ok   ${wiki.name}: ${entries.length} entries — ${wiki.root}`);
	} catch (error) {
		failures += 1;
		console.error(`fail ${wiki.name}: ${(error as Error).message}`);
	}
}
console.log(`\nRefreshed ${registry.wikis.length - failures}/${registry.wikis.length} wiki(s).`);
process.exit(failures > 0 ? 1 : 0);
