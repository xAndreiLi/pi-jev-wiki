#!/usr/bin/env node
/**
 * Paired report over a run's results.
 *
 * The pilot's job is not to prove an effect — it is to measure the paired variance, which decides how
 * many tasks the real experiment needs. This report says both, for every arm against the control.
 *
 * Only rows that measure what they claim are counted. Invalid rows (the arm ran in the wrong
 * environment) and contaminated rows (the agent reached the harness, the source repository or a
 * grader) are listed and left out — R1 reported a run with no wiki tools as its wiki-nocapture result.
 * Costs are compared as per-task log ratios: tasks differ several-fold in size, and an absolute delta
 * lets the largest task decide the answer.
 *
 * Usage: node eval/report.mjs --run <id> [--runs-dir eval/runs] [--json]
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { bootstrapMedianCi, isValidRow, mean, median, parseArgs, readJsonl, sd, wilcoxonSignedRank } from "./lib.mjs";

/** Pre-registered contrasts, in order of importance. The first is the headline. */
const CONTRASTS = [
	["wiki", "off", "the package as installed"],
	["wiki-nocapture", "off", "a read-only wiki: retrieval without upkeep"],
	["brief", "off", "the wiki's index alone, no retrieval"],
	["wiki", "wiki-nocapture", "what upkeep adds"],
];

