#!/usr/bin/env node
/**
 * The A/B runner: one task, three arms, in throwaway copies of the repository.
 *
 * Fairness is enforced rather than assumed. Before a single measurement is taken the harness proves:
 *
 *   1. the answer is not reachable (`git` refs pruned, target commit pruned);
 *   2. the arms differ in exactly one thing — the wiki — by comparing their tool loadouts;
 *   3. every arm can actually run the grader (dependencies present, grader files restored).
 *
 * The control arms differ from the treatment arm only by the wiki package and the wiki files: every
 * other extension, skill, MCP server and tool stays loaded, because the naive `pi --no-extensions`
 * control also strips the web tools and unrelated skills and is therefore a less capable agent.
 *
 * Usage:
 *   node eval/run.mjs --tasks eval/tasks/ds-001.json --arms off,wiki --model <id> \
 *                     [--repeats 1] [--dry-run] [--runs-dir eval/runs] [--runs <id>]
 *                     [--pi-bin <path>] [--pi-arg <value>] [--link-dirs a,b] [--copy-deps]
 *                     [--brief-chars 2000] [--keep-copies] [--allow-unverified-arm]
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../packages/pi-wiki-eval/dist/core/analyze.js";
import { buildBrief, compareToolsets, configureCapture, defaultAgentDir, installGraders, keepsWiki, prepareAgentDir, prepareTaskCopy, protectGrader, shellCommand, sparseExclude, TEST_PATTERN } from "./arms.mjs";
import { appendJsonl, git, nowIso, parseArgs, readJson, runId, spawnCapture } from "./lib.mjs";

const ARMS = ["off", "brief", "wiki", "wiki-nocapture"];
/** Dependency directories a clone will not have. */
const DEFAULT_LINK_DIRS = ["node_modules", "web/node_modules", ".venv"];
const WIKI_PACKAGE = "pi-jev-wiki";

/** Resolve which pi to drive: the installed one, which is the environment the experiment is about. */
async function resolvePiCommand(explicit) {
	if (explicit) return await describePi(explicit);
	if (process.env.PI_PI_BIN) return await describePi(process.env.PI_PI_BIN);
	const packageRelative = ["@earendil-works", "pi-coding-agent"];
	const roots = [
		process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules") : undefined,
		process.env.npm_config_prefix ? join(process.env.npm_config_prefix, "lib", "node_modules") : undefined,
		"/usr/local/lib/node_modules",
		"/usr/lib/node_modules",
		join(homedir(), ".npm-global", "lib", "node_modules"),
	].filter(Boolean);
	for (const root of roots) {
		const candidate = join(root, ...packageRelative, "package.json");
		if (!existsSync(candidate)) continue;
		const described = await describePi(candidate, "global");
		if (described.prefix.length > 0) return described;
	}
	console.warn("warning: no pi install found; falling back to `pi` on PATH. Shell quoting may mangle prompts — pass --pi-bin to be exact.");
	return { command: "pi", prefix: [], shell: true, source: "path" };
}

async function describePi(pathOrCommand, source = "explicit") {
	if (existsSync(pathOrCommand)) {
		const packageJson = await readJson(pathOrCommand);
		const bin = typeof packageJson.bin === "string" ? packageJson.bin : Object.values(packageJson.bin ?? {})[0];
		if (bin) return { command: process.execPath, prefix: [join(dirname(pathOrCommand), bin)], version: packageJson.version, source };
	}
	return { command: pathOrCommand, prefix: [], source };
}

/**
 * Cheap fingerprint of the directories runs share, so that a write-back (an `npm install` inside one
 * run) is detected rather than assumed away: it would change the environment for every later run.
 */
async function fingerprint(repoDir, names) {
	const out = {};
	for (const name of names) {
		try {
			out[name] = Math.round((await stat(join(repoDir, name))).mtimeMs);
		} catch {
			out[name] = null;
		}
	}
	return out;
}

