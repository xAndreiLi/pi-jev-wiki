#!/usr/bin/env node
/**
 * Paired report over a run's results.
 *
 * The pilot's job is not to prove an effect — it is to measure the paired variance, which decides
 * how many tasks the real experiment needs. This report says both: what the pairs showed, and what
 * they imply about the smallest effect that could be detected next time.
 *
 * Usage: node eval/report.mjs --run <id> [--runs-dir eval/runs] [--json]
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootstrapMedianCi, mean, median, parseArgs, readJsonl, sd, wilcoxonSignedRank } from "./lib.mjs";

function usd(value) {
	if (value === null || value === undefined) return "—";
	return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(2)}`;
}

function pct(value) {
	return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function fmt(value, digits = 3) {
	return value === null || value === undefined ? "—" : value.toFixed(digits);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const runsDir = resolve(args["runs-dir"] ?? "eval/runs");
	let runId = args.run;
	if (!runId || args.run === true) {
		const runs = (await readdir(runsDir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
		if (runs.length === 0) throw new Error(`no runs in ${runsDir}`);
		runId = runs[runs.length - 1];
		console.log(`(using the most recent run: ${runId})\n`);
	}
	const resultsPath = join(runsDir, runId, "results.jsonl");
	if (!existsSync(resultsPath)) throw new Error(`no results at ${resultsPath}`);
	const rows = await readJsonl(resultsPath);

	// Integrity: an arm that did not have the tools it should have had measures nothing.
	const integrity = [];
	for (const row of rows) {
		if (row.armVerified && row.armVerified.expectedWikiTools !== row.armVerified.observedWikiTools) {
			integrity.push(`${row.task} · ${row.arm} · rep${row.repeat}: expected wiki tools ${row.armVerified.expectedWikiTools}, observed ${row.armVerified.observedWikiTools} (${row.armVerified.tools} tool(s) loaded)`);
		}
		if (row.leakCheck?.targetReachable) integrity.push(`${row.task} · ${row.arm} · rep${row.repeat}: the target commit was reachable inside the task copy`);
		if (row.timedOut) integrity.push(`${row.task} · ${row.arm} · rep${row.repeat}: the agent timed out`);
		if (row.grading?.passed === null || row.grading?.passed === undefined) integrity.push(`${row.task} · ${row.arm} · rep${row.repeat}: not graded (no testCommand)`);
	}

	const byKey = new Map();
	for (const row of rows) {
		const key = `${row.task}#${row.repeat}`;
		if (!byKey.has(key)) byKey.set(key, { task: row.task, repeat: row.repeat });
		byKey.get(key)[row.arm] = row;
	}
	const pairs = [...byKey.values()].filter((entry) => entry.off && entry.wiki);

	const lines = [];
	lines.push(`# Paired run report — ${runId}`);
	lines.push("");
	lines.push(`${rows.length} run(s), ${pairs.length} complete pair(s) with both arms. Model: ${rows.find((row) => row.model)?.model ?? "not pinned"}.`);
	lines.push("");

	lines.push("## Integrity");
	lines.push("");
	if (integrity.length === 0) lines.push("No problems: every arm loaded the tools it should have, no target commit was reachable, nothing timed out, every run was graded.");
	else for (const note of integrity) lines.push(`- ${note}`);
	lines.push("");

	if (pairs.length === 0) {
		lines.push("No complete pairs yet — both arms of a task must finish before a pairing exists.");
		console.log(lines.join("\n"));
		return;
	}

	lines.push("## Per task");
	lines.push("");
	lines.push("| Task | Rep | $ off | $ wiki | Δ$ | off pass | wiki pass | Explore off/wiki | Wiki reads |");
	lines.push("|---|---|---|---|---|---|---|---|---|");
	for (const pair of pairs) {
		const delta = (pair.wiki.metrics?.cost ?? 0) - (pair.off.metrics?.cost ?? 0);
		lines.push(
			`| ${pair.task} | ${pair.repeat} | ${usd(pair.off.metrics?.cost)} | ${usd(pair.wiki.metrics?.cost)} | ${delta >= 0 ? "+" : ""}${usd(delta)} | ${pair.off.grading?.passed === null ? "n/a" : pair.off.grading?.passed ? "pass" : "fail"} | ${pair.wiki.grading?.passed === null ? "n/a" : pair.wiki.grading?.passed ? "pass" : "fail"} | ${pair.off.metrics?.byBucket?.explore ?? "—"} / ${pair.wiki.metrics?.byBucket?.explore ?? "—"} | ${pair.wiki.metrics?.wikiReads ?? "—"} |`,
		);
	}
	lines.push("");

	const costDeltas = pairs.map((pair) => (pair.wiki.metrics?.cost ?? 0) - (pair.off.metrics?.cost ?? 0));
	const exploreDeltas = pairs.map((pair) => (pair.wiki.metrics?.byBucket?.explore ?? 0) - (pair.off.metrics?.byBucket?.explore ?? 0));
	const test = wilcoxonSignedRank(costDeltas);
	const ci = bootstrapMedianCi(costDeltas);
	const pairedSd = sd(costDeltas);
	const offCosts = pairs.map((pair) => pair.off.metrics?.cost ?? 0);
	const offMean = mean(offCosts);

	lines.push("## Paired result on cost");
	lines.push("");
	lines.push(`- Median Δcost (wiki − off): **${usd(median(costDeltas))}** · 95% bootstrap CI ${usd(ci.low)} … ${usd(ci.high)}`);
	lines.push(`- Mean Δcost: ${usd(mean(costDeltas))} on a mean off-arm cost of ${usd(offMean)} (${pct(offMean ? (mean(costDeltas) ?? 0) / offMean : null)} change)`);
	lines.push(`- Wilcoxon signed-rank: n=${test.n}, statistic ${fmt(test.statistic, 1)}, p=${fmt(test.p)} (${test.method})`);
	lines.push(`- Median Δexplore calls: ${median(exploreDeltas)}`);
	lines.push("");
	lines.push(`**Paired SD of Δcost: ${usd(pairedSd)}** — ${offMean && pairedSd ? `${fmt(pairedSd / offMean, 2)}× the off-arm mean cost` : "n/a"}.`);
	lines.push("");

	if (pairedSd && offMean) {
		const pairsFor = (effect) => Math.ceil((8 * pairedSd ** 2) / (effect * offMean) ** 2);
		lines.push("What that implies for the next run (80% power, α=0.05, approximate):");
		lines.push("");
		lines.push("| Effect to detect | Task-instances (pairs) needed |");
		lines.push("|---|---|");
		for (const effect of [0.1, 0.2, 0.3, 0.5]) lines.push(`| ${pct(effect)} | ${pairsFor(effect)} |`);
		lines.push("");
		lines.push(`This pilot itself had ${pairs.length} pair(s), which detects about ${pct(Math.sqrt(8 / Math.max(pairs.length, 1)) * pairedSd / offMean)} if the effect is real.`);
		lines.push("");
	}

	const offPass = pairs.filter((pair) => pair.off.grading?.passed).length;
	const wikiPass = pairs.filter((pair) => pair.wiki.grading?.passed).length;
	lines.push("## Task success");
	lines.push("");
	lines.push(`- off arm: ${offPass} of ${pairs.length} passed`);
	lines.push(`- wiki arm: ${wikiPass} of ${pairs.length} passed`);
	lines.push("");
	lines.push("Success is a guardrail, not the headline: a wiki arm that is cheaper but fails more is not a win.");
	lines.push("");

	if (args.json) console.log(JSON.stringify({ runId, pairs, costDeltas, test, ci, pairedSd, offMean }, null, "\t"));
	else console.log(lines.join("\n"));
}

main().catch((error) => {
	console.error(`report failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
