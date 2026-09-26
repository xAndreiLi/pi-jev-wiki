/**
 * Vector pipeline tests: prompt templates, chunking, RRF fusion, the wiki
 * registry, and a PGlite + pgvector integration pass with a fake embedder.
 * Run: npm run test:vector
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chunkPage, hashChunk, splitSections } from "../src/vector/chunks.ts";
import { MODEL_PRESETS, previewEmbedText, truncateAndNormalize, type EmbedInput, type EmbeddingProvider } from "../src/vector/embed.ts";
import { forgetWikiIndex, hasWarmIndex, indexWiki } from "../src/vector/index.ts";
import { enabledWikiNames, readRegistry, registerWiki, setWikiEnabled, unregisterWiki } from "../src/vector/registry.ts";
import { vectorDbFor } from "../src/vector/db.ts";
import { vectorDataDir } from "../src/vector/registry.ts";
import { discoverWikis } from "../src/vector/discover.ts";
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

console.log("index integration (PGlite + pgvector)");
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
	const hashes = await db.hashes("testwiki", "performance");
	assert.ok([...hashes.keys()].some((key) => key === "notes/alpha.md\u0000claim:c1"));
	assert.ok(![...hashes.keys()].some((key) => key.includes("superseded")));

	const [queryVector] = await provider.embed([{ text: "alpha" }], "query");
	const hits = await db.knn(queryVector, { model: "performance", dim: 4, limit: 3 });
	assert.equal(hits[0].key, "claim:c1");
	assert.equal(hits[0].wiki, "testwiki");

	await forgetWikiIndex(agentDir, "testwiki");
	assert.equal((await db.counts()).length, 0);

	const emptyRoot = join(agentDir, "empty");
	await mkdir(join(emptyRoot, "wiki"), { recursive: true });
	const empty = await indexWiki({ agentDir, wiki: "emptywiki", root: emptyRoot, model: "performance", dimensions: 4, provider });
	assert.equal(empty.total, 0);
	assert.equal(await hasWarmIndex(agentDir, "emptywiki", "performance"), true);
	await db.close();
	await rm(agentDir, { recursive: true, force: true });
});

function page(title: string, claimId: string, claimText: string, body: string): string {
	return `---\ntitle: ${title}\ntype: concept\nsummary: test\nclaims:\n  - id: ${claimId}\n    text: "${claimText}"\n    status: verified\n  - id: old\n    text: "Superseded claim."\n    status: superseded\n---\n\n# ${title}\n\n${body}\n`;
}

function fakeProvider(): EmbeddingProvider {
	return {
		id: "fake",
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

if (failures > 0) {
	console.error(`\n${failures} vector test(s) failed.`);
	process.exit(1);
}
console.log("\nAll vector tests passed.");
