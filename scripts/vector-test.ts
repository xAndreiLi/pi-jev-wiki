/**
 * Vector pipeline tests: prompt templates, chunking, RRF fusion, the wiki
 * registry, and a PGlite + pgvector integration pass with a fake embedder.
 * Run: npm run test:vector
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkPage, hashChunk, splitSections } from "../src/vector/chunks.ts";
import { MODEL_PRESETS, previewEmbedText, truncateAndNormalize, type EmbedInput, type EmbeddingProvider } from "../src/vector/embed.ts";
import { forgetWikiIndex, indexWiki } from "../src/vector/index.ts";
import { enabledWikiNames, readRegistry, registerWiki, setWikiEnabled, unregisterWiki } from "../src/vector/registry.ts";
import { vectorDbFor } from "../src/vector/db.ts";
import { vectorDataDir } from "../src/vector/registry.ts";
import { rrfFuse, type SearchResult } from "../src/wiki/search.ts";

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

	const provider = fakeProvider();
	const base = { agentDir, wiki: "testwiki", root: agentDir, model: "performance", dimensions: 4, provider };
	const first = await indexWiki(base);
	assert.equal(first.embedded, 4, `expected 4 chunks, got ${first.embedded}`);
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

if (failures > 0) {
	console.error(`\n${failures} vector test(s) failed.`);
	process.exit(1);
}
console.log("\nAll vector tests passed.");
