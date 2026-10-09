/**
 * Vector pipeline tests: prompt templates, chunking, RRF fusion, the wiki
 * registry, and an index integration pass over the SQLite store with a fake embedder.
 * Run: npm run test:vector
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { startEmbedderService } from "../src/vector/embedder/server.ts";
import { chunkPage, hashChunk, splitSections } from "../src/vector/chunks.ts";
import { MODEL_PRESETS, previewEmbedText, truncateAndNormalize, type EmbedInput, type EmbeddingProvider } from "../src/vector/embed.ts";
import { forgetWikiIndex, hasWarmIndex, indexWiki } from "../src/vector/index.ts";
import { enabledWikiNames, readRegistry, registerWiki, setWikiEnabled, unregisterWiki } from "../src/vector/registry.ts";
import { vectorDbFor } from "../src/vector/db.ts";
import { resetStore, storePath } from "../src/vector/sqlite.ts";
import { vectorDataDir } from "../src/vector/registry.ts";
import { discoverWikis } from "../src/vector/discover.ts";
import { buildCatalog } from "../src/vector/catalog.ts";
import { judgeRetrieval } from "../src/vector/judgments.ts";
import { countPages, readManifest } from "../src/wiki/manifest.ts";
import { entryFromPage, updateIndex, upsertEntries } from "../src/wiki/toc.ts";
import { resolveLayout } from "../src/wiki/layout.ts";
import type { JevClient } from "../src/jev.ts";
import { configuredModel, modelChoiceSource, writeModelSetting } from "../src/vector/settings.ts";
import type { LoadedConfig } from "../src/config.ts";
import { NamedSearchEngine, rrfFuse, type SearchResult } from "../src/wiki/search.ts";

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
	try {
		await fn();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failures++;
		console.error(`FAIL  ${name}\n      ${(error as Error).message}`);
	}
}

const performance = MODEL_PRESETS.performance;
const quality = MODEL_PRESETS.quality;

console.log("embedding presets");
await check("performance preset pins Gemma templates and dimensions", () => {
	assert.equal(performance.repo, "onnx-community/embeddinggemma-300m-ONNX");
	assert.equal(performance.dtype, "q8");
	assert.equal(performance.dimensions, 768);
	assert.equal(previewEmbedText(performance, { text: "who is Andrei" }, "query"), "task: search result | query: who is Andrei");
	assert.equal(
		previewEmbedText(performance, { title: "Profile", text: "Andrei is a builder." }, "document"),
		"title: Profile | text: Andrei is a builder.",
	);
	assert.equal(previewEmbedText(performance, { text: "no title" }, "document"), "title: none | text: no title");
});
await check("quality preset pins Qwen3 instruction template", () => {
	assert.equal(quality.repo, "onnx-community/Qwen3-Embedding-0.6B-ONNX");
	assert.equal(quality.dimensions, 1024);
	assert.match(previewEmbedText(quality, { text: "who is Andrei" }, "query"), /^Instruct: .+\nQuery:who is Andrei$/);
	assert.equal(previewEmbedText(quality, { title: "Profile", text: "fact" }, "document"), "Profile — fact");
});
await check("truncateAndNormalize applies MRL dimensions and unit length", () => {
	const out = truncateAndNormalize([3, 4, 99, 99], 2);
	assert.equal(out.length, 2);
	assert.ok(Math.abs(out[0] - 0.6) < 1e-6 && Math.abs(out[1] - 0.8) < 1e-6, `got ${out[0]},${out[1]}`);
});

console.log("chunking");
await check("claims become chunks and inactive claims are skipped", () => {
	const chunks = chunkPage({
		path: "personal/profile.md",
		title: "Profile",
		body: "x".repeat(200),
		claims: [
			{ id: "c1", text: "Active claim.", status: "verified" },
			{ id: "c2", text: "Old claim.", status: "superseded" },
			{ id: "c3", text: "Stated claim.", status: "user-stated" },
		],
	});
	const keys = chunks.filter((chunk) => chunk.kind === "claim").map((chunk) => chunk.key);
	assert.deepEqual(keys, ["claim:c1", "claim:c3"]);
	assert.equal(chunks.find((chunk) => chunk.key === "claim:c1")?.status, "verified");
});
await check("sections are heading-keyed and stable across body edits", () => {
	const first = splitSections("# Alpha\n\n" + "a".repeat(120) + "\n\n## Beta\n\n" + "b".repeat(120));
	const second = splitSections("# Alpha\n\n" + "a".repeat(200) + "\n\n## Beta\n\n" + "b".repeat(120));
	assert.deepEqual(first.map((s) => s.slug), ["alpha", "beta"]);
	assert.deepEqual(second.map((s) => s.slug), ["alpha", "beta"]);
});
await check("long sections are windowed with overlap", () => {
	const sections = splitSections("# Big\n\n" + "sentence. ".repeat(400), 1000, 200);
	assert.ok(sections.length > 1, "expected multiple windows");
	assert.ok(sections.every((section) => section.text.length <= 1000));
});
await check("chunk hashes change with text", () => {
	assert.equal(hashChunk("T", "same"), hashChunk("T", "same"));
	assert.notEqual(hashChunk("T", "same"), hashChunk("T", "different"));
});

console.log("RRF fusion");
await check("a daemon that fails to start through the shim says why in the log", async () => {
	// The client spawns daemon.mjs with stdio ignored, so the log is the only place a startup
	// failure can surface.
	const dir = await mkdtemp(join(tmpdir(), "jev-shim-"));
	try {
		const logPath = join(dir, "embedder.log");
		const shim = fileURLToPath(new URL("../src/vector/embedder/daemon.mjs", import.meta.url));
		const child = spawn(process.execPath, [shim, join(dir, "embed.sock"), dir, "no-such-preset", "", "0", "0", logPath, "false"], { stdio: "ignore" });
		const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
		assert.equal(code, 1);
		assert.ok(existsSync(logPath), "the startup failure was not written to the log");
		assert.match(await readFile(logPath, "utf8"), /failed to start: Unknown search\.vector\.model "no-such-preset"/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

await check("rank fusion favors results ranked highly by both engines", () => {
	const result = (path: string, score = 1): SearchResult => ({ path, title: path, score, excerpt: "" });
	const fused = rrfFuse([[result("a"), result("b")], [result("b"), result("c")]], 60);
	assert.deepEqual(fused.map((entry) => entry.path), ["b", "a", "c"]);
});
await check("fusion dedupes identical wiki/path/anchor keys", () => {
	const one: SearchResult = { path: "p.md", title: "p", score: 1, excerpt: "", wiki: "life", anchor: "c1" };
	const fused = rrfFuse([[one], [{ ...one }]], 60);
	assert.equal(fused.length, 1);
	assert.ok(fused[0].score > 1 / 61, "score should accumulate");
});
await check("fusion merges a page-level hit into its claim-level sibling", () => {
	const page: SearchResult = { path: "p.md", title: "p", score: 1, excerpt: "page summary", wiki: "life" };
	const claim: SearchResult = { path: "p.md", title: "p", score: 0.9, excerpt: "claim text", wiki: "life", anchor: "c1" };
	const fused = rrfFuse([[page], [claim]], 60);
	assert.equal(fused.length, 1);
	assert.equal(fused[0].anchor, "c1");
	assert.ok(fused[0].score > 1 / 61, "scores accumulate across granularities");
});
await check("fusion keeps distinct claim anchors on one page separate", () => {
	const one: SearchResult = { path: "p.md", title: "p", score: 1, excerpt: "", wiki: "home", anchor: "c1" };
	const two: SearchResult = { path: "p.md", title: "p", score: 1, excerpt: "", wiki: "home", anchor: "c5" };
	const fused = rrfFuse([[one, two]], 60);
	assert.equal(fused.length, 2);
});
await check("named engines stamp a wiki onto untagged results", async () => {
	const engine = new NamedSearchEngine(
		{
			name: "fake",
			async search() {
				return [{ path: "p.md", title: "p", score: 1, excerpt: "", source: "global" as const }];
			},
		},
		"global-vault",
	);
	const hits = await engine.search({ query: "x" });
	assert.equal(hits[0].wiki, "global-vault");
	assert.equal(engine.name, "fake");
});

console.log("wiki registry");
await check("registers, dedupes, renames collisions, toggles, and removes", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "jev-registry-"));
	const rootA = join(agentDir, "docs", "life");
	const rootB = join(agentDir, "other", "life");
	await mkdir(rootA, { recursive: true });
	await mkdir(rootB, { recursive: true });
	const first = await registerWiki(agentDir, rootA);
	assert.equal(first.created, true);
	assert.equal(first.registration.name, "life");
	const again = await registerWiki(agentDir, rootA);
	assert.equal(again.created, false);
	const second = await registerWiki(agentDir, rootB);
	assert.equal(second.registration.name, "life-2");
	await setWikiEnabled(agentDir, "life", false);
	const registry = await readRegistry(agentDir);
	assert.deepEqual(enabledWikiNames(registry), ["life-2"]);
	await unregisterWiki(agentDir, "life-2");
	assert.equal((await readRegistry(agentDir)).wikis.length, 1);
	const genericRoot = join(agentDir, "docs", "wiki");
	await mkdir(genericRoot, { recursive: true });
	const generic = await registerWiki(agentDir, genericRoot);
	assert.ok(!["wiki", "docs"].includes(generic.registration.name), `generic segments should be skipped, got ${generic.registration.name}`);
	await rm(agentDir, { recursive: true, force: true });
});

console.log("index integration (SQLite store)");
await check("indexes, skips unchanged chunks, and re-embeds edits", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "jev-index-"));
	const wikiDir = join(agentDir, "wiki");
	await mkdir(join(wikiDir, "notes"), { recursive: true });
	const alphaPath = join(wikiDir, "notes", "alpha.md");
	await writeFile(alphaPath, page("Alpha page", "c1", "Alpha claim about widgets.", "widget maintenance details ".repeat(8)));
	await writeFile(join(wikiDir, "notes", "beta.md"), page("Beta page", "c1", "Beta claim about gadgets.", "unrelated section body text ".repeat(8)));
	await writeFile(join(wikiDir, "toc.md"), "# Wiki TOC\n\n> Generated table of contents.\n");

	const provider = fakeProvider();
	const base = { agentDir, wiki: "testwiki", root: agentDir, model: "performance", dimensions: 4, provider };
	const first = await indexWiki(base);
	assert.equal(first.embedded, 4, `expected 4 chunks (generated toc.md excluded), got ${first.embedded}`);
	assert.equal(first.total, 4);
	const second = await indexWiki(base);
	assert.equal(second.embedded, 0);
	assert.equal(second.skipped, 4);

	await writeFile(alphaPath, page("Alpha page", "c1", "Alpha claim about sprockets.", "widget maintenance details ".repeat(8)));
	const third = await indexWiki({ ...base, paths: ["notes/alpha.md"] });
	assert.equal(third.embedded, 1, `expected only the edited claim, got ${third.embedded}`);
	assert.equal(third.skipped, 1);

	const db = vectorDbFor(vectorDataDir(agentDir));
	const hashes = await db.hashes("testwiki", provider.fingerprint);
	assert.ok([...hashes.keys()].some((key) => key === "notes/alpha.md\u0000claim:c1"));
	assert.ok(![...hashes.keys()].some((key) => key.includes("superseded")));

const [queryVector] = await provider.embed([{ text: "alpha" }], "query");
	const hits = await db.knn(queryVector, { fingerprint: provider.fingerprint, dim: 4, limit: 3 });
	assert.equal(hits[0].key, "claim:c1");
	assert.equal(hits[0].wiki, "testwiki");

	await forgetWikiIndex(agentDir, "testwiki");
	assert.equal((await db.counts()).length, 0);

	const emptyRoot = join(agentDir, "empty");
	await mkdir(join(emptyRoot, "wiki"), { recursive: true });
	const empty = await indexWiki({ agentDir, wiki: "emptywiki", root: emptyRoot, model: "performance", dimensions: 4, provider });
	assert.equal(empty.total, 0);
	assert.equal(await hasWarmIndex(agentDir, "emptywiki", provider.fingerprint), true);
	await db.close();
	await rm(agentDir, { recursive: true, force: true });
});

console.log("index store (SQLite)");
await check("the embedder replaces a stale socket file but never a live one", async () => {
	if (process.platform === "win32") return; // named pipes leave no file behind
	const dir = await mkdtemp(join(tmpdir(), "jev-sock-"));
	const pipePath = join(dir, "e.sock");
	try {
		// A daemon killed hard (SIGKILL, OOM, a crash) never unlinks its socket.
		const holder = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(pipePath)}, () => console.log("up"))`]);
		await new Promise<void>((resolve) => holder.stdout.once("data", () => resolve()));
		const exited = new Promise((resolve) => holder.once("exit", resolve));
		holder.kill("SIGKILL");
		await exited;
		assert.ok(existsSync(pipePath), "the killed holder left its socket file behind");

		const service = await startEmbedderService({ pipePath, provider: fakeProvider(), model: "fake" });
		try {
			await new Promise<void>((resolve, reject) => {
				const socket = connect(pipePath, () => {
					socket.destroy();
					resolve();
				});
				socket.once("error", reject);
			});
			await assert.rejects(
				startEmbedderService({ pipePath, provider: fakeProvider(), model: "fake" }),
				/EADDRINUSE/,
				"a second daemon must not take over a socket that is still answering",
			);
		} finally {
			await service.stop();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

await check("a reset is a file delete that a live session handle does not block", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "jev-reset-"));
	await mkdir(join(agentDir, "wiki", "notes"), { recursive: true });
	await writeFile(join(agentDir, "wiki", "notes", "alpha.md"), page("Alpha page", "c1", "Alpha claim about widgets.", "widget body text ".repeat(20)));
	const provider = fakeProvider();
	const dataDir = vectorDataDir(agentDir);
	const db = vectorDbFor(dataDir);
	const base = { agentDir, wiki: "resetwiki", root: agentDir, model: "performance", dimensions: 4, provider };

	await indexWiki(base);
	assert.ok(await db.hasAny(), "store should hold chunks after indexing");
	assert.equal(await hasWarmIndex(agentDir, "resetwiki", provider.fingerprint), true);

	// The whole point of the store: no open handle, so a delete works while sessions run.
	assert.equal(await resetStore(dataDir), true);
	assert.equal(await db.hasAny(), false, "a reset store must read as empty, not fail");
	assert.deepEqual(await db.counts(), []);
	assert.equal(await hasWarmIndex(agentDir, "resetwiki", provider.fingerprint), false);

	await indexWiki(base);
	assert.equal(await hasWarmIndex(agentDir, "resetwiki", provider.fingerprint), true);
	await db.close();
	await rm(agentDir, { recursive: true, force: true });
});

await check("stores the vectors it was given and ranks them by exact cosine", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "jev-cos-"));
	await mkdir(join(agentDir, "wiki", "notes"), { recursive: true });
	const dims = 8;
	const produced: Float32Array[] = [];
	const provider: EmbeddingProvider = {
		id: "det8",
		fingerprint: `det8@v1:f32:${dims}`,
		dimensions: dims,
		async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
			return inputs.map((input) => {
				const vector = deterministicVector(input.text, dims);
				produced.push(vector);
				return vector;
			});
		},
	};
	for (let i = 0; i < 6; i += 1) {
		await writeFile(
			join(agentDir, "wiki", "notes", `page${i}.md`),
			page(`Page ${i}`, "c1", `Claim ${i} about topic ${i * 7}.`, `body text for page ${i} `.repeat(6)),
		);
	}
	await indexWiki({ agentDir, wiki: "coswiki", root: agentDir, model: "performance", dimensions: dims, provider });

	// What landed on disk must be exactly what the provider produced.
	const rows = await rawRows(vectorDataDir(agentDir));
	const stored = new Set(rows.map((row) => Buffer.from(row.embedding as Uint8Array).toString("base64")));
	const expected = new Set(produced.map((vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64")));
	assert.deepEqual(stored, expected, "stored vectors must round-trip byte for byte");

	// Ranking is re-derived here, independently of the store's own scorer.
	const db = vectorDbFor(vectorDataDir(agentDir));
	for (let i = 0; i < 5; i += 1) {
		const query = deterministicVector(`query ${i} topic ${i}`, dims);
		const hits = await db.knn(query, { fingerprint: provider.fingerprint, dim: dims, limit: 4 });
		const reference = rows
			.filter((row) => row.fingerprint === provider.fingerprint)
			.map((row) => {
				const bytes = row.embedding as Uint8Array;
				return { key: String(row.key), score: cosine(query, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)) };
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, 4);
		assert.deepEqual(
			hits.map((hit) => [hit.key, Number(hit.score.toFixed(6))]),
			reference.map((entry) => [entry.key, Number(entry.score.toFixed(6))]),
			`ranking for query ${i} must match an independent cosine scan`,
		);
	}

	// Another identity's rows are invisible, whatever their vector similarity.
	const foreign = await db.knn(deterministicVector("claim", dims), { fingerprint: "det8@v2:f32:8", dim: dims, limit: 4 });
	assert.deepEqual(foreign, [], "rows from another embedder identity must never be returned");
	await db.close();
	await rm(agentDir, { recursive: true, force: true });
});

await check("two processes share one store without a single owner", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "jev-multi-"));
	const dataDir = vectorDataDir(agentDir);
	const db = vectorDbFor(dataDir);
	await db.init();

	const here = dirname(fileURLToPath(import.meta.url));
	const childScript = existsSync(join(here, "store-child.mjs")) ? join(here, "store-child.mjs") : join(process.cwd(), "scripts", "store-child.mjs");
	assert.ok(existsSync(childScript), `concurrency child script not found at ${childScript}`);
	const child = spawn(process.execPath, [childScript, storePath(dataDir), "childwiki", "4"], { stdio: ["ignore", "pipe", "pipe"] });
	let childOut = "";
	let childErr = "";
	child.stdout.on("data", (chunk) => (childOut += String(chunk)));
	child.stderr.on("data", (chunk) => (childErr += String(chunk)));
	const childDone = new Promise<number>((resolve, reject) => {
		child.on("exit", (value) => resolve(value ?? -1));
		child.on("error", reject);
	});

	const vector = new Float32Array(4).fill(0.5);
	for (let i = 0; i < 60; i += 1) {
		await db.upsert([
			{
				wiki: "parentwiki",
				path: `notes/parent-${i % 5}.md`,
				key: `k${i}`,
				kind: "section",
				claimId: null,
				status: "verified",
				title: "t",
				text: "b",
				hash: `h${i}`,
				model: "performance",
				fingerprint: "parent@v1:q8:4",
				dim: 4,
				embedding: vector,
			},
		]);
		assert.ok((await db.counts()).length > 0, "reads must keep working while another process writes");
	}

	const code = await childDone;
	assert.equal(code, 0, `child process failed: ${childErr}`);
	const report = JSON.parse(childOut.trim() || "{}") as { writes: number; reads: number; errors: string[] };
	assert.deepEqual(report.errors, [], `child saw errors: ${report.errors.join(", ")}`);
	assert.ok(report.writes > 200 && report.reads > 200, `child did too little: ${JSON.stringify(report)}`);

	const counts = await db.counts();
	assert.equal(counts.find((entry) => entry.wiki === "childwiki")?.chunks, 250, "the child's writes must all be visible");
	assert.equal(counts.find((entry) => entry.wiki === "parentwiki")?.chunks, 60, "the parent's writes must all survive");
	const integrity = await rawRows(dataDir, "PRAGMA integrity_check");
	assert.equal(String(integrity[0]?.integrity_check), "ok", "store integrity after concurrent writes");
	await db.close();
	await rm(agentDir, { recursive: true, force: true });
});

function deterministicVector(text: string, dims: number): Float32Array {
	let hash = 2166136261;
	const out = new Float32Array(dims);
	for (let i = 0; i < dims; i += 1) {
		for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
		hash = Math.imul(hash ^ (i + 1), 16777619) >>> 0;
		out[i] = ((hash % 2000) - 1000) / 1000;
	}
	return truncateAndNormalize(out, dims);
}

function cosine(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i += 1) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function rawRows(dataDir: string, sql = "SELECT wiki, path, key, fingerprint, dim, embedding FROM chunks"): Promise<Array<Record<string, unknown>>> {
	const { DatabaseSync } = await import("node:sqlite");
	const db = new DatabaseSync(storePath(dataDir));
	try {
		return db.prepare(sql).all() as Array<Record<string, unknown>>;
	} finally {
		db.close();
	}
}

function page(title: string, claimId: string, claimText: string, body: string): string {
	return `---\ntitle: ${title}\ntype: concept\nsummary: test\nclaims:\n  - id: ${claimId}\n    text: "${claimText}"\n    status: verified\n  - id: old\n    text: "Superseded claim."\n    status: superseded\n---\n\n# ${title}\n\n${body}\n`;
}

function fakeProvider(): EmbeddingProvider {
	return {
		id: "fake",
		fingerprint: "fake@v1:test:4",
		dimensions: 4,
		async embed(inputs: EmbedInput[]): Promise<Float32Array[]> {
			return inputs.map((input) => {
				const vector = new Float32Array(4);
				const text = input.text.toLowerCase();
				if (text.includes("alpha")) vector[0] = 1;
				else if (text.includes("beta")) vector[1] = 1;
				else vector[2] = 1;
				return vector;
			});
		},
	};
}

console.log("wiki discovery");
await check("finds wiki roots, respects skip rules and project configs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-discover-"));
	const alphaRoot = join(dir, "projects", "alpha", "docs", "wiki");
	await mkdir(join(alphaRoot, "wiki"), { recursive: true });
	await mkdir(join(alphaRoot, "raw", "notes"), { recursive: true });
	await mkdir(join(alphaRoot, ".jev-wiki"), { recursive: true });
	await writeFile(join(alphaRoot, ".jev-wiki", "decisions.jsonl"), "");
	await writeFile(join(alphaRoot, "wiki", "index.md"), "# Index\n");
	await writeFile(join(alphaRoot, "wiki", "page.md"), page("Alpha", "c1", "Alpha claim.", "body text ".repeat(20)));
	await writeFile(join(alphaRoot, "raw", "notes", "src.md"), "source");

	const betaRoot = join(dir, "projects", "beta", "knowledge");
	await mkdir(join(dir, "projects", "beta", ".pi"), { recursive: true });
	await writeFile(join(dir, "projects", "beta", ".pi", "jev-wiki.json"), JSON.stringify({ wikiRoot: "knowledge" }));
	await mkdir(join(betaRoot, "wiki"), { recursive: true });
	await writeFile(join(betaRoot, "wiki", "index.md"), "# Beta\n");

	await mkdir(join(dir, "projects", "decoy", "wiki"), { recursive: true });
	await writeFile(join(dir, "projects", "decoy", "wiki", "notes.md"), "# notes\n");
	await mkdir(join(dir, "projects", "gamma", "node_modules", "pkg", "docs", "wiki", "wiki"), { recursive: true });
	await writeFile(join(dir, "projects", "gamma", "node_modules", "pkg", "docs", "wiki", "wiki", "index.md"), "# hidden\n");

	const found = await discoverWikis({ roots: [dir], maxDepth: 8, wsl: false });
	const roots = found.map((entry) => entry.root);
	assert.ok(roots.some((root) => root.endsWith("alpha/docs/wiki")), `alpha missing: ${roots.join(", ")}`);
	assert.ok(roots.some((root) => root.endsWith("beta/knowledge")), `beta missing: ${roots.join(", ")}`);
	assert.ok(!roots.some((root) => root.includes("decoy")), "decoy should not be detected");
	assert.ok(!roots.some((root) => root.includes("node_modules")), "skipped dirs should not be scanned");
	const alpha = found.find((entry) => entry.root.endsWith("alpha/docs/wiki"));
	assert.equal(alpha?.pages, 1);
	assert.equal(alpha?.rawSources, 1);
	assert.equal(alpha?.marker, "state-dir");
	await rm(dir, { recursive: true, force: true });
});
await check("reconciles registered wikis and flags missing roots", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-discover-reg-"));
	const real = join(dir, "real", "docs", "wiki");
	await mkdir(join(real, "wiki"), { recursive: true });
	await writeFile(join(real, "wiki", "index.md"), "# R\n");
	const gone = join(dir, "gone", "docs", "wiki");
	const found = await discoverWikis({
		roots: [dir],
		maxDepth: 6,
		wsl: false,
		registry: [
			{ name: "real", root: real, enabled: true, added: "2026-01-01T00:00:00.000Z" },
			{ name: "gone", root: gone, enabled: true, added: "2026-01-01T00:00:00.000Z" },
		],
		states: new Map([["real", { chunks: 7, model: "performance", updatedAt: "2026-01-02T00:00:00.000Z" }]]),
	});
	const realEntry = found.find((entry) => entry.name === "real");
	assert.equal(realEntry?.registered, true);
	assert.equal(realEntry?.chunks, 7);
	assert.equal(found.find((entry) => entry.name === "gone")?.missing, true);
	await rm(dir, { recursive: true, force: true });
});

console.log("embedding model selection");
await check("writes and reads the model choice while preserving other keys", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-settings-"));
	const configPath = join(dir, "jev-wiki.json");
	await writeFile(configPath, JSON.stringify({ provider: "typesafe", search: { engine: "auto" } }));
	await writeModelSetting(configPath, "quality");
	const written = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
	assert.equal((written.search as { vector?: { model?: string } }).vector?.model, "quality");
	assert.equal((written.search as { engine?: string }).engine, "auto");
	assert.equal(written.provider, "typesafe");
	assert.equal(await configuredModel(configPath), "quality");
	await rm(dir, { recursive: true, force: true });
});
await check("model choice source prefers project over user over default", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-settings-src-"));
	const userConfig = join(dir, "agent", "jev-wiki.json");
	const projectConfig = join(dir, "project", ".pi", "jev-wiki.json");
	await mkdir(dirname(userConfig), { recursive: true });
	await mkdir(dirname(projectConfig), { recursive: true });
	await writeModelSetting(userConfig, "quality");
	const loaded = {
		projectConfigPath: projectConfig,
		globalConfigPath: userConfig,
		config: { search: { vector: { model: "performance" } } },
	} as unknown as LoadedConfig;
	assert.deepEqual(await modelChoiceSource(loaded), { model: "quality", source: "user" });
	await writeModelSetting(projectConfig, "performance");
	assert.deepEqual(await modelChoiceSource(loaded), { model: "performance", source: "project" });
	await rm(dir, { recursive: true, force: true });
});

console.log("catalog and manifest");
await check("manifest tracks page counts, topics, and staleness", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-catalog-"));
	const root = join(dir, "alpha", "docs", "wiki");
	await mkdir(join(root, "wiki", "topic"), { recursive: true });
	await writeFile(join(root, "wiki", "topic", "a.md"), "# A\n");
	await writeFile(join(root, "wiki", "topic", "b.md"), "# B\n");
	const layout = resolveLayout(root, ".", ".jev-wiki");
	const entries = [
		entryFromPage("topic/a.md", { title: "A", type: "concept", summary: "first", tags: [], updated: "2026-01-01" }),
		entryFromPage("topic/b.md", { title: "B", type: "concept", summary: "second", tags: [], updated: "2026-01-01" }),
	];
	await updateIndex(layout, (current) => upsertEntries(current, entries));
	const manifest = await readManifest(layout);
	assert.equal(manifest?.pages, 2);
	assert.deepEqual(manifest?.topics, [{ slug: "topic", count: 2 }]);
	assert.equal(await countPages(layout), 2, "generated index/toc files are excluded");
	assert.ok(manifest?.entriesHash);

	// A page touched after the manifest was written makes the TOC stale.
	const future = new Date(Date.now() + 60_000);
	await utimes(join(root, "wiki", "topic", "a.md"), future, future);
	const catalog = await buildCatalog({
		registry: [{ name: "alpha", root: root.replace(/\\/g, "/"), enabled: true, added: "2026-01-01T00:00:00.000Z" }],
		states: new Map([["alpha", { chunks: 3, model: "performance", updatedAt: new Date().toISOString() }]]),
		stateRoot: ".jev-wiki",
		model: "performance",
	});
	const alpha = catalog.entries[0];
	assert.ok(alpha.flags.includes("toc-stale"), `expected toc-stale, got ${alpha.flags.join(",")}`);
	assert.equal(alpha.pages, 2);
	assert.equal(alpha.chunks, 3);
	await rm(dir, { recursive: true, force: true });
});
await check("catalog isolates missing roots and flags model mismatches", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-catalog2-"));
	const root = join(dir, "beta");
	await mkdir(join(root, "wiki"), { recursive: true });
	await writeFile(join(root, "wiki", "p.md"), "# P\n");
	const layout = resolveLayout(root, ".", ".jev-wiki");
	await updateIndex(layout, (current) =>
		upsertEntries(current, [entryFromPage("p.md", { title: "P", type: "concept", summary: "s", tags: [], updated: "2026-01-01" })]),
	);
	const catalog = await buildCatalog({
		registry: [
			{ name: "beta", root: root.replace(/\\/g, "/"), enabled: true, added: "2026-01-01T00:00:00.000Z" },
			{ name: "gone", root: join(dir, "gone").replace(/\\/g, "/"), enabled: true, added: "2026-01-01T00:00:00.000Z" },
		],
		states: new Map([["beta", { chunks: 9, model: "quality", updatedAt: "2026-01-02T00:00:00.000Z" }]]),
		stateRoot: ".jev-wiki",
		model: "performance",
	});
	assert.equal(catalog.total, 2);
	assert.deepEqual(catalog.entries.find((entry) => entry.name === "gone")?.flags, ["root-missing"]);
	const beta = catalog.entries.find((entry) => entry.name === "beta");
	assert.ok(beta?.flags.includes("model-mismatch"));
	assert.ok(!beta?.flags.includes("never-indexed"));
	await rm(dir, { recursive: true, force: true });
});

console.log("Jev retrieval judgments");
await check("reranks by judged relevance and flags insufficient evidence", async () => {
	const results: SearchResult[] = [
		{ path: "a.md", title: "A", score: 0.03, excerpt: "first", wiki: "home" },
		{ path: "b.md", title: "B", score: 0.02, excerpt: "second", wiki: "home" },
	];
	const client = {
		async systemOne() {
			return {
				model: "fake",
				answers: { c1: { type: "noul", noul: 0.1 }, c2: { type: "noul", noul: 0.9 }, sufficient: { type: "noul", noul: 0.3 } },
				usage: { input_tokens: 1, output_tokens: 1 },
			};
		},
	} as unknown as JevClient;
	const judgment = await judgeRetrieval({ client, query: "q", results, minSufficiency: 0.5 });
	assert.equal(judgment.results[0].path, "b.md");
	assert.equal(judgment.sufficiency, 0.3);
	assert.ok(judgment.notes.some((note) => note.includes("insufficient")));
	assert.equal(judgment.candidateScores.length, 2);
});
await check("propagates Jev failures so callers can fall back", async () => {
	const client = { async systemOne() { throw new Error("no key"); } } as unknown as JevClient;
	await assert.rejects(
		() => judgeRetrieval({ client, query: "q", results: [{ path: "a.md", title: "A", score: 1, excerpt: "x" }] }),
		/no key/,
	);
});

await check("catalog scales across many wikis", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jev-catalog-scale-"));
	const registry: Array<{ name: string; root: string; enabled: boolean; added: string }> = [];
	for (let index = 0; index < 100; index++) {
		const root = join(dir, `wiki-${index}`);
		await mkdir(join(root, "wiki"), { recursive: true });
		await writeFile(join(root, "wiki", "p.md"), "# P\n");
		const layout = resolveLayout(root, ".", ".jev-wiki");
		await updateIndex(layout, (current) =>
			upsertEntries(current, [entryFromPage("p.md", { title: `P${index}`, type: "concept", summary: "s", tags: [], updated: "2026-01-01" })]),
		);
		registry.push({ name: `wiki-${index}`, root: root.replace(/\\/g, "/"), enabled: true, added: "2026-01-01T00:00:00.000Z" });
	}
	const started = Date.now();
	const catalog = await buildCatalog({ registry, states: new Map(), stateRoot: ".jev-wiki", model: "performance", limit: 100 });
	const elapsed = Date.now() - started;
	assert.equal(catalog.total, 100);
	assert.equal(catalog.entries.length, 100);
	console.log(`      (100 wikis catalogued in ${elapsed}ms)`);
	assert.ok(elapsed < 10_000, `catalog took ${elapsed}ms`);
	await rm(dir, { recursive: true, force: true });
});

if (failures > 0) {
	console.error(`\n${failures} vector test(s) failed.`);
	process.exit(1);
}
console.log("\nAll vector tests passed.");