/** The tool loadout pi persists in the session's first system message. */
async function readLoadout(sessionDir) {
	const files = [];
	async function walk(dir) {
		let entries = [];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith(".jsonl")) files.push(full);
		}
	}
	await walk(sessionDir);
	if (files.length === 0) return { sessionFile: undefined, tools: [], hasWikiTools: false, thinkingLevel: null };
	const newest = (await Promise.all(files.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })))).sort((a, b) => b.mtime - a.mtime)[0];
	const text = await readFile(newest.file, "utf8");
	const tools = [];
	let thinkingLevel = null;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type === "thinking_level_change" && entry.thinkingLevel) thinkingLevel = entry.thinkingLevel;
		const sections = entry?.message?.sections;
		if (entry?.type === "message" && entry?.message?.role === "system" && sections?.tools) {
			for (const match of String(sections.tools).matchAll(/^- ([a-zA-Z0-9_]+):/gm)) tools.push(match[1]);
		}
	}
	return { sessionFile: newest.file, tools, hasWikiTools: tools.some((tool) => tool.startsWith("wiki_")), thinkingLevel };
}

/** One tiny call per arm, to prove the environment before any measurement is taken. */
async function preflight({ piCommand, dir, agentDir, model, arms }) {
	const results = {};
	for (const arm of arms) {
		const home = join(dir, "preflight", arm);
		await mkdir(home, { recursive: true });
		const sessionDir = join(home, "sessions");
		const args = [...piCommand.prefix, "-p", "Reply with exactly: ok", "--session-dir", sessionDir];
		if (model) args.push("--model", model);
		const run = await spawnCapture(piCommand.command, args, {
			cwd: home,
			timeoutMs: 120_000,
			shell: piCommand.shell,
			logPath: join(home, "preflight.log"),
			env: { PI_CODING_AGENT_DIR: agentDir[arm] },
		});
		const loadout = await readLoadout(sessionDir);
		results[arm] = { ...loadout, exitCode: run.exitCode, timedOut: run.timedOut };
	}
	return results;
}

async function runArm({ task, arm, repeat, copy, piCommand, agentDir, brief, model, thinking, extraArgs, runsDir, timeoutMinutes }) {
	const sessionDir = join(runsDir, "sessions", task.id, arm);
	const logPath = join(runsDir, "logs", `${task.id}-${arm}-rep${repeat}.log`);
	await mkdir(sessionDir, { recursive: true });
	await mkdir(dirname(logPath), { recursive: true });

	const prompt = brief ? `${brief}\n\n---\n\n${task.prompt}` : task.prompt;
	const args = [...piCommand.prefix, "-p", prompt, "--session-dir", sessionDir];
	if (model) args.push("--model", model);
	if (thinking) args.push("--thinking", thinking);
	args.push(...extraArgs);

	const budgetMs = (timeoutMinutes ?? task.timeoutMinutes ?? 5) * 60 * 1000;
	let lastLine = "";
	const result = await spawnCapture(piCommand.command, args, {
		cwd: copy,
		timeoutMs: budgetMs,
		shell: piCommand.shell,
		logPath,
		env: { PI_CODING_AGENT_DIR: agentDir },
		onLine: (line) => {
			lastLine = line.trim().slice(0, 120);
			if (/\b(error|exception|failed|not found|cannot|refus)\b/i.test(line)) console.log(`      ! ${line.trim().slice(0, 160)}`);
		},
		onTick: ({ elapsedMs, idleMs }) =>
			console.log(
				`      … ${Math.round(elapsedMs / 1000)}s elapsed${lastLine ? ` · last: ${lastLine}` : ` · no output yet (print mode is silent until it finishes; quiet ${Math.round(idleMs / 1000)}s)`}`,
			),
	});
	const loadout = await readLoadout(sessionDir);
	return { result, sessionDir, logPath, loadout };
}

async function gradeRun({ task, copy, runsDir, label }) {
	if (!task.testCommand) return { command: "", exitCode: null, passed: null, durationMs: 0, note: "no testCommand in the task card — nothing to grade" };
	const [command, args] = shellCommand(task.testCommand);
	const grading = await spawnCapture(command, args, {
		cwd: copy,
		timeoutMs: (task.testTimeoutMinutes ?? 3) * 60 * 1000,
		logPath: join(runsDir, "logs", `${label}-grade.log`),
	});
	return {
		command: task.testCommand,
		exitCode: grading.exitCode,
		passed: grading.exitCode === 0,
		durationMs: grading.wallMs,
		timedOut: grading.timedOut,
		tail: grading.stdout.slice(-2000),
	};
}

