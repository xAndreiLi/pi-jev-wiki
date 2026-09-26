/**
 * Offline unit tests with a fake Jev client. No network, no API key, no model calls.
 * Run: npm run test:unit
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JevAnswer, JevClient, JevQuestion } from "../src/jev.ts";
import { decideClaim, chooseTarget, suggestTopic, type ClaimVerdicts } from "../src/pipeline/adjudicate.ts";
import { resolveWriterMode } from "../src/pipeline/write.ts";
import { checkLiterals } from "../src/grounding.ts";
import { redact } from "../src/redact.ts";
import { applyReviewResolution, enqueueReview, listOpenReviews, resolveReview } from "../src/review.ts";
import { fileMatches } from "../src/git.ts";
import type { LedgerEntry } from "../src/ledger.ts";
import { buildTriageReport, remedyFor } from "../src/triage.ts";
import { DEFAULT_CONFIG, resolveCaptureTriggers, type ResolvedConfig } from "../src/config.ts";
import { ensureLayout, resolveLayout, slugify, writePage } from "../src/wiki/layout.ts";
import { updateIndex } from "../src/wiki/toc.ts";
import { parseFrontmatter, serializeFrontmatter } from "../src/wiki/frontmatter.ts";
import { isLocked, withWikiLock } from "../src/wiki/lock.ts";

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

const config: ResolvedConfig = { ...DEFAULT_CONFIG, baseUrl: "http://fake", model: "fake" };

function fakeClient(handler: (state: Record<string, unknown>, questions: Record<string, JevQuestion>) => Record<string, JevAnswer>): JevClient {
	return {
		async systemOne(state: unknown, questions: Record<string, JevQuestion>) {
			return { model: "fake", answers: handler((state ?? {}) as Record<string, unknown>, questions), usage: { input_tokens: 1, output_tokens: 1 } };
		},
		totals: { input_tokens: 0, output_tokens: 0, cost: 0 },
	} as unknown as JevClient;
}

const baseVerdicts: ClaimVerdicts = {
	grounded: 0.95,
	derivable: 0.2,
	durable: 0.9,
	sensitive: 0.01,
	kind: "architecture",
	kindConfidence: 0.9,
	importance: 2.5,
	importanceNorm: 0.83,
	importanceConfidence: 0.8,
	criticality: 1,
	criticalityNorm: 0.33,
	criticalityConfidence: 0.8,
	alreadyKnown: 0.1,
	newPage: true,
};

console.log("policy (decideClaim)");
await check("files a grounded, non-derivable claim", () => {
	assert.equal(decideClaim(baseVerdicts, config).action, "file");
});
await check("rejects sensitive content", () => {
	assert.equal(decideClaim({ ...baseVerdicts, sensitive: 0.95 }, config).action, "reject_sensitive");
});
await check("rejects derivable implementation detail", () => {
	assert.equal(
		decideClaim({ ...baseVerdicts, derivable: 0.8, kind: "fact", importanceNorm: 0.3 }, config).action,
		"reject_derivable",
	);
});
await check("rejects duplicates", () => {
	assert.equal(decideClaim({ ...baseVerdicts, alreadyKnown: 0.95 }, config).action, "reject_duplicate");
});
await check("reinforces when relation extends", () => {
	assert.equal(decideClaim({ ...baseVerdicts, relation: "extends" }, config).action, "reinforce");
});
await check("queues below auto-accept", () => {
	assert.equal(decideClaim({ ...baseVerdicts, grounded: 0.74 }, config).action, "review");
});
await check("auto-accepts user-stated claims near the threshold", () => {
	assert.equal(
		decideClaim({ ...baseVerdicts, grounded: 0.74, trustTier: "user_stated" }, config).action,
		"file_user_stated",
	);
});
await check("still queues user-stated claims when auto-accept is disabled", () => {
	const strict = { ...config, review: { ...config.review, autoAcceptUserStated: false } };
	assert.equal(decideClaim({ ...baseVerdicts, grounded: 0.74, trustTier: "user_stated" }, strict).action, "review");
});
await check("slugify truncates at a word boundary", () => {
	const slug = slugify("personal profile update location projects body goals and working preferences", 60);
	assert.ok(slug.length <= 60, `length ${slug.length}`);
	assert.ok(!slug.endsWith("-wor"), `ends mid-word: ${slug}`);
	assert.ok(!slug.endsWith("-"), `trailing hyphen: ${slug}`);
});
await check("suggestTopic maps new topics to concrete kind-based names", () => {
	assert.equal(suggestTopic("gotcha"), "gotchas");
	assert.equal(suggestTopic("unknown-kind"), "notes");
});
await check("files user-stated decisions with the lower trust tier", () => {
	assert.equal(decideClaim({ ...baseVerdicts, grounded: 0.4, trustTier: "user_stated" }, config).action, "file_user_stated");
});
await check("files repo-verified claims that lack a quoted passage", () => {
	assert.equal(decideClaim({ ...baseVerdicts, grounded: 0.4, trustTier: "verified_in_repo" }, config).action, "file");
});
await check("rejects ungrounded claims with no trust tier", () => {
	assert.equal(decideClaim({ ...baseVerdicts, grounded: 0.2 }, config).action, "reject_unsupported");
});
await check("queues high-importance framing that is derivable instead of dropping it", () => {
	const decision = decideClaim(
		{ ...baseVerdicts, derivable: 0.62, grounded: 0.8, kind: "architecture", importanceNorm: 0.7 },
		config,
	);
	assert.equal(decision.action, "review");
	assert.match(decision.reasons.join(" "), /framing/);
});
await check("still rejects low-importance derivable claims", () => {
	assert.equal(
		decideClaim({ ...baseVerdicts, derivable: 0.62, kind: "fact", importanceNorm: 0.3 }, config).action,
		"reject_derivable",
	);
});

console.log("\nplacement tournament (chooseTarget)");
await check("single shard winner advances without a final call", async () => {
	const candidates = Array.from({ length: 600 }, (_, index) => ({
		path: `synthetic/module-${index + 1}.md`,
		title: `Module ${index + 1}`,
		type: "architecture/module",
		summary: "x",
		tags: [],
	}));
	const client = fakeClient((state) => {
		if ("final" in (state as Record<string, unknown>) || !Array.isArray((state as { candidate_pages?: unknown[] }).candidate_pages)) {
			return {
				final: { type: "choice", choice: "synthetic/module-437.md", confidence: 0.9, probabilities: {} },
				fit: { type: "noul", noul: 0.9 },
			} as Record<string, JevAnswer>;
		}
		const pages = (state as { candidate_pages: Array<{ path: string }> }).candidate_pages;
		const winner = pages.find((page) => page.path === "synthetic/module-437.md");
		return winner
			? ({
					best: { type: "choice", choice: winner.path, confidence: 0.9, probabilities: {} },
					any_fit: { type: "noul", noul: 0.9 },
				} as Record<string, JevAnswer>)
			: ({
					best: { type: "choice", choice: "add_new_page", confidence: 0.8, probabilities: {} },
					any_fit: { type: "noul", noul: 0.2 },
				} as Record<string, JevAnswer>);
	});
	const result = await chooseTarget(client, { text: "The retry budget invariant", kind: "invariant" }, candidates, config);
	assert.equal(result.verdicts.target, "synthetic/module-437.md");
	assert.equal(result.requests, 3);
});
await check("multiple shard winners meet in a final call", async () => {
	const candidates = Array.from({ length: 600 }, (_, index) => ({
		path: `synthetic/module-${index + 1}.md`,
		title: `Module ${index + 1}`,
		type: "architecture/module",
		summary: "x",
		tags: [],
	}));
	const client = fakeClient((state) => {
		const pages = (state as { candidate_pages?: Array<{ path: string }> }).candidate_pages ?? [];
		const isFinal = !("any_fit" in (state as Record<string, unknown>)) && pages.length <= 3;
		if (isFinal) {
			return {
				final: { type: "choice", choice: pages[0].path, confidence: 0.8, probabilities: {} },
				fit: { type: "noul", noul: 0.9 },
			} as Record<string, JevAnswer>;
		}
		return {
			best: { type: "choice", choice: pages[0].path, confidence: 0.9, probabilities: {} },
			any_fit: { type: "noul", noul: 0.9 },
		} as Record<string, JevAnswer>;
	});
	const result = await chooseTarget(client, { text: "Anything", kind: "fact" }, candidates, config);
	assert.equal(result.requests, 4);
	assert.equal(result.verdicts.target, "synthetic/module-1.md");
});
await check("all shards choosing add_new_page creates a page", async () => {
	const candidates = Array.from({ length: 300 }, (_, index) => ({
		path: `synthetic/module-${index + 1}.md`,
		title: `Module ${index + 1}`,
		type: "architecture/module",
		summary: "x",
		tags: [],
	}));
	const client = fakeClient(
		() =>
			({
				best: { type: "choice", choice: "add_new_page", confidence: 0.9, probabilities: {} },
				any_fit: { type: "noul", noul: 0.05 },
			}) as Record<string, JevAnswer>,
	);
	const result = await chooseTarget(client, { text: "New knowledge", kind: "fact" }, candidates, config);
	assert.equal(result.verdicts.newPage, true);
});

console.log("\nwriter mode");
await check("downgrades auto at the escalation threshold", () => {
	const high = [{ text: "x", files: [], evidence: [], grounded: 0.9, criticality: 0.9 }];
	assert.equal(resolveWriterMode("auto", high, config), "draft");
	assert.equal(resolveWriterMode("draft", high, config), "guided");
});
await check("keeps auto for low criticality", () => {
	const low = [{ text: "x", files: [], evidence: [], grounded: 0.9, criticality: 0.2 }];
	assert.equal(resolveWriterMode("auto", low, config), "auto");
});

console.log("\nlock and review queue");
const root = await mkdtemp(join(tmpdir(), "jev-wiki-unit-"));
try {
	const layout = resolveLayout(root, "wiki", ".state");
	await ensureLayout(layout);

	await check("nested acquisition times out while held", async () => {
		await withWikiLock(layout, async () => {
			await assert.rejects(
				() => withWikiLock(layout, async () => 1, { timeoutMs: 300, staleMs: 60_000 }),
				/locked by another pi session/,
			);
		});
		assert.equal((await isLocked(layout)).locked, false);
	});
	await check("takes over a stale lock", async () => {
		await writeFile(join(layout.stateDir, "lock"), JSON.stringify({ pid: 1, ts: Date.now() - 120_000 }));
		const value = await withWikiLock(layout, async () => 42, { staleMs: 30_000 });
		assert.equal(value, 42);
	});
	await check("enqueue dedupes and resolve applies to frontmatter", async () => {
		const pagePath = join(layout.wikiDir, "decisions", "test-page.md");
		await writePage(
			pagePath,
			{
				title: "Test page",
				type: "decision",
				topic: "decisions",
				summary: "s",
				updated: "2026-01-01",
				claims: [{ id: "c1", text: "The retry budget is capped per tenant.", status: "needs_recheck", support: 0.5, evidence: [] }],
			},
			"# Test page",
		);
		const item = await enqueueReview(layout, { kind: "needs_recheck", claimText: "The retry budget is capped per tenant.", page: "decisions/test-page.md", claimId: "c1", criticality: 0.4 });
		assert.ok(item);
		assert.equal(await enqueueReview(layout, { kind: "needs_recheck", claimText: "The retry budget is capped per tenant.", page: "decisions/test-page.md", claimId: "c1", criticality: 0.4 }), undefined);
		const open = await listOpenReviews(layout);
		assert.equal(open.length, 1);
		const applied = await applyReviewResolution(layout, open[0], "accept");
		assert.match(applied, /accept applied/);
		await resolveReview(layout, open[0].id, "accept", "test");
		assert.equal((await listOpenReviews(layout)).length, 0);
		const page = parseFrontmatter(await readFile(pagePath, "utf8"));
		const claims = page.data.claims as Array<Record<string, unknown>>;
		assert.equal(claims[0].status, "verified");
		assert.ok(Number(claims[0].support) >= 0.8);
	});
} finally {
	await rm(root, { recursive: true, force: true });
}

console.log("\ntoc shards");
{
	const shardRoot = await mkdtemp(join(tmpdir(), "jev-wiki-toc-"));
	try {
		const shardLayout = resolveLayout(shardRoot, "wiki", ".state");
		await ensureLayout(shardLayout);
		const entries = [
			{ path: "pi/one.md", title: "One", type: "gotcha", tags: [], summary: "s", updated: "2026-01-01" },
			{ path: "pi/two.md", title: "Two", type: "gotcha", tags: [], summary: "s", updated: "2026-01-01" },
		];
		await check("prunes topic shards whose last page was removed", async () => {
			const shardPath = join(shardLayout.wikiDir, "toc", "pi.md");
			await updateIndex(shardLayout, () => entries);
			assert.ok(existsSync(shardPath));
			await updateIndex(shardLayout, () => entries.slice(1));
			assert.ok(existsSync(shardPath), "shard stays while the topic still has a page");
			await updateIndex(shardLayout, () => []);
			assert.ok(!existsSync(shardPath), "shard is pruned when the topic empties");
		});
	} finally {
		await rm(shardRoot, { recursive: true, force: true });
	}
}

console.log("\ntriage report");
await check("classifies rejections, computes stats, and remedies", async () => {
	const ledger = [
		{ ts: "2026-01-01T00:00:00Z", actor: "jev", op: "insight.adjudicate", subject: "accepted claim", action: "file", verdict: { derivable: 0.3, grounded: 0.9, importanceNorm: 0.8 } },
		{ ts: "2026-01-02T00:00:00Z", actor: "jev", op: "insight.adjudicate", subject: "derivable claim", action: "reject_derivable", verdict: { derivable: 0.6, grounded: 0.8, kind: "fact", importanceNorm: 0.4 } },
		{ ts: "2026-01-03T00:00:00Z", actor: "jev", op: "insight.adjudicate", subject: "unsupported claim", action: "reject_unsupported", verdict: { grounded: 0.2, derivable: 0.3 } },
	] as LedgerEntry[];
	const report = buildTriageReport(ledger);
	assert.equal(report.rejections.length, 2);
	assert.equal(report.separated.acceptedDerivable?.max, 0.3);
	assert.equal(report.separated.rejectedDerivable?.min, 0.6);
	assert.equal(report.counts.reject_unsupported, 1);
	assert.match(remedyFor(report.rejections.find((entry) => entry.action === "reject_unsupported")!), /Ground it/);
	assert.match(
		remedyFor({ ts: "", claim: "", action: "reject_derivable", reason: "", kind: "architecture", importance: 0.8 }),
		/framing/i,
	);
});

console.log("\nredaction, literals, paths, frontmatter");
await check("redacts tokens and emails, keeps normal text", () => {
	const { text, findings } = redact("contact ops@example.com key sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789");
	assert.ok(findings.some((finding) => finding.type === "email"));
	assert.ok(findings.some((finding) => finding.type === "openrouter_key"));
	assert.ok(text.includes("contact"));
});
await check("literal check ignores years and single digits", () => {
	const { missing } = checkLiterals("In 2026 the budget was 500; 7 retries.", "budget 500");
	assert.deepEqual(missing, []);
});
await check("file matching handles exact, directory, and glob", () => {
	assert.ok(fileMatches("src/a.ts", "src/a.ts"));
	assert.ok(fileMatches("src/wiki/search.ts", "src/wiki"));
	assert.ok(fileMatches("src/wiki/search.ts", "src/wiki/*.ts"));
	assert.ok(!fileMatches("src/wiki/search.ts", "src/other"));
});
await check("frontmatter round-trips nested claim lists", () => {
	const data = { title: "T", claims: [{ id: "c1", text: "x", status: "verified", evidence: ["a", "b"] }] };
	const parsed = parseFrontmatter(serializeFrontmatter(data, "body"));
	assert.deepEqual(parsed.data, data);
});

console.log("capture cadence");
await check("cadence resolves task, commit, and manual triggers", () => {
	const base = { ...DEFAULT_CONFIG } as ResolvedConfig;
	assert.deepEqual(resolveCaptureTriggers({ ...base, capture: { cadence: "task", onCompact: false } }), { task: true, commit: false, compact: false });
	assert.deepEqual(resolveCaptureTriggers({ ...base, capture: { cadence: "commit", onCompact: true } }), { task: false, commit: true, compact: true });
	assert.deepEqual(resolveCaptureTriggers({ ...base, capture: { cadence: "manual", onCompact: false } }), { task: false, commit: false, compact: false });
	assert.deepEqual(resolveCaptureTriggers({ ...base, capture: { cadence: "manual", onCompact: false, onSettle: true } }), { task: true, commit: false, compact: false });
});

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nAll unit tests passed.");