const usd = (value) => (value === null || value === undefined ? "—" : value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(3)}`);
const pct = (value) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`);
const fmt = (value, digits = 3) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits));
const pass = (row) => (row?.grading?.passed === null || row?.grading?.passed === undefined ? "n/a" : row.grading.passed ? "pass" : "fail");

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

	// The latest row per run key: a re-run after --resume replaces the attempt it repeated.
	const latest = new Map();
	for (const row of await readJsonl(resultsPath)) latest.set(`${row.task}|${row.arm}|${row.repeat}`, row);
	const rows = [...latest.values()];

	const integrity = [];
	const counted = [];
	for (const row of rows) {
		const where = `${row.task} · ${row.arm} · rep${row.repeat}`;
		if (!isValidRow(row)) integrity.push(`${where}: **invalid, left out** — ${(row.invalidReasons ?? []).join("; ") || `expected wiki tools ${row.armVerified?.expectedWikiTools}, observed ${row.armVerified?.observedWikiTools}`}`);
		else if (row.contamination?.clean === false) integrity.push(`${where}: **contaminated, left out** — ${row.contamination.reasons.join("; ")}`);
		else if (typeof row.metrics?.cost !== "number") integrity.push(`${where}: **no cost measured, left out** — ${row.metrics?.error ?? "missing"}`);
		else counted.push(row);
		if (row.timedOut) integrity.push(`${where}: the agent timed out (its cost is truncated)`);
		if (row.grading?.passed === null || row.grading?.passed === undefined) integrity.push(`${where}: not graded`);
		if (!row.contamination) integrity.push(`${where}: predates the contamination scan — treat as unverified`);
	}
	const arms = [...new Set(counted.map((row) => row.arm))];
	const byKey = new Map();
	for (const row of counted) {
		const key = `${row.task}#${row.repeat}`;
		if (!byKey.has(key)) byKey.set(key, { task: row.task, repeat: row.repeat });
		byKey.get(key)[row.arm] = row;
	}

	const lines = [`# Paired run report — ${runId}`, ""];
	lines.push(`${rows.length} run(s), ${counted.length} counted. Arms: ${arms.join(", ") || "none"}. Model: ${rows.find((row) => row.model)?.model ?? "not pinned"}. User context: ${rows.find((row) => row.agent)?.agent?.userContext ?? "unrecorded (before isolation)"}.`, "");
	lines.push("## Integrity", "");
	if (integrity.length === 0) lines.push("No problems: every run was valid, clean, measured and graded.");
	else for (const note of integrity) lines.push(`- ${note}`);
	lines.push("");

	lines.push("## Per task", "");
	lines.push(`| Task | Rep | ${arms.map((arm) => `${arm} $ · pass`).join(" | ")} | Jev in-tokens (wiki arms) |`);
	lines.push(`|---|---|${arms.map(() => "---").join("|")}|---|`);
	for (const entry of byKey.values()) {
		const jev = arms.filter((arm) => arm.startsWith("wiki") && entry[arm]).map((arm) => `${arm} ${entry[arm].jev?.inputTokens ?? "?"}`);
		lines.push(`| ${entry.task} | ${entry.repeat} | ${arms.map((arm) => (entry[arm] ? `${usd(entry[arm].metrics.cost)} · ${pass(entry[arm])}` : "—")).join(" | ")} | ${jev.join(", ") || "—"} |`);
	}
	lines.push("");

	const results = [];
	for (const [treated, control, meaning] of CONTRASTS) {
		if (!arms.includes(treated) || !arms.includes(control)) continue;
		const pairs = [...byKey.values()].filter((entry) => entry[treated] && entry[control] && entry[treated].metrics.cost > 0 && entry[control].metrics.cost > 0);
		if (pairs.length === 0) continue;
		const logRatios = pairs.map((entry) => Math.log(entry[treated].metrics.cost / entry[control].metrics.cost));
		const test = wilcoxonSignedRank(logRatios);
		const ci = bootstrapMedianCi(logRatios);
		const spread = sd(logRatios);
		const both = pairs.filter((entry) => typeof entry[treated].grading?.passed === "boolean" && typeof entry[control].grading?.passed === "boolean");
		const onlyTreated = both.filter((entry) => entry[treated].grading.passed && !entry[control].grading.passed).length;
		const onlyControl = both.filter((entry) => !entry[treated].grading.passed && entry[control].grading.passed).length;
		results.push({ treated, control, pairs: pairs.length, logRatios, test, spread });
		lines.push(`## ${treated} vs ${control} — ${meaning}`, "");
		lines.push(`- Median cost ratio: **${pct(Math.exp(median(logRatios)) - 1)}** · 95% bootstrap CI ${pct(ci.low === null ? null : Math.exp(ci.low) - 1)} … ${pct(ci.high === null ? null : Math.exp(ci.high) - 1)} · geometric mean ${pct(Math.exp(mean(logRatios)) - 1)}`);
		lines.push(`- Wilcoxon signed-rank on log ratios: n=${test.n}, p=${fmt(test.p)} (${test.method})`);
		lines.push(`- Success: ${treated} ${pairs.filter((entry) => entry[treated].grading?.passed).length}/${pairs.length}, ${control} ${pairs.filter((entry) => entry[control].grading?.passed).length}/${pairs.length}; discordant pairs ${onlyTreated} (only ${treated} passed) vs ${onlyControl} (only ${control} passed)`);
		// Mean over the rows that measured it: a row from before Jev and upkeep accounting is unknown, not zero.
		const measured = (pick) => mean(pairs.map((entry) => pick(entry[treated])).filter((value) => typeof value === "number"));
		const upkeep = measured((row) => row.upkeep?.cost);
		if (treated.startsWith("wiki")) lines.push(`- ${treated}: mean upkeep turns ${usd(upkeep)} (lower bound) · mean Jev calls ${fmt(measured((row) => row.jev?.calls), 1)} · mean wiki reads/writes ${fmt(mean(pairs.map((entry) => entry[treated].metrics.wikiReads ?? 0)), 1)} / ${fmt(mean(pairs.map((entry) => entry[treated].metrics.wikiWrites ?? 0)), 1)}`);
		if (spread) {
			const needed = (effect) => Math.ceil((8 * spread ** 2) / Math.log(1 + effect) ** 2);
			lines.push(`- Paired SD of the log ratio: **${fmt(spread, 3)}** → pairs needed for 80% power at α=0.05: 10% ${needed(0.1)} · 20% ${needed(0.2)} · 30% ${needed(0.3)} · 50% ${needed(0.5)}`);
		}
		lines.push("");
	}
	if (results.length === 0) lines.push("No contrast has a complete pair yet — both arms of a task must be counted before a pairing exists.", "");
	lines.push("Success is a guardrail, not the headline: an arm that is cheaper but fails more is not a win. With one repeat per arm there is no noise floor yet — run the same arm twice before reading any difference as an effect.", "");

	const judgementsPath = join(runsDir, runId, "judgements.jsonl");
	if (existsSync(judgementsPath)) {
		const judged = await readJsonl(judgementsPath);
		const rubricHash = judged.at(-1)?.rubricHash;
		const current = judged.filter((entry) => entry.rubricHash === rubricHash && counted.some((row) => row.task === entry.task && row.arm === entry.arm));
		if (current.length > 0) {
			lines.push(`## Quality (blind judge, rubric ${rubricHash})`, "");
			lines.push("| Arm | Judgements | Mean total /18 | Mean within-task range |", "|---|---|---|---|");
			for (const arm of arms) {
				const mine = current.filter((entry) => entry.arm === arm);
				if (mine.length === 0) continue;
				const ranges = [...new Set(mine.map((entry) => entry.task))].map((task) => {
					const totals = mine.filter((entry) => entry.task === task).map((entry) => entry.total);
					return Math.max(...totals) - Math.min(...totals);
				});
				lines.push(`| ${arm} | ${mine.length} | ${fmt(mean(mine.map((entry) => entry.total)), 1)} | ${fmt(mean(ranges), 1)} |`);
			}
			lines.push("", "The within-task range is the judge's own noise across samples; a difference between arms smaller than it is not a difference.", "");
		}
	}

	if (args.json) console.log(JSON.stringify({ runId, counted: counted.length, integrity, contrasts: results }, null, "\t"));
	else console.log(lines.join("\n"));
}

main().catch((error) => {
	console.error(`report failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
