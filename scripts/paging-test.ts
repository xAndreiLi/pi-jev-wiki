/**
 * Paged-choice tournament test: 600 synthetic candidate pages with a distinctive
 * target at position 437, shardSize 250 (3 shards + final tournament).
 * Run: npm run test:paging
 */
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { createJevClient } from "../src/jev.ts";
import { chooseTarget, type CandidatePage } from "../src/pipeline/adjudicate.ts";

const loaded = loadConfig(process.cwd());
if (!loaded.apiKey) {
	console.error("No JEV_TOKEN found; skipping paging test.");
	process.exit(1);
}

const candidates: CandidatePage[] = Array.from({ length: 600 }, (_, index) => {
	const n = index + 1;
	const isTarget = n === 437;
	return {
		path: `synthetic/module-${n}.md`,
		title: `Module ${n}`,
		type: "architecture/module",
		summary: isTarget
			? "Owns the billing retry queue and all retry semantics for failed charges"
			: `Synthetic module ${n} handling unrelated subsystem ${n}`,
		tags: [isTarget ? "billing-retry" : `subsystem-${n}`],
	};
});

const client = createJevClient(loaded.config, loaded.apiKey);
const started = Date.now();
const result = await chooseTarget(
	client,
	{
		text: "The billing retry queue must be consulted before changing retry semantics for failed charges.",
		kind: "invariant",
	},
	candidates,
	{ ...loaded.config, routing: { ...loaded.config.routing, shardSize: 250 } },
	{ evidenceText: "Billing retries are owned by one module; changes to retry semantics must go through it." },
);
const elapsed = Date.now() - started;

console.log("candidates:", candidates.length);
console.log("requests:", result.requests, "(expected >= 3 shard calls; +1 final when multiple shards fit)");
console.log("target:", result.verdicts.target ?? "(new page)");
console.log("confidence:", result.verdicts.targetConfidence?.toFixed(2) ?? "-");
console.log("anyFit:", result.verdicts.anyFit?.toFixed(2) ?? "-");
console.log("usage:", result.usage.input_tokens, "in /", result.usage.output_tokens, "out");
console.log("elapsed:", `${elapsed}ms`);

assert.ok(result.requests >= 3, "expected sharded routing (>= 3 shard calls)");
assert.ok(result.usage.input_tokens > 0, "expected Jev usage");
assert.equal(result.verdicts.target, "synthetic/module-437.md", "distinctive target should win the tournament");
console.log("\nPaging test passed.");
