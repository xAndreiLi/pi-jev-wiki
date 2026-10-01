#!/usr/bin/env node
/**
 * Quality review of what each arm actually wrote.
 *
 * The grader answers "did it pass". It cannot answer "was it any good": a diff can pass the tests while
 * ignoring the project's conventions, editing unrelated files, weakening the tests it was graded by, or
 * leaving dead code behind. This asks a separate model to score each arm's diff against a rubric.
 *
 * What makes the score mean anything — each one learned from R1, where none of it held:
 *
 *   - **Blind.** The judge sees code-only diffs pasted into its prompt under arbitrary labels. No file
 *     names (R1's patch paths contained the arm), no tooling artefacts (only wiki arms have wiki pages),
 *     no tools and no working directory to explore (R1's judge read results.jsonl), and no test results
 *     to anchor on (objective signals are reported separately).
 *   - **Repeated.** Several samples per task, each with its own label order, so position bias averages
 *     out and the spread between samples is visible next to the mean. R1 saw one unchanged diff score
 *     13 and then 15.
 *   - **Per task.** Arms are compared on the same task, the only comparison that holds the task constant.
 *     Invalid and contaminated runs are left out: their diffs are not comparable.
 *
 * Usage:
 *   node eval/judge.mjs --run <run-id> --model <id> [--samples 3] [--runs-dir eval/runs] [--tasks <ids>]
 *                       [--rubric eval/rubrics/code-quality.md] [--pi-bin <path>] [--force] [--dry-run]
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blindOrder, codeOnlyPatch, prepareAgentDir } from "./arms.mjs";
import { appendJsonl, isValidRow, nowIso, parseArgs, readJsonl, resolvePiCommand, spawnCapture } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
/** Enough for any real diff; a runaway one is cut so it cannot crowd the others out of the prompt. */
const MAX_DIFF_CHARS = 60_000;

function extractJson(text) {
	const start = text.indexOf("{");
	if (start < 0) return undefined;
	let depth = 0;
	for (let index = start; index < text.length; index += 1) {
		if (text[index] === "{") depth += 1;
		else if (text[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				try {
					return JSON.parse(text.slice(start, index + 1));
				} catch {
					return undefined;
				}
			}
		}
	}
	return undefined;
}

