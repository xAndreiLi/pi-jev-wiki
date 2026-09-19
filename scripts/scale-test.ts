/**
 * P3 scale acceptance: 1,000-page synthetic wiki.
 * - BM25 index build + 20 queries must stay fast
 * - deterministic lint (TOC/link/orphan/raw checks) must stay fast
 * Routing beyond 255 candidates is covered by scripts/paging-test.ts.
 * Run: npm run test:scale
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { lintWiki } from "../src/lint.ts";
import { ensureLayout, resolveLayout, writePage } from "../src/wiki/layout.ts";
import { Bm25SearchEngine } from "../src/wiki/search.ts";
import { entryFromPage, readIndex, upsertEntries, writeIndex } from "../src/wiki/toc.ts";
import type { JevClient } from "../src/jev.ts";

const PAGES = 1000;
const TOPICS = ["architecture", "decisions", "invariants", "gotchas", "concepts"];

const root = await mkdtemp(join(tmpdir(), "jev-wiki-scale-"));
const layout = resolveLayout(root, "wiki", ".state");
await ensureLayout(layout);

console.log(`generating ${PAGES} pages in ${root} ...`);
const entries = [];
for (let index = 0; index < PAGES; index++) {
	const topic = TOPICS[index % TOPICS.length];
	const id = index + 1;
	const distinctive = id === 731;
	const title = distinctive ? "Retry budget invariant" : `Synthetic page ${id}`;
	const summary = distinctive
		? "The retry budget is capped per tenant and must never be bypassed by background jobs"
		: `Synthetic knowledge ${id} about ${topic} subsystem ${id}`;
	const nextId = ((id + 1) % PAGES) + 1;
	const nextTopic = TOPICS[(nextId - 1) % TOPICS.length];
	const body = [
		`# ${title}`,
		"",
		summary,
		"",
		"## Details",
		`This page covers ${topic} concerns for component ${id}.`,
		distinctive
			? "Background jobs must respect tenant retry budgets; bypassing them causes cross-tenant throttling incidents."
			: `Unrelated detail line for component ${id}.`,
		"",
		"## See also",
		`- [Synthetic page ${nextId}](../${nextTopic}/page-${nextId}.md)`,
	].join("\n");
	const rel = `${topic}/page-${id}.md`;
	await writePage(
		join(layout.wikiDir, rel),
		{
			title,
			type: topic === "architecture" ? "architecture/module" : topic.slice(0, -1),
			topic,
			summary,
			tags: [topic, `component-${id % 50}`],
			updated: "2026-09-19",
			claims: [{ id: "c1", text: summary, status: "verified", support: 0.9, evidence: [] }],
			files: [],
		},
		body,
	);
	entries.push(entryFromPage(rel, { title, type: topic, summary, tags: [topic], updated: "2026-09-19" }));
}
await writeIndex(layout, upsertEntries(await readIndex(layout), entries));

const compactToc = await readFile(join(layout.wikiDir, "toc.md"), "utf8");
const topicFiles = await readdir(join(layout.wikiDir, "toc"));
console.log(`toc: compact ${compactToc.length} chars, ${topicFiles.length} topic tables`);
assert.ok(compactToc.length < 4000, `compact toc should stay small, got ${compactToc.length} chars`);
assert.equal(topicFiles.length, TOPICS.length, "expected one table per topic");

const engine = new Bm25SearchEngine(layout);
const queries = [
	"retry budget per tenant background jobs",
	"cross-tenant throttling invariant",
	"synthetic knowledge 12 architecture",
	"component 480 decisions",
	"gotchas subsystem 99",
	...Array.from({ length: 15 }, (_, index) => `synthetic page ${100 + index * 37}`),
];

const searchStart = Date.now();
const first = await engine.search({ query: queries[0], limit: 5 });
const searchMs = Date.now() - searchStart;
const queryStart = Date.now();
for (const query of queries) await engine.search({ query, limit: 5 });
const queryMs = Date.now() - queryStart;

console.log(`bm25: first search ${searchMs}ms, ${queries.length} queries ${queryMs}ms`);
console.log(`top hit for distinctive query: ${first[0]?.path ?? "(none)"}`);
assert.ok(first[0]?.path.endsWith("page-731.md"), `distinctive page should be the top hit, got ${first[0]?.path}`);
assert.ok(queryMs < 10_000, `20 queries should take < 10s, took ${queryMs}ms`);

const lintStart = Date.now();
const report = await lintWiki(layout, {} as JevClient, loadConfig(process.cwd()).config, {
	autoFix: true,
	checkContradictions: false,
});
const lintMs = Date.now() - lintStart;
console.log(`lint: ${report.pages} pages in ${lintMs}ms · toc added ${report.toc.added.length} · broken ${report.brokenLinks.length} · orphans ${report.orphans.length}`);
assert.equal(report.pages, PAGES, "lint should see every page");
assert.ok(lintMs < 30_000, `lint should take < 30s, took ${lintMs}ms`);

await rm(root, { recursive: true, force: true });
console.log("\nScale test passed.");
