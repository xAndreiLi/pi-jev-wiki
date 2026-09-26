/**
 * Offline integration test: drive registered tools through the extension wiring
 * with a sandboxed agent dir (PI_CODING_AGENT_DIR), and assert cross-wiki write
 * isolation. No network, no API key, no model calls.
 * Run: npm run test:integration
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueReview } from "../src/review.ts";
import { resolveLayout } from "../src/wiki/layout.ts";

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

const root = await mkdtemp(join(tmpdir(), "jev-wiki-integration-"));
const agentDir = join(root, "agent");
process.env.PI_CODING_AGENT_DIR = agentDir;

// Import after the sandbox is in place so config resolution reads it.
const { default: extension } = await import("../src/extension.ts");

interface ToolResult {
	content: Array<{ type: string; text: string }>;
	details: unknown;
}
interface ToolDef {
	name: string;
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<ToolResult>;
}

const tools = new Map<string, ToolDef>();
extension({
	registerTool: (definition: ToolDef) => {
		tools.set(definition.name, definition);
	},
	registerCommand: () => undefined,
	on: () => undefined,
	sendMessage: () => undefined,
} as never);

const projectA = join(root, "project-a");
const wikiA = join(projectA, "docs", "wiki");
const projectB = join(root, "project-b");
const wikiB = join(projectB, "wiki");
const posix = (path: string) => path.split("\\").join("/");
const frontmatter = (title: string, body: string) =>
	[
		"---",
		`title: ${title}`,
		"type: decision",
		"topic: decisions",
		"summary: smoke page",
		"updated: 2026-09-26",
		"claims:",
		"  - id: c1",
		'    text: "Smoke claim"',
		"    status: verified",
		"    support: 0.9",
		"    evidence: []",
		"---",
		"",
		body,
		"",
	].join("\n");

const ctx = { cwd: projectA, hasUI: false, signal: undefined };

try {
	for (const dir of [
		join(wikiA, "wiki", "decisions"),
		join(wikiA, "raw"),
		join(wikiB, "wiki", "decisions"),
		join(wikiB, "raw"),
		join(agentDir, "jev-wiki"),
	]) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(
		join(agentDir, "jev-wiki", "wikis.json"),
		`${JSON.stringify(
			{
				wikis: [
					{ name: "alpha", root: posix(wikiA), enabled: true, added: "2026-09-26T00:00:00.000Z" },
					{ name: "beta", root: posix(wikiB), enabled: true, added: "2026-09-26T00:00:00.000Z" },
				],
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(join(wikiB, "wiki", "decisions", "smoke.md"), frontmatter("Target smoke", "# Target smoke"));
	await writeFile(join(wikiA, "wiki", "decisions", "decoy.md"), frontmatter("Session decoy", "# Session decoy"));

	const finalize = tools.get("wiki_finalize");
	const review = tools.get("wiki_review");
	const remove = tools.get("wiki_remove");
	assert.ok(finalize, "wiki_finalize is registered");
	assert.ok(review && remove, "wiki_review and wiki_remove are registered");
	const run = (params: Record<string, unknown>) => finalize!.execute("test", params, undefined, undefined, ctx);
	const runReview = (params: Record<string, unknown>) => review!.execute("test", params, undefined, undefined, ctx);
	const runRemove = (params: Record<string, unknown>) => remove!.execute("test", params, undefined, undefined, ctx);

	await check("cross-wiki finalize writes only the target wiki", async () => {
		const result = await run({ pages: ["decisions/smoke.md"], note: "cross-wiki smoke", wiki: "beta" });
		assert.match(result.content[0].text, /Updated TOC for 1 page/);
		assert.ok(existsSync(join(wikiB, "wiki", "index.md")), "target TOC written");
		assert.ok(existsSync(join(wikiB, ".jev-wiki", "decisions.jsonl")), "target ledger written");
		assert.match(await readFile(join(wikiB, "wiki", "log.md"), "utf8"), /cross-wiki smoke/);
		assert.ok(!existsSync(join(wikiA, "wiki", "index.md")), "session wiki untouched");
		assert.ok(!existsSync(join(wikiA, ".jev-wiki", "decisions.jsonl")), "session ledger untouched");
	});

	await check("cross-wiki finalize does not fall back to a session-wiki file", async () => {
		const result = await run({ pages: ["decisions/decoy.md"], wiki: "beta" });
		assert.match(result.content[0].text, /decoy\.md \(missing\)/);
		assert.ok(!existsSync(join(wikiA, "wiki", "index.md")), "session wiki still untouched");
	});

	await check("default finalize still targets the session wiki", async () => {
		const result = await run({ pages: ["decisions/decoy.md"], note: "session smoke" });
		assert.match(result.content[0].text, /Updated TOC for 1 page/);
		assert.ok(existsSync(join(wikiA, "wiki", "index.md")), "session TOC written");
		assert.ok(existsSync(join(wikiA, ".jev-wiki", "decisions.jsonl")), "session ledger written");
	});

	await check("unknown target lists the registered wikis", async () => {
		await assert.rejects(() => run({ pages: ["decisions/decoy.md"], wiki: "nope" }), /alpha, beta/);
	});

	await check("review listing honors the target wiki", async () => {
		await enqueueReview(resolveLayout(wikiB, ".", ".jev-wiki"), {
			kind: "claim_review",
			claimText: "beta-only item",
			criticality: 0.3,
			reason: "integration",
		});
		await enqueueReview(resolveLayout(wikiA, "docs/wiki", ".jev-wiki"), {
			kind: "claim_review",
			claimText: "alpha-only item",
			criticality: 0.3,
			reason: "integration",
		});
		const result = await runReview({ action: "list", wiki: "beta" });
		assert.match(result.content[0].text, /beta-only item/);
		assert.doesNotMatch(result.content[0].text, /alpha-only item/, "session wiki queue must not leak into the target listing");
	});

	await check("cross-wiki remove deletes only the target page", async () => {
		await writeFile(join(wikiB, "wiki", "decisions", "gone.md"), frontmatter("Gone", "# Gone"));
		await writeFile(join(wikiA, "wiki", "decisions", "gone.md"), frontmatter("Decoy", "# Decoy"));
		const result = await runRemove({ pages: ["decisions/gone.md"], reason: "integration", wiki: "beta" });
		assert.match(result.content[0].text, /Removed 1 page/);
		assert.ok(!existsSync(join(wikiB, "wiki", "decisions", "gone.md")), "target page removed");
		assert.ok(existsSync(join(wikiA, "wiki", "decisions", "gone.md")), "session decoy survives");
	});
} finally {
	await rm(root, { recursive: true, force: true });
	delete process.env.PI_CODING_AGENT_DIR;
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nAll integration tests passed.");
