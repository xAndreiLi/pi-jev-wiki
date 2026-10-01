#!/usr/bin/env node
/**
 * Quality review of what each arm actually wrote.
 *
 * The grader answers "did it pass". It cannot answer "was it any good": a diff can pass the tests while
 * ignoring the project's conventions, editing unrelated files, weakening the tests it was graded by, or
 * leaving dead code behind. This runs a subagent over the preserved patches and scores each arm.
 *
 * Two properties matter for the result to mean anything:
 *
 *   - **Blinded.** Diffs are presented as A/B/C with the arm identity hidden, and the mapping is recorded
 *     only after the judgement. A judge that knows which diff came from the wiki arm is not a judge.
 *   - **Per task, not per run.** The arms are compared against each other on the same task, which is the
 *     only comparison that holds the task constant.
 *
 * Usage:
 *   node eval/judge.mjs --run <run-id> [--runs-dir eval/runs] [--model <id>] [--dry-run]
 *                       [--rubric eval/rubrics/code-quality.md] [--tasks <ids>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blindOrder, defaultAgentDir, prepareAgentDir } from "./arms.mjs";
import { appendJsonl, nowIso, parseArgs, readJson, readJsonl, spawnCapture } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

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

async function resolvePi() {
	const candidates = [
		process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "package.json") : undefined,
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/package.json",
	].filter(Boolean);
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const pkg = await readJson(candidate);
		const bin = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin ?? {})[0];
		if (bin) return { command: process.execPath, prefix: [join(dirname(candidate), bin)], version: pkg.version };
	}
	throw new Error("no pi install found for the judge; pass --pi-bin or set PI_PI_BIN");
}

async function main() {
	const args = parseArgs(process.argv.slice(2), { lists: ["tasks"] });
	const runsDir = resolve(args["runs-dir"] ?? join(repoRoot, "eval", "runs"));
	if (!args.run || args.run === true) {
		console.log("Usage: node eval/judge.mjs --run <run-id> [--model <id>] [--dry-run] [--rubric <path>]");
		return;
	}
	const runId = String(args.run);
	const runDir = join(runsDir, runId);
	const rows = await readJsonl(join(runDir, "results.jsonl"));
	if (rows.length === 0) throw new Error(`no results in ${runDir}`);

	const rubricPath = resolve(typeof args.rubric === "string" ? args.rubric : join(here, "rubrics", "code-quality.md"));
	const rubric = await readFile(rubricPath, "utf8");
	// The rubric is part of the measurement, so a judgement only counts for the rubric that produced it.
	// Changing the rubric therefore re-scores the tasks automatically instead of leaving two rubrics mixed
	// in one run.
	const rubricHash = createHash("sha1").update(rubric).digest("hex").slice(0, 8);

	const wanted = Array.isArray(args.tasks) && args.tasks.length > 0 ? new Set(args.tasks) : undefined;
	// Judgements already recorded for a task are not paid for twice: this lets the judge run over finished
	// tasks while a pilot is still going, and then finish the rest at the end of the pipeline.
	const alreadyJudged = new Set();
	if (args.force !== true) {
		for (const row of await readJsonl(join(runDir, "judgements.jsonl"))) {
			if (row.rubricHash === rubricHash) alreadyJudged.add(row.task);
		}
	}
	const byTask = new Map();
	for (const row of rows) {
		if (wanted && !wanted.has(row.task)) continue;
		if (alreadyJudged.has(row.task)) continue;
		if (!row.patch?.path) throw new Error(`${row.task} · ${row.arm}: no preserved patch — this run predates diff preservation, so there is nothing to review`);
		if (!byTask.has(row.task)) byTask.set(row.task, []);
		byTask.get(row.task).push(row);
	}

	const pi = args["dry-run"] ? { command: "pi", prefix: [] } : await resolvePi();
	const judgeHome = join(runDir, "judge");
	// The judge runs in the control environment: no wiki tools, so it cannot consult the wiki about the
	// arms, and it sees exactly what a reader of the diff would see.
	const agentDir = join(judgeHome, "agent");
	await prepareAgentDir({ source: args["agent-dir"] ? String(args["agent-dir"]) : defaultAgentDir(), target: agentDir, excludePackages: ["pi-jev-wiki"] });

	console.log(`judging ${byTask.size} task(s) from ${runId}${args["dry-run"] ? " (dry run)" : ""} · rubric ${rubricHash}${alreadyJudged.size > 0 ? ` — skipping ${alreadyJudged.size} already judged under this rubric` : ""}\n`);
	const judgements = [];

	for (const [task, taskRows] of byTask) {
		const labels = blindOrder(taskRows.map((row) => row.arm), `${runId}:${task}`);
		const mapping = new Map(labels.map((arm, index) => [String.fromCharCode(65 + index), arm]));
		const taskPrompt = taskRows[0].prompt ?? "(prompt not recorded in the results row)";
		if (args["dry-run"]) {
			console.log(`${task}: ${[...mapping.entries()].map(([label, arm]) => `${label}=${arm}`).join(" ")}`);
			continue;
		}

		const diffBlocks = [...mapping.entries()]
			.map(([label, arm]) => {
				const row = taskRows.find((entry) => entry.arm === arm);
				const patchPath = join(runDir, row.patch.path);
				return [
					`### Diff ${label}`,
					`Patch file: ${patchPath}`,
					`Files changed: ${row.diff?.filesChanged ?? "?"} · insertions ${row.diff?.insertions ?? "?"} · deletions ${row.diff?.deletions ?? "?"} · test files touched: ${(row.diff?.testFilesChanged ?? []).length}`,
					`Automated test result: ${row.grading?.passed === null ? "not graded" : row.grading?.passed ? "pass" : "fail"}`,
					`Type-check / lint: ${Object.entries(row.quality ?? {}).map(([name, value]) => `${name} ${value.passed ? "pass" : "fail"}`).join(", ") || "not collected"}`,
				].join("\n");
			})
			.join("\n\n");

		const prompt = [
			"You are reviewing three competing implementations of the same task, written by three different",
			"agent configurations. Read the task, then read every patch file listed below, then judge the patches.",
			"",
			"You do not know, and must not try to guess, which configuration produced which diff. Judge only",
			"what is in front of you. The labels are arbitrary and do not correspond to any ordering.",
			"",
			"## The task, as the agent was given it",
			"",
			taskPrompt,
			"",
			"## The patches",
			"",
			diffBlocks,
			"",
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
			`Score every label you were given (${[...mapping.keys()].join(", ")}), using the rubric's 0-3 scale.`,
		].join("\n");

		const sessionDir = join(judgeHome, "sessions", task);
		await mkdir(sessionDir, { recursive: true });
		const run = await spawnCapture(pi.command, [...(pi.prefix ?? []), "-p", prompt, "--session-dir", sessionDir, ...(args.model ? ["--model", String(args.model)] : [])], {
			cwd: runDir,
			timeoutMs: (Number(args["timeout-minutes"] ?? 10)) * 60 * 1000,
			logPath: join(judgeHome, "logs", `${task}.log`),
			env: { PI_CODING_AGENT_DIR: agentDir },
			onTick: ({ elapsedMs }) => console.log(`   … ${task}: ${Math.round(elapsedMs / 1000)}s`),
		});
		const parsed = extractJson(run.stdout);
		if (!parsed?.labels) {
			console.log(`${task}: the judge did not return parsable JSON — see ${join(judgeHome, "logs", `${task}.log`)}`);
			console.log(run.stdout.slice(-400));
			continue;
		}
		for (const entry of parsed.labels) {
			const arm = mapping.get(String(entry.label));
			if (!arm) continue;
			const scores = entry.scores ?? {};
			const total = Object.values(scores).reduce((sum, value) => sum + (Number(value) || 0), 0);
			const record = {
				ts: nowIso(),
				runId,
				task,
				arm,
				label: entry.label,
				scores,
				total,
				verdict: entry.verdict ?? null,
				notes: entry.notes ?? null,
				testChangesWeakenTests: entry.test_changes_weaken_tests ?? null,
				comparison: parsed.comparison ?? null,
				rubric: rubricPath.replace(/\\/g, "/").split("/eval/")[1] ?? rubricPath,
				rubricHash,
			};
			await appendJsonl(join(runDir, "judgements.jsonl"), record);
			judgements.push(record);
		}
		console.log(`${task}: judged ${parsed.labels.length} diff(s) — mapping ${[...mapping.entries()].map(([label, arm]) => `${label}=${arm}`).join(" ")}`);
	}

	if (judgements.length > 0) {
		console.log("\n| Task | Arm | Total | Correctness | Conventions | Scope | Edge cases | Clarity | Restraint | Verdict |");
		console.log("|---|---|---|---|---|---|---|---|---|---|");
		for (const entry of judgements.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm))) {
			const s = entry.scores;
			console.log(
				`| ${entry.task} | ${entry.arm} | ${entry.total} | ${s.correctness ?? "—"} | ${s.conventions ?? "—"} | ${s.scope ?? "—"} | ${s.edge_cases ?? "—"} | ${s.clarity ?? "—"} | ${s.restraint ?? "—"} | ${entry.verdict ?? "—"} |`,
			);
		}
		if (judgements.some((entry) => entry.testChangesWeakenTests)) {
			const flagged = judgements.filter((entry) => entry.testChangesWeakenTests);
			console.log(`\n⚠ the judge believes the tests were weakened in: ${flagged.map((entry) => `${entry.task}/${entry.arm}`).join(", ")}`);
		}
		console.log(`\nrecorded in ${join(runDir, "judgements.jsonl")}`);
	}
}

main().catch((error) => {
	console.error(`judge failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