/** The judge's whole input. Nothing in it may name an arm: the self-test reads it as the judge receives it. */
function judgePrompt({ taskPrompt, diffs, rubric }) {
	const labels = diffs.map((diff) => diff.label);
	const count = labels.length;
	return [
		`You are reviewing ${count} competing implementations of the same task, written by ${count} different`,
		"agent configurations. Read the task, then every diff below, then judge them.",
		"",
		"You do not know, and must not try to guess, which configuration produced which diff. The labels are",
		"arbitrary and do not correspond to any ordering. Each diff shows source changes only: files written by",
		"the agents' own tooling were removed before you saw them, and no test results are shown — judge the code.",
		"",
		"## The task, as the agent was given it",
		"",
		taskPrompt,
		"",
		"## The diffs",
		"",
		...diffs.flatMap((diff) => [`### Diff ${diff.label}`, "", diff.text.trim() ? `\`\`\`diff\n${diff.text.trimEnd()}\n\`\`\`` : "(no source changes)", ""]),
		"## Rubric",
		"",
		rubric,
		"",
		"## How to answer",
		"",
		"Return only a JSON object, no prose around it, in exactly this shape:",
		"",
		'{ "labels": [ { "label": "A", "scores": { "correctness": 0, "conventions": 0, "scope": 0, "edge_cases": 0, "clarity": 0, "restraint": 0 }, "verdict": "merge|merge_with_nits|rework", "notes": "one or two sentences", "test_changes_weaken_tests": false } ], "comparison": "one paragraph comparing them" }',
		"",
		`Score every label you were given (${labels.join(", ")}), using the rubric's 0-3 scale.`,
	].join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2), { lists: ["tasks"] });
	const runsDir = resolve(args["runs-dir"] ?? join(repoRoot, "eval", "runs"));
	if (!args.run || args.run === true || (!args.model && !args["dry-run"])) {
		console.log("Usage: node eval/judge.mjs --run <run-id> --model <id> [--samples 3] [--tasks <ids>] [--dry-run] [--rubric <path>]");
		return;
	}
	const runId = String(args.run);
	const runDir = join(runsDir, runId);
	const samples = Math.max(1, Number(args.samples ?? 3));
	// The latest row per run key, so a re-run replaces the attempt it repeated.
	const latest = new Map();
	for (const row of await readJsonl(join(runDir, "results.jsonl"))) latest.set(`${row.task}|${row.arm}|${row.repeat}`, row);
	const rows = [...latest.values()];
	if (rows.length === 0) throw new Error(`no results in ${runDir}`);

	const rubricPath = resolve(typeof args.rubric === "string" ? args.rubric : join(here, "rubrics", "code-quality.md"));
	const rubric = await readFile(rubricPath, "utf8");
	// The rubric is part of the measurement, so a judgement only counts for the rubric that produced it.
	const rubricHash = createHash("sha1").update(rubric).digest("hex").slice(0, 8);

	const wanted = Array.isArray(args.tasks) && args.tasks.length > 0 ? new Set(args.tasks) : undefined;
	// Samples already recorded under this rubric are not paid for twice.
	const done = new Set();
	if (args.force !== true) {
		for (const row of await readJsonl(join(runDir, "judgements.jsonl"))) {
			if (row.rubricHash === rubricHash) done.add(`${row.task}|${row.repeat ?? 1}|${row.sample ?? 0}`);
		}
	}
	const groups = new Map();
	const excluded = [];
	for (const row of rows) {
		if (wanted && !wanted.has(row.task)) continue;
		if (!isValidRow(row) || row.contamination?.clean === false) {
			excluded.push(`${row.task}/${row.arm}`);
			continue;
		}
		if (!row.patch?.path) throw new Error(`${row.task} · ${row.arm}: no preserved patch — this run predates diff preservation, so there is nothing to review`);
		const key = `${row.task}|${row.repeat}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row);
	}

	const pi = args["dry-run"] ? { command: "pi", prefix: [] } : await resolvePiCommand(args["pi-bin"]);
	const judgeHome = join(runDir, "judge");
	// No wiki package, no user context, no tools: the judge can do nothing but read its prompt.
	const agentDir = join(judgeHome, "agent");
	if (!args["dry-run"]) await prepareAgentDir({ target: agentDir, excludePackages: ["pi-jev-wiki"], userContext: "none" });
	const agentModels = [...new Set(rows.map((row) => row.model).filter(Boolean))];
	if (args.model && agentModels.includes(String(args.model))) {
		console.log(`note: the judge runs the same model as the agents (${args.model}); a stronger, different model is a better judge.\n`);
	}
	console.log(`judging ${groups.size} task group(s) from ${runId} · ${samples} sample(s) each · rubric ${rubricHash}${excluded.length ? ` · left out (invalid or contaminated): ${excluded.join(", ")}` : ""}\n`);

	const judgements = [];
	for (const [key, groupRows] of groups) {
		const [task, repeat] = key.split("|");
		const taskPrompt = groupRows[0].prompt ?? "(prompt not recorded in the results row)";
		const codeDiffs = new Map();
		for (const row of groupRows) {
			const full = await readFile(join(runDir, row.patch.path), "utf8");
			const code = codeOnlyPatch(full, { excludePrefixes: [row.wikiRoot ?? "docs/wiki", ".pi"] });
			const truncated = code.text.length > MAX_DIFF_CHARS;
			codeDiffs.set(row.arm, { text: truncated ? `${code.text.slice(0, MAX_DIFF_CHARS)}\n[... diff truncated at ${MAX_DIFF_CHARS} characters ...]` : code.text, dropped: code.dropped.length, truncated });
		}
		for (let sample = 0; sample < samples; sample += 1) {
			if (done.has(`${task}|${repeat}|${sample}`)) continue;
			const labels = blindOrder(groupRows.map((row) => row.arm), `${runId}:${task}:${repeat}:${sample}`);
			const mapping = new Map(labels.map((arm, index) => [String.fromCharCode(65 + index), arm]));
			if (args["dry-run"]) {
				console.log(`${task} rep${repeat} sample ${sample}: ${[...mapping.entries()].map(([label, arm]) => `${label}=${arm}`).join(" ")}`);
				continue;
			}
			const prompt = judgePrompt({ taskPrompt, rubric, diffs: [...mapping.entries()].map(([label, arm]) => ({ label, text: codeDiffs.get(arm).text })) });
			const sessionDir = join(judgeHome, "sessions", task, `rep${repeat}-sample${sample}`);
			await mkdir(sessionDir, { recursive: true });
			const cwd = await mkdtemp(join(tmpdir(), "rv-"));
			let run;
			try {
				run = await spawnCapture(pi.command, [...(pi.prefix ?? []), "-p", prompt, "--session-dir", sessionDir, "--no-tools", "--no-context-files", "--model", String(args.model)], {
					cwd,
					timeoutMs: Number(args["timeout-minutes"] ?? 10) * 60 * 1000,
					shell: pi.shell,
					logPath: join(judgeHome, "logs", `${task}-rep${repeat}-sample${sample}.log`),
					env: { PI_CODING_AGENT_DIR: agentDir },
					onTick: ({ elapsedMs }) => console.log(`   … ${task} sample ${sample}: ${Math.round(elapsedMs / 1000)}s`),
				});
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
			const parsed = extractJson(run.stdout);
			if (!parsed?.labels) {
				console.log(`${task} sample ${sample}: the judge did not return parsable JSON — see ${join(judgeHome, "logs")}`);
				console.log(run.stdout.slice(-400));
				continue;
			}
			for (const entry of parsed.labels) {
				const arm = mapping.get(String(entry.label));
				if (!arm) continue;
				const scores = entry.scores ?? {};
				const record = {
					ts: nowIso(),
					runId,
					task,
					repeat: Number(repeat),
					sample,
					arm,
					label: entry.label,
					scores,
					total: Object.values(scores).reduce((sum, value) => sum + (Number(value) || 0), 0),
					verdict: entry.verdict ?? null,
					notes: entry.notes ?? null,
					testChangesWeakenTests: entry.test_changes_weaken_tests ?? null,
					comparison: parsed.comparison ?? null,
					diffTruncated: codeDiffs.get(arm).truncated,
					toolingFilesHidden: codeDiffs.get(arm).dropped,
					judgeModel: String(args.model),
					rubric: rubricPath.replace(/\\/g, "/").split("/eval/")[1] ?? rubricPath,
					rubricHash,
				};
				await appendJsonl(join(runDir, "judgements.jsonl"), record);
				judgements.push(record);
			}
			console.log(`${task} sample ${sample}: judged ${parsed.labels.length} diff(s) — mapping ${[...mapping.entries()].map(([label, arm]) => `${label}=${arm}`).join(" ")}`);
		}
	}

	if (judgements.length > 0) {
		console.log("\n| Task | Arm | Samples | Mean total | Range | Verdicts |");
		console.log("|---|---|---|---|---|---|");
		const cells = new Map();
		for (const entry of judgements) {
			const cell = `${entry.task}|${entry.arm}`;
			if (!cells.has(cell)) cells.set(cell, []);
			cells.get(cell).push(entry);
		}
		for (const [cell, entries] of [...cells.entries()].sort()) {
			const [task, arm] = cell.split("|");
			const totals = entries.map((entry) => entry.total);
			console.log(`| ${task} | ${arm} | ${totals.length} | ${(totals.reduce((sum, value) => sum + value, 0) / totals.length).toFixed(1)} | ${Math.min(...totals)}–${Math.max(...totals)} | ${entries.map((entry) => entry.verdict ?? "—").join(", ")} |`);
		}
		const flagged = judgements.filter((entry) => entry.testChangesWeakenTests);
		if (flagged.length > 0) console.log(`\n⚠ the judge believes the tests were weakened in: ${[...new Set(flagged.map((entry) => `${entry.task}/${entry.arm}`))].join(", ")}`);
		console.log(`\nrecorded in ${join(runDir, "judgements.jsonl")}`);
	}
}

main().catch((error) => {
	console.error(`judge failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
