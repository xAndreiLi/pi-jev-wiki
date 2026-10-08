/**
 * Install gate: pack the package, install the tarball into a throwaway project, and drive *that*
 * copy — the layout a user gets, which is not the checkout the test suite runs from.
 *
 * It exists because 1.0.0 shipped a daemon that only worked from the working tree: Node refuses to
 * strip TypeScript under node_modules, so `node .../src/vector/embedder/server.ts` died on an
 * installed copy and semantic search was unavailable to everyone who installed it.
 *
 * Run: npm run test:install   (before a release; needs the model cache, no network beyond npm)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = process.cwd();
const work = mkdtempSync(join(tmpdir(), "jev-install-"));
const project = join(work, "project");
const agent = join(work, "agent");
const wiki = join(project, "docs", "wiki");

const run = (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string =>
	execFileSync(command, args, { cwd: options.cwd ?? project, encoding: "utf8", env: { ...process.env, ...options.env } });

/** npm is npm.cmd on Windows, which Node only spawns through a shell. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const runNpm = (args: string[], cwd?: string): string =>
	execFileSync(NPM, args, { cwd: cwd ?? project, encoding: "utf8", ...(process.platform === "win32" ? { shell: true } : {}) });

try {
	mkdirSync(join(wiki, "wiki", "notes"), { recursive: true });
	mkdirSync(join(agent, "jev-wiki"), { recursive: true });
	writeFileSync(join(project, "package.json"), JSON.stringify({ name: "install-gate", private: true }));
	writeFileSync(
		join(wiki, "wiki", "notes", "alpha.md"),
		'---\ntitle: Alpha\nclaims:\n  - id: c1\n    text: "The shared embedder owns the model so every session compares comparable vectors."\n    status: verified\n---\n\n# Alpha\n\nThe shared embedder owns the model so every session compares comparable vectors.\n',
	);
	writeFileSync(join(agent, "jev-wiki", "wikis.json"), JSON.stringify({ wikis: [{ name: "tiny", root: wiki, enabled: true }] }));

	// The model cache the installed copy should reuse, or its daemon would download one. On this
	// machine that is the real cache; CI points JEV_WIKI_MODELS_DIR at a directory it caches between
	// runs, and the first run there downloads once.
	const cache = process.env.JEV_WIKI_MODELS_DIR ?? join(homedir(), ".pi", "agent", "jev-wiki", "models");
	mkdirSync(cache, { recursive: true });
	const models = join(agent, "jev-wiki", "models");
	symlinkSync(cache, models, process.platform === "win32" ? "junction" : "dir");

	const packed = runNpm(["pack", "--pack-destination", work], root).trim().split("\n").pop() ?? "";
	const tarball = join(work, packed);
	if (!existsSync(tarball)) throw new Error(`npm pack produced no tarball (${packed})`);
	console.log(`  packed ${packed}`);
	runNpm(["install", "--no-audit", "--no-fund", tarball]);
	const installed = join(project, "node_modules", "pi-jev-wiki");
	console.log(`  installed to ${installed}`);

	writeFileSync(
		join(project, "drive.ts"),
		[
			'import { join } from "node:path";',
			'import { loadConfig } from "./node_modules/pi-jev-wiki/src/config.ts";',
			'import { indexWiki } from "./node_modules/pi-jev-wiki/src/vector/index.ts";',
			'import { vectorSearch } from "./node_modules/pi-jev-wiki/src/vector/query.ts";',
			"const loaded = loadConfig(process.cwd());",
			"const vector = loaded.config.search.vector;",
			'const report = await indexWiki({ agentDir: loaded.agentDir, wiki: "tiny", root: join(process.cwd(), "docs", "wiki"), model: vector.model });',
			'console.log("indexed", report.total, "chunks");',
			'const hits = await vectorSearch(loaded.agentDir, loaded.config, "who owns the embedding model", { limit: 2 });',
			'console.log("hits", hits.length, hits.map((hit) => hit.path).join(","));',
			// Stop the daemon this copy spawned, or Windows keeps its files locked and the temp dir
			// cannot be removed.
			'const { stopEmbedder } = await import("./node_modules/pi-jev-wiki/src/vector/embedder/client.ts");',
			'const { embedderOptionsFor } = await import("./node_modules/pi-jev-wiki/src/vector/query.ts");',
			"await stopEmbedder(embedderOptionsFor(loaded.agentDir, loaded.config));",
			"process.exit(hits.length > 0 ? 0 : 1);",
		].join("\n"),
	);

	const jiti = join(root, "node_modules", "jiti", "lib", "jiti-cli.mjs");
	const output = run(process.execPath, [jiti, join(project, "drive.ts")], {
		env: { PI_CODING_AGENT_DIR: agent },
	});
	const indexed = /indexed (\d+) chunks/.exec(output);
	const hits = /hits (\d+) /.exec(output);
	if (!indexed || Number(indexed[1]) === 0) throw new Error(`nothing was indexed from the installed copy:\n${output}`);
	if (!hits || Number(hits[1]) === 0) throw new Error(`no semantic hits from the installed copy:\n${output}`);
	console.log(`  installed copy indexed ${indexed[1]} chunk(s) and returned ${hits[1]} semantic hit(s)`);
	console.log("install gate passed");
} finally {
	// The daemon is asked to stop above, but Windows can hold a directory briefly after that.
	for (let attempt = 0; attempt < 10; attempt += 1) {
		try {
			rmSync(work, { recursive: true, force: true });
			break;
		} catch (error) {
			if (attempt === 9) console.warn(`  note: could not remove ${work} (${(error as NodeJS.ErrnoException).code ?? "error"}) — it is under the system temp dir`);
			else await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
}