async function measure({ copy, sessionDir }) {
	try {
		const analysis = await analyzeProject({ projectDir: copy, sessionsRoot: dirname(sessionDir) });
		const totals = analysis.totals;
		return {
			episodes: totals.episodes,
			requests: totals.requests,
			cost: totals.usage.cost,
			tokens: totals.usage.totalTokens,
			cacheReadTokens: totals.usage.cacheRead,
			byBucket: totals.byBucket,
			wikiReads: totals.wikiReads,
			wikiWrites: totals.wikiWrites,
			readFiles: totals.readFiles,
			readChars: totals.readChars,
			searches: totals.searches,
			consultationRate: totals.consultationRate,
			rediscoveryRate: totals.rediscovery.rate,
			hasWiki: analysis.wiki !== undefined,
		};
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

async function diffStats(dir) {
	const paths = (await git(dir, ["diff", "--name-only", "HEAD"], { allowFailure: true })).split(/\r?\n/).filter(Boolean);
	const numstat = await git(dir, ["diff", "--numstat", "HEAD"], { allowFailure: true });
	let insertions = 0;
	let deletions = 0;
	for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
		const [added, removed] = line.split("\t");
		insertions += Number(added) || 0;
		deletions += Number(removed) || 0;
	}
	return {
		filesChanged: paths.length,
		insertions,
		deletions,
		paths: paths.slice(0, 40),
		testFilesChanged: paths.filter((path) => TEST_PATTERN.test(path)),
	};
}

async function suggestModel() {
	try {
		const settings = JSON.parse(await readFile(join(defaultAgentDir(), "settings.json"), "utf8"));
		if (settings.defaultModel) return `${settings.defaultProvider ? `${settings.defaultProvider}/` : ""}${settings.defaultModel}`;
	} catch {
		/* no readable settings */
	}
	return null;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || (!args.tasks && !args["dry-run"])) {
		console.log(
			[
				"Usage: node eval/run.mjs --tasks <card.json[,...]> --model <id>",
				"       [--arms off,brief,wiki] [--repeats 1] [--runs-dir eval/runs] [--runs <id>]",
				"       [--pi-bin <path>] [--pi-arg <value>] [--link-dirs a,b] [--copy-deps]",
				"       [--brief-chars 2000] [--keep-copies] [--allow-unpinned-model] [--allow-unverified-arm]",
				"       [--dry-run]",
				"",
				"Each task card: { id, repo, base, target, prompt, testCommand, wikiRoot, timeoutMinutes, linkDirs }",
			].join("\n"),
		);
		return;
	}
	const arms = (typeof args.arms === "string" ? args.arms.split(",") : args.arms) ?? ["off", "wiki"];
	for (const arm of arms) if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
	const repeats = Number(args.repeats ?? 1);
	const runsDir = resolve(args["runs-dir"] ?? "eval/runs");
	const id = typeof args.runs === "string" ? args.runs : runId("e1");
	const extraArgs = args["pi-arg"] ? (Array.isArray(args["pi-arg"]) ? args["pi-arg"] : [args["pi-arg"]]) : [];
	const linkDirs = (typeof args["link-dirs"] === "string" ? args["link-dirs"].split(",") : undefined) ?? DEFAULT_LINK_DIRS;
	const briefChars = Number(args["brief-chars"] ?? 2000);

	if (!args.model && !args["allow-unpinned-model"] && !args["dry-run"]) {
		const suggested = await suggestModel();
		throw new Error(
			`--model is required: both arms must run the same model, or the comparison measures the model.${suggested ? ` Your configured default is ${suggested}.` : ""} Pass --allow-unpinned-model to override.`,
		);
	}

	const piCommand = args["dry-run"] ? { command: "pi", prefix: [], source: "dry-run" } : await resolvePiCommand(args["pi-bin"]);
	const cards = [];
	for (const cardPath of (Array.isArray(args.tasks) ? args.tasks : [args.tasks]).map((card) => resolve(card))) cards.push(await readJson(cardPath));

	console.log(`run ${id} · ${cards.length} task(s) · arms ${arms.join(",")} · ${repeats} repeat(s) · model ${args.model ?? "(unpinned)"}`);
	if (!args["dry-run"]) await mkdir(join(runsDir, id), { recursive: true });

	let agentDirs = {};
	const briefs = new Map();
	if (!args["dry-run"]) {
		console.log(`  pi: ${piCommand.command}${piCommand.prefix.length ? ` ${piCommand.prefix.join(" ")}` : ""}${piCommand.version ? ` (v${piCommand.version}, ${piCommand.source})` : ""}`);
		const home = join(runsDir, id, "agent");
		agentDirs = { wiki: join(home, "wiki"), off: join(home, "off"), brief: join(home, "off") };
		const wikiAgent = await prepareAgentDir({ target: agentDirs.wiki, excludePackages: [] });
		const controlAgent = await prepareAgentDir({ target: agentDirs.off, excludePackages: [WIKI_PACKAGE] });
		console.log(`  agent dirs: control excludes [${controlAgent.removedPackages.join(", ") || "nothing"}]; every other package, tool and skill stays loaded`);
		if (wikiAgent.isolated.length > 0) console.log(`  per-run state: ${wikiAgent.isolated.join(", ")} — no run inherits another run's index or session`);
		if (controlAgent.removedPackages.length === 0) {
			throw new Error(`${WIKI_PACKAGE} is not in the agent's package list, so the control arm cannot be built by removing it — refusing to run, because disabling all extensions would make the control a less capable agent.`);
		}

		const pre = await preflight({ piCommand, dir: join(runsDir, id), agentDir: agentDirs, model: args.model, arms });
		const wikiTools = pre.wiki?.tools ?? [];
		const offTools = pre.off?.tools ?? [];
		for (const arm of arms) console.log(`  preflight ${arm}: ${pre[arm].tools.length} tool(s), wiki tools ${pre[arm].hasWikiTools ? "present" : "absent"}${pre[arm].timedOut ? " · TIMED OUT" : ""}`);
		if (wikiTools.length === 0 || offTools.length === 0) {
			if (!args["allow-unverified-arm"]) throw new Error("preflight could not read a tool loadout, so the arms cannot be compared — pass --allow-unverified-arm to run anyway");
		} else if (arms.includes("wiki") && arms.includes("off")) {
			const comparison = compareToolsets(offTools, wikiTools);
			console.log(
				`  fairness: arms share ${comparison.sharedCount} non-wiki tool(s); wiki arm adds ${comparison.wikiToolCount} wiki tool(s)${comparison.comparable ? " — comparable" : " — NOT COMPARABLE"}`,
			);
			if (!comparison.comparable) {
				console.log(`    only in off:  ${comparison.onlyOff.join(", ") || "(none)"}`);
				console.log(`    only in wiki: ${comparison.onlyWiki.join(", ") || "(none)"}`);
				if (!args["allow-unverified-arm"]) throw new Error("the arms do not load the same tools apart from the wiki — refusing to measure a confounded comparison");
			}
		}
		if (arms.includes("brief")) {
			// Built per task, from that task's base commit: one brief for the whole run would be wrong for
			// a second repository, and reading it from the working tree would hand the arm hindsight.
			for (const card of cards) {
				const built = await buildBrief({ repo: card.repo, base: card.base, wikiRoot: card.wikiRoot ?? "docs/wiki", maxChars: briefChars });
				briefs.set(card.id, built.text);
				console.log(`  brief arm: ${card.id} — ${built.pages} page(s), ${built.text.length} char(s), read from ${card.base.slice(0, 8)}`);
			}
		}
	}

	for (const task of cards) {
		if (!task.testCommand && !args["dry-run"]) console.warn(`warning: ${task.id} has no testCommand — the run will not be graded`);
		const taskLinkDirs = Array.isArray(task.linkDirs) && task.linkDirs.length > 0 ? task.linkDirs : linkDirs;
		// Rotate the arm order per task: a fixed order always runs the wiki arm last, so any drift in the
		// provider or the machine over a long session would land on one arm.
		const taskIndex = cards.indexOf(task);
		const orderedArms = arms.map((_, offset) => arms[(offset + taskIndex) % arms.length]);
		for (const arm of orderedArms) {
			for (let repeat = 1; repeat <= repeats; repeat += 1) {
				const label = `${task.id} · ${arm} · rep${repeat}`;
				if (args["dry-run"]) {
					console.log(`  would run: ${label} in a copy of ${task.repo} @ ${task.base.slice(0, 10)} (target ${task.target?.slice(0, 10) ?? "—"}, wiki ${arm === "wiki" ? "present" : "absent"})`);
					continue;
				}
				const copy = join(runsDir, id, "copies", `${task.id}-${arm}-rep${repeat}`);
				const startedAt = nowIso();
				const slug = `${task.id}-${arm}-rep${repeat}`;
				const runStart = Date.now();
				console.log(`  ${label}: preparing a copy of ${task.repo} @ ${task.base.slice(0, 8)}`);
				const environment = await prepareTaskCopy({ task, dir: copy, arm, linkDirs: taskLinkDirs, link: !args["copy-deps"] });
				if (environment.targetReachable) throw new Error(`${task.id}: the target commit is still reachable inside the task copy — refusing to run`);
				// The two wiki arms differ in one thing only: how much upkeep the wiki does for itself.
				const capture = arm === "wiki-nocapture" ? await configureCapture({ task, copy, cadence: "manual" }) : null;
				const grader = await protectGrader({ task, copy });
				const graders = await installGraders({ task, copy });
				const depsBefore = await fingerprint(task.repo, taskLinkDirs);

				console.log(
					`  ${label}: running pi (wiki files ${environment.wikiPresent ? "present" : "absent"}, deps ${environment.deps.map((dep) => `${dep.name}:${dep.mode}`).join(" ") || "none"}, grader restored ${grader.restored.length}, hidden graders ${graders.length})`,
				);
				const { result, sessionDir, loadout } = await runArm({
					task,
					arm,
					repeat,
					copy,
					piCommand,
					agentDir: agentDirs[arm] ?? agentDirs.off,
					brief: arm === "brief" ? briefs.get(task.id) ?? "" : "",
					model: args.model,
					thinking: args.thinking,
					extraArgs,
					runsDir: join(runsDir, id),
					timeoutMinutes: task.timeoutMinutes,
				});
				const grading = await gradeRun({ task, copy, runsDir: join(runsDir, id), label: slug });
				const depsAfter = await fingerprint(task.repo, taskLinkDirs);
				const sharedDepsChanged = taskLinkDirs.filter((name) => depsBefore[name] !== depsAfter[name]);
				if (sharedDepsChanged.length > 0) {
					console.log(`      ! shared dependencies changed during this run: ${sharedDepsChanged.join(", ")} — later runs now have a different environment`);
				}
				const metrics = await measure({ copy, sessionDir });
				const diff = await diffStats(copy);
				const row = {
					runId: id,
					task: task.id,
					arm,
					repeat,
					armOrder: orderedArms.join(","),
					repo: task.repo,
					base: task.base,
					target: task.target ?? null,
					startedAt,
					endedAt: nowIso(),
					wallMs: result.wallMs,
					exitCode: result.exitCode,
					timedOut: result.timedOut,
					model: args.model ?? null,
					thinkingLevel: loadout.thinkingLevel,
					armVerified: { expectedWikiTools: keepsWiki(arm), observedWikiTools: loadout.hasWikiTools, tools: loadout.tools.length },
					environment: { ...environment, capture, graderRestored: grader.restored, gradersInstalled: graders, sharedDepsChanged, agentPackagesRemoved: keepsWiki(arm) ? [] : [WIKI_PACKAGE] },
					grading,
					diff,
					metrics,
					stdoutTail: result.stdout.slice(-500),
					stderrTail: result.stderr.slice(-500),
				};
				await appendJsonl(join(runsDir, id, "results.jsonl"), row);
				const elapsed = Math.round((Date.now() - runStart) / 1000);
				console.log(
					`  ${label}: done in ${elapsed}s — exit ${result.exitCode}${result.timedOut ? " (TIMEOUT)" : ""} · graded ${grading.passed === null ? "n/a" : grading.passed ? "pass" : "fail"} · $${(metrics.cost ?? 0).toFixed(4)} · wikiTools=${loadout.hasWikiTools}`,
				);
				if (loadout.hasWikiTools !== keepsWiki(arm) && !args["allow-unverified-arm"]) {
					throw new Error(`${label}: the ${arm} arm loaded the wrong tool set (wiki tools ${loadout.hasWikiTools ? "present" : "absent"}) — stopping so an invalid comparison is not measured`);
				}
				if (!args["keep-copies"]) await rm(copy, { recursive: true, force: true });
			}
		}
	}
	if (!args["dry-run"]) console.log(`\nresults: ${join(runsDir, id, "results.jsonl")}\nreport:  node eval/report.mjs --run ${id}`);
}

main().catch((error) => {
	console.error(`run failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
