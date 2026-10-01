#!/usr/bin/env node
/**
 * One command to run the whole thing, in the foreground, streaming as it goes.
 *
 * The stages exist separately so each can be inspected and re-run on its own — but running them by
 * hand was friction: the free checks come first, the pilot is long, and the report needs the run id.
 * This sequences them and stops at the first stage that fails, so nobody has to babysit a background
 * process or copy ids between steps.
 *
 *   node eval/pipeline.mjs --tasks eval/tasks/ds-*.json --model deepseek-flash \
 *        [--arms off,brief,wiki,wiki-nocapture] [--repeats 1] [--skip-checks] [--label <name>]
 *
 * Stages, all streaming to the terminal and to <runs>/<id>/pipeline.log:
 *   1. build the measurement package if its output is missing
 *   2. self-test the harness            (no model calls, seconds)
 *   3. prove every grader discriminates (no model calls, ~a minute)
 *   4. run the pilot                    (this is the part that costs money)
 *   5. write the paired report next to the results
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, runId, spawnCapture } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

async function stage(number, title, command, args, options = {}) {
	console.log(`\n${"─".repeat(72)}\n[${number}] ${title}\n$ ${command} ${args.join(" ")}\n`);
	const run = await spawnCapture(command, args, {
		cwd: options.cwd ?? repoRoot,
		timeoutMs: options.timeoutMs ?? 6 * 60 * 60 * 1000,
		logPath: options.logPath,
		onLine: (line) => process.stdout.write(`${line}\n`),
		onTick: ({ elapsedMs, idleMs }) => console.log(`   … ${Math.round(elapsedMs / 1000)}s elapsed (idle ${Math.round(idleMs / 1000)}s)`),
	});
	console.log(`[${number}] ${title}: exit ${run.exitCode} in ${Math.round(run.wallMs / 1000)}s`);
	if (run.exitCode !== 0) throw new Error(`stage ${number} failed (${title}) — stopping here`);
	return run;
}

async function main() {
	const args = parseArgs(process.argv.slice(2), { lists: ["tasks", "arms"] });
	const positional = Array.isArray(args._) ? args._ : [];
	const taskList = [...(Array.isArray(args.tasks) ? args.tasks : []), ...positional].filter(Boolean);
	if (taskList.length === 0 || args.help) {
		console.log("Usage: node eval/pipeline.mjs --tasks <card.json[,...]> --model <id>");
		console.log("       [--arms off,brief,wiki,wiki-nocapture] [--repeats 1] [--runs-dir eval/runs]");
		console.log("       [--label <name>] [--skip-checks] [--judge] [--resume] [--runs <id>]");
		console.log("\nRuns self-test → grader discrimination → pilot → report → optional quality review, in the foreground.");
		return;
	}
	if (!args.model) throw new Error("--model is required: both arms must run the same model");

	// parseArgs turns --arms into an array (it is declared as a list), so accept both shapes. Getting this
	// wrong silently dropped an arm from a run.
	const arms = Array.isArray(args.arms) ? args.arms.join(",") : typeof args.arms === "string" ? args.arms : "off,brief,wiki";
	const repeats = String(args.repeats ?? 1);
	const runsDir = resolve(args["runs-dir"] ?? join(repoRoot, "eval", "runs"));
	const id = typeof args.runs === "string" ? args.runs : `${typeof args.label === "string" ? args.label : "e1"}-${runId()}`;
	const logPath = join(runsDir, id, "pipeline.log");
	await mkdir(join(runsDir, id), { recursive: true });
	const node = process.execPath;

	console.log(`pipeline ${id}\n  tasks: ${taskList.length} card(s)\n  arms:  ${arms}\n  model: ${args.model}\n  log:   ${logPath}`);
	await writeFile(logPath, `pipeline ${id}\ntasks ${taskList.join(",")}\narms ${arms}\nmodel ${args.model}\n`, "utf8");

	// 1. The measurement package has to be built; the harness imports its output.
	if (!existsSync(join(repoRoot, "packages", "pi-wiki-eval", "dist", "core", "analyze.js"))) {
		await stage(1, "build the measurement package", "npm", ["run", "build"], {
			cwd: join(repoRoot, "packages", "pi-wiki-eval"),
			timeoutMs: 5 * 60 * 1000,
			logPath,
		});
	} else {
		console.log("\n[1] measurement package already built — skipping");
	}

	if (args["skip-checks"] !== true) {
		await stage(2, "harness self-test (free)", node, [join(here, "selftest.mjs")], { timeoutMs: 10 * 60 * 1000, logPath });
		await stage(3, "grader discrimination (free)", node, [join(here, "grade-check.mjs"), "--tasks", taskList.join(","), "--runs-dir", runsDir], {
			timeoutMs: 30 * 60 * 1000,
			logPath,
		});
	}

	await stage(
		4,
		`pilot — ${taskList.length} task(s) × ${arms.split(",").length} arm(s) × ${repeats} repeat(s), costs money`,
		node,
		[join(here, "run.mjs"), "--tasks", taskList.join(","), "--arms", arms, "--repeats", repeats, "--model", args.model, "--runs-dir", runsDir, "--runs", id, ...(args.resume === true ? ["--resume"] : [])],
		{ logPath },
	);

	const report = await stage(5, "paired report", node, [join(here, "report.mjs"), "--run", id, "--runs-dir", runsDir], {
		timeoutMs: 5 * 60 * 1000,
		logPath: join(runsDir, id, "report.log"),
		cwd: repoRoot,
	});
	await writeFile(join(runsDir, id, "report.md"), report.stdout, "utf8");

	if (args.judge === true) {
		await stage(6, "blinded quality review (costs money)", node, [join(here, "judge.mjs"), "--run", id, "--runs-dir", runsDir, "--model", args.model], {
			logPath: join(runsDir, id, "judge.log"),
			cwd: repoRoot,
		});
	}

	console.log(`\nDone. Everything from this run is in ${join(runsDir, id)}:`);
	console.log("  report.md · results.jsonl · judgements.jsonl (if judged) · diffs/ · logs/ · sessions/ · pipeline.log");
	console.log(`Quality review: node eval/judge.mjs --run ${id} --model ${args.model}   (add --judge to run it as part of the pipeline)`);
}

main().catch((error) => {
	console.error(`\npipeline failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
