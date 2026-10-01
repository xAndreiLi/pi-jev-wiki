#!/usr/bin/env node
/**
 * Task candidates from a repository's own history.
 *
 * The goal is to *split* a project into replayable tasks: commits that are small enough to be one
 * sitting, that changed source rather than documentation, and that ideally came with tests — the
 * test command is the grader and the diff is the ground truth. Nothing is written unless --write is
 * given, and nothing is executed.
 *
 * Usage:
 *   node eval/candidates.mjs --repo <dir> [--branch main] [--scan 400] [--limit 20]
 *                            [--max-files 15] [--max-lines 400] [--write eval/tasks]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, parseArgs } from "./lib.mjs";

const UNIT = "\x1f";
const RECORD = "\x1e";
const DOC = /^(docs\/|\.github\/|.*\.md$|.*\.txt$|LICENSE|CHANGELOG|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|uv\.lock|Cargo\.lock|.*\.lock$|\.gitignore|\.gitattributes)/i;
const TEST = /(^|\/)(test|tests|spec|specs|__tests__|e2e)(\/|$)|[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$/i;
const NOISE = /^(chore|docs|style|ci|build|wip)(\(|:|$)|^merge\b|^revert\b|^bump\b|^release\b|^v?\d+(\.\d+)*$/i;

function shorten(value, max) {
	const clean = value.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

async function main() {
	const args = parseArgs(process.argv.slice(2), { lists: ["branches"] });
	if (!args.repo) {
		console.log("Usage: node eval/candidates.mjs --repo <dir> [--branch <name>] [--scan 400] [--limit 20] [--max-files 15] [--max-lines 400] [--write <dir>] [--json]");
		return;
	}
	const repo = resolve(args.repo);
	if (!existsSync(join(repo, ".git"))) throw new Error(`${repo} is not a git repository`);

	const commits = Number((await git(repo, ["rev-list", "--all", "--count"], { allowFailure: true })).trim() || "0");
	if (commits === 0) {
		console.log(
			[
				"# No history to split",
				"",
				`${repo} has a git repository but no commits yet, so there are no past tasks to replay.`,
				"",
				"Two ways forward:",
				"",
				"1. Commit the current state. From then on every substantive commit becomes a task card — base is its",
				"   parent, target is the commit itself, and the harness rewinds the wiki to the base automatically.",
				"2. Write task cards now with `\"target\": null` and grade them with the project's own test command.",
				"   There is no ground-truth diff, but cost and exploration are still comparable between arms.",
				"",
				"Check that the wiki directory is committed too: if it is ignored or untracked, the wiki arm has",
				"nothing to read and the comparison measures nothing.",
			].join("\n"),
		);
		return;
	}

	const branch = args.branch ?? ((await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true })).trim() || "HEAD");
	const scan = Number(args.scan ?? 400);
	const limit = Number(args.limit ?? 20);
	const maxFiles = Number(args.maxFiles ?? 15);
	const maxLines = Number(args.maxLines ?? 400);

	const log = await git(repo, ["log", "--no-merges", `-n${scan}`, `--pretty=format:%H${UNIT}%ad${UNIT}%s${UNIT}%b${RECORD}`, "--date=short", branch]);
	const records = log.split(RECORD).map((chunk) => chunk.replace(/^\r?\n/, "")).filter(Boolean);
	const candidates = [];

	for (const record of records) {
		const [sha, date, subject, body = ""] = record.split(UNIT);
		if (!sha || !subject || NOISE.test(subject)) continue;
		const parent = (await git(repo, ["rev-parse", `${sha}^`], { allowFailure: true })).trim();
		if (!parent) continue;
		const numstat = await git(repo, ["show", "--numstat", "--format=", sha], { allowFailure: true });
		const files = numstat
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				const [added, removed, path] = line.split("\t");
				return { path: path ?? "", added: Number(added) || 0, removed: Number(removed) || 0 };
			})
			.filter((file) => file.path);
		const source = files.filter((file) => !DOC.test(file.path));
		const tests = files.filter((file) => TEST.test(file.path));
		const lines = source.reduce((sum, file) => sum + file.added + file.removed, 0);
		if (source.length === 0) continue;
		if (source.length > maxFiles || lines > maxLines) continue;

		const score = (tests.length > 0 ? 2 : 0) + (source.length <= 6 ? 1 : 0);
		candidates.push({ sha, parent, date, subject, body, source, tests, lines, score });
	}

	candidates.sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
	const selected = candidates.slice(0, limit);

	console.log(`# Task candidates — ${repo} @ ${branch}\n`);
	console.log(`${candidates.length} candidate(s) from the last ${scan} commits; showing ${selected.length}, newest first.\n`);
	console.log("| # | Date | Commit | Subject | Files | Lines | Tests |");
	console.log("|---|---|---|---|---|---|---|");
	selected.forEach((candidate, index) => {
		console.log(`| ${index + 1} | ${candidate.date} | \`${candidate.sha.slice(0, 8)}\` | ${shorten(candidate.subject, 64)} | ${candidate.source.length} | ${candidate.lines} | ${candidate.tests.length > 0 ? "yes" : "no"} |`);
	});
	console.log("\n`Lines` counts added+removed in non-documentation files. A task needs a `testCommand` before it can be graded; commits that touched tests are the easiest to grade, because the test files can be restored from the target commit.");

	if (args.write) {
		const dir = resolve(args.write);
		await mkdir(dir, { recursive: true });
		const prefix = shorten((repo.split(/[\\/]/).pop() ?? "task").toLowerCase().replace(/[^a-z0-9]+/g, "-"), 24);
		const written = [];
		for (const [index, candidate] of selected.entries()) {
			const id = `${prefix}-${String(index + 1).padStart(3, "0")}`;
			const card = {
				id,
				repo,
				base: candidate.parent,
				target: candidate.sha,
				prompt: shorten(candidate.subject.replace(/^[a-z]+(\([^)]*\))?:\s*/i, ""), 200),
				testCommand: "",
				wikiRoot: "docs/wiki",
				timeoutMinutes: 20,
				repeats: 3,
				notes: [
					`Auto-generated from ${candidate.sha} (${candidate.date}).`,
					"Refine `prompt` so it states the goal without revealing the solution, and set `testCommand`.",
					candidate.tests.length > 0 ? `Target commit changed test files: ${candidate.tests.map((file) => file.path).join(", ")} — restoring those after the run gives a grader for free.` : "Target commit changed no test files: the grader has to come from somewhere else.",
					`Files changed by the target: ${candidate.source.map((file) => file.path).join(", ")}`,
					candidate.body ? `Original commit body: ${shorten(candidate.body, 400)}` : "Original commit had no body.",
				],
			};
			await writeFile(join(dir, `${id}.json`), `${JSON.stringify(card, null, "\t")}\n`, "utf8");
			written.push(id);
		}
		console.log(`\nWrote ${written.length} task card(s) to ${dir}: ${written.join(", ")}`);
		console.log("Edit each card's `prompt` and `testCommand` before running it.");
	}
	if (args.json) console.log(JSON.stringify(selected, null, "\t"));
}

main().catch((error) => {
	console.error(`candidates failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
