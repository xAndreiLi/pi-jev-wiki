#!/usr/bin/env node
/**
 * Prove a card's grader discriminates, before spending model money.
 *
 * A grader that passes on the untouched base measures nothing: every arm would be reported as a
 * success and the comparison would be noise. For each card this clones the base — and the target,
 * when the card has one — installs exactly the graders the harness would install, runs the card's
 * own test command, and checks the expectations:
 *
 *   base    must FAIL   (the feature is not there yet)
 *   target  must PASS   (the grader is satisfiable) — only for replay cards
 *
 * Exit code is non-zero if any expectation is violated, so it can gate a pilot.
 *
 * Usage: node eval/grade-check.mjs --tasks eval/tasks/ds-*.json [--runs-dir eval/runs] [--keep]
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertCanary, installGraders, prepareTaskCopy, protectGrader, shellCommand } from "./arms.mjs";
import { git, parseArgs, readJson, runId, spawnCapture } from "./lib.mjs";

const DEFAULT_LINK_DIRS = ["node_modules", "web/node_modules", ".venv"];

async function checkAt({ task, sha, label, dir, runsDir, linkDirs }) {
	const copy = join(dir, label);
	const environment = await prepareTaskCopy({ task: { ...task, base: sha }, dir: copy, arm: "wiki", linkDirs, link: true });
	const restored = await protectGrader({ task, copy });
	const graders = await installGraders({ task, copy });
	if (graders.length === 0) throw new Error(`${task.id}: the card declares no graderFiles, so there is nothing to check`);
	const [command, args] = shellCommand(task.testCommand);
	const logPath = join(runsDir, "logs", `gradecheck-${task.id}-${label}.log`);
	const run = await spawnCapture(command, args, {
		cwd: copy,
		timeoutMs: (task.testTimeoutMinutes ?? 5) * 60 * 1000,
		logPath,
	});
	// How it failed matters: an assertion failure means the grader ran, a collection failure means no
	// assertion ever executed. Both exit non-zero, and only the first is a grader.
	const kind = await failureKind(logPath);
	return {
		passed: run.exitCode === 0,
		kind,
		exitCode: run.exitCode,
		timedOut: run.timedOut,
		wallMs: run.wallMs,
		environment,
		restored: restored.restored.length,
		graders: graders.length,
		tail: `${run.stdout}\n${run.stderr}`.trim().split(/\r?\n/).slice(-6).join("\n      "),
	};
}

/** Read the runner's own summary out of the log to tell assertions from a failed import. */
async function failureKind(logPath) {
	let text = "";
	try {
		text = await readFile(logPath, "utf8");
	} catch {
		return "unknown";
	}
	const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
	if (/Tests\s+(?:\d+ failed|\d+ passed)/.test(plain) || /\d+ failed \|/.test(plain)) return "assertions";
	if (/no tests/.test(plain) || /Failed to load url/.test(plain)) return "collection";
	return "unknown";
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.tasks || args.help) {
		console.log("Usage: node eval/grade-check.mjs --tasks <card.json[,...]> [--runs-dir eval/runs] [--keep]");
		console.log("Checks that each card's hidden grader fails on the base commit and passes on the target.");
		return;
	}
	const runsDir = resolve(args["runs-dir"] ?? "eval/runs");
	const dir = join(runsDir, runId("gradecheck"));
	await mkdir(dir, { recursive: true });
	const cards = [];
	for (const path of (Array.isArray(args.tasks) ? args.tasks : [args.tasks]).map((entry) => resolve(entry))) cards.push(await readJson(path));

	const rows = [];
	for (const task of cards) {
		// A grader the agent could see without it showing up in the session would leak undetected.
		await assertCanary(task);
		const linkDirs = Array.isArray(task.linkDirs) && task.linkDirs.length > 0 ? task.linkDirs : DEFAULT_LINK_DIRS;
		const targetSha = task.target ? await git(task.repo, ["rev-parse", `${task.target}^{commit}`]) : undefined;
		const base = await checkAt({ task, sha: task.base, label: "base", dir, runsDir, linkDirs });
		const target = targetSha ? await checkAt({ task, sha: targetSha, label: "target", dir, runsDir, linkDirs }) : undefined;
		const problems = [];
		if (base.passed) problems.push("the grader PASSES on the untouched base — it measures nothing");
		if (!base.passed && base.kind === "collection") problems.push("the grader failed without running any assertion (import/collection error) — fix the grader, not the task");
		if (target && !target.passed) problems.push("the grader FAILS on the target commit — it is not satisfiable");
		if (base.timedOut || target?.timedOut) problems.push("the test command timed out");
		rows.push({ task: task.id, base, target, problems });
		console.log(`\n${task.id}`);
		console.log(`  base   ${base.passed ? "pass" : `FAIL (${base.kind})`} (exit ${base.exitCode}, ${Math.round(base.wallMs / 1000)}s, ${base.graders} grader(s) installed, ${base.restored} test file(s) restored)`);
		if (target) console.log(`  target ${target.passed ? "pass" : `FAIL (${target.kind})`} (exit ${target.exitCode}, ${Math.round(target.wallMs / 1000)}s)`);
		for (const problem of problems) console.log(`  ⚠ ${problem}`);
		if (problems.length > 0) console.log(`  last output:\n      ${base.tail}`);
		if (!args.keep) await rm(join(dir, "base"), { recursive: true, force: true }).catch(() => {});
		if (!args.keep && target) await rm(join(dir, "target"), { recursive: true, force: true }).catch(() => {});
	}

	const broken = rows.filter((row) => row.problems.length > 0);
	console.log(`\n${rows.length - broken.length} of ${rows.length} card(s) discriminate correctly`);
	if (broken.length > 0) {
		console.log(`Fix these before running a pilot: ${broken.map((row) => row.task).join(", ")}`);
		console.log(`(logs kept under ${dir})`);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(`grade-check failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
