#!/usr/bin/env node
/**
 * The A/B runner: one task, up to four arms, each in a throwaway copy of the repository.
 *
 * Fairness is enforced rather than assumed, and checked from the agent's side, because R1 showed that
 * guarantees which hold for each helper can still fail in the runner that composes them:
 *
 *   1. the answer is unreachable: refs and target pruned, no remote to fetch them back from, and no
 *      hidden grader in the copy until the agent has finished;
 *   2. the agent cannot find the harness or its own arm: the copy and the agent dir live under neutral
 *      temp paths, the agent dir carries no wiki registry and (by default) no user context, and the
 *      copy leaves out the card's notes about the experiment;
 *   3. the arms differ in exactly one thing — the wiki — proven by comparing their tool loadouts;
 *   4. every arm is graded identically after the fact, and its session is scanned for anything it
 *      should not have reached; a contaminated run is recorded as such and kept out of the statistics.
 *
 * Usage:
 *   node eval/run.mjs --tasks eval/tasks/ds-001.json --arms off,wiki --model <id> \
 *                     [--repeats 1] [--dry-run] [--runs-dir eval/runs] [--runs <id>] [--resume]
 *                     [--pi-bin <path>] [--pi-arg <value>] [--link-dirs a,b] [--copy-deps]
 *                     [--user-context none|real] [--keep-copies] [--allow-unverified-arm]
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProject } from "../packages/pi-wiki-eval/dist/core/analyze.js";
import { isWikiCall, wikiCallKind } from "../packages/pi-wiki-eval/dist/core/classify.js";
import {
	assertCanary,
	buildBrief,
	compareToolsets,
	configureCapture,
	defaultAgentDir,
	depsSignature,
	graderLeaks,
	installGraders,
	jevUsage,
	keepsWiki,
	prepareAgentDir,
	prepareTaskCopy,
	protectGrader,
	qualitySignals,
	savePatch,
	scanSession,
	shellCommand,
	taskMentions,
	TEST_PATTERN,
} from "./arms.mjs";
import { appendJsonl, git, isValidRow, nowIso, parseArgs, readJson, readJsonl, resolvePiCommand, runId, spawnCapture } from "./lib.mjs";

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARMS = ["off", "brief", "wiki", "wiki-nocapture"];
/** Dependency directories a clone will not have. */
const DEFAULT_LINK_DIRS = ["node_modules", "web/node_modules", ".venv"];
const WIKI_PACKAGE = "pi-jev-wiki";

/**
 * What pi persisted about one run: the tool loadout from the session's first system message, the
 * thinking level, and the cost of wiki upkeep — assistant messages that called a wiki write tool. That
 * is a lower bound: the turns reading those tools' results are upkeep too.
 */
async function readSession(sessionDir) {
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
	const upkeep = { messages: 0, cost: 0 };
	if (files.length === 0) return { sessionFile: undefined, tools: [], hasWikiTools: false, thinkingLevel: null, upkeep };
	const newest = (await Promise.all(files.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })))).sort((a, b) => b.mtime - a.mtime)[0];
	const tools = [];
	let thinkingLevel = null;
	for (const line of (await readFile(newest.file, "utf8")).split(/\r?\n/)) {
		if (!line.trim()) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type === "thinking_level_change" && entry.thinkingLevel) thinkingLevel = entry.thinkingLevel;
		const message = entry?.type === "message" ? entry.message : undefined;
		if (message?.role === "system" && message.sections?.tools) {
			for (const match of String(message.sections.tools).matchAll(/^- ([a-zA-Z0-9_]+):/gm)) tools.push(match[1]);
		}
		if (message?.role === "assistant" && (message.content ?? []).some((part) => part?.type === "toolCall" && isWikiCall(part.name) && wikiCallKind(part.name) === "write")) {
			upkeep.messages += 1;
			upkeep.cost += message.usage?.cost?.total ?? 0;
		}
	}
	return { sessionFile: newest.file, tools, hasWikiTools: tools.some(isWikiCall), thinkingLevel, upkeep };
}

/** What each arm must have loaded. A broken arm looks exactly like a negative result. */
function loadoutProblem(arm, tools) {
	const wiki = tools.filter(isWikiCall);
	if (!keepsWiki(arm)) return wiki.length > 0 ? `the ${arm} arm loaded wiki tools (${wiki.join(", ")})` : null;
	if (wiki.length === 0) return `the ${arm} arm loaded no wiki tools`;
	const writes = wiki.filter((tool) => wikiCallKind(tool) === "write");
	if (arm === "wiki-nocapture" && writes.length > 0) return `the read-only wiki arm still has wiki write tools (${writes.join(", ")})`;
	return null;
}

/** One tiny call per arm, to prove each environment before anything is measured. */
async function preflight({ piCommand, dir, model, arms, userContext, argsFor }) {
	const results = {};
	for (const arm of arms) {
		const home = join(dir, "preflight", arm);
		await mkdir(home, { recursive: true });
		const agentDir = await mkdtemp(join(tmpdir(), "ag-"));
		try {
			await prepareAgentDir({ target: agentDir, excludePackages: keepsWiki(arm) ? [] : [WIKI_PACKAGE], userContext });
			const sessionDir = join(home, "sessions");
			const args = [...piCommand.prefix, "-p", "Reply with exactly: ok", "--session-dir", sessionDir, ...(model ? ["--model", model] : []), ...argsFor(arm)];
			const run = await spawnCapture(piCommand.command, args, {
				cwd: home,
				timeoutMs: 120_000,
				shell: piCommand.shell,
				logPath: join(home, "preflight.log"),
				env: { PI_CODING_AGENT_DIR: agentDir },
			});
			results[arm] = { ...(await readSession(sessionDir)), exitCode: run.exitCode, timedOut: run.timedOut };
		} finally {
			await rm(agentDir, { recursive: true, force: true });
		}
	}
	return results;
}

async function runArm({ prompt, copy, piCommand, agentDir, model, thinking, extraArgs, sessionDir, logPath, budgetMs }) {
	await mkdir(sessionDir, { recursive: true });
	const args = [...piCommand.prefix, "-p", prompt, "--session-dir", sessionDir];
	if (model) args.push("--model", model);
	if (thinking) args.push("--thinking", thinking);
	args.push(...extraArgs);
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
	return { result, session: await readSession(sessionDir) };
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
		// The exact session directory of this attempt: matching on the copy's path alone would add a
		// crashed earlier attempt's cost to its re-run.
		const analysis = await analyzeProject({ projectDir: copy, sessionDir });
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

/** Over the staged tree (`savePatch` stages everything), so files the agent created count too. */
async function diffStats(dir, wikiRoot) {
	const paths = (await git(dir, ["diff", "--cached", "--name-only", "HEAD"], { allowFailure: true })).split(/\r?\n/).filter(Boolean);
	const numstat = await git(dir, ["diff", "--cached", "--numstat", "HEAD"], { allowFailure: true });
	let insertions = 0;
	let deletions = 0;
	for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
		const [added, removed] = line.split("\t");
		insertions += Number(added) || 0;
		deletions += Number(removed) || 0;
	}
	const tooling = paths.filter((path) => path.startsWith(`${wikiRoot}/`) || path.startsWith(".pi/"));
	return {
		filesChanged: paths.length,
		codeFilesChanged: paths.length - tooling.length,
		toolingFilesChanged: tooling.length,
		insertions,
		deletions,
		paths: paths.slice(0, 40),
		testFilesChanged: paths.filter((path) => TEST_PATTERN.test(path)),
	};
}

/**
 * Locations no arm has any business reaching. Each was reached in R1: the harness (task cards, graders,
 * results), the source repository (its live working tree), the user's other wikis and sessions.
 */
async function forbiddenLocations({ runsDir, cards }) {
	const agent = defaultAgentDir();
	const out = [harnessRoot, runsDir, join(agent, "sessions"), join(agent, "AGENTS.md"), join(agent, "jev-wiki", "wikis.json"), ...cards.map((card) => card.repo)];
	try {
		for (const wiki of (await readJson(join(agent, "jev-wiki", "wikis.json"))).wikis ?? []) if (wiki?.root) out.push(wiki.root);
	} catch {
		/* no registry */
	}
	return [...new Set(out)];
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
				"       [--arms off,brief,wiki,wiki-nocapture] [--repeats 1] [--runs-dir eval/runs] [--runs <id>] [--resume]",
				"       [--pi-bin <path>] [--pi-arg <value>] [--link-dirs a,b] [--copy-deps] [--user-context none|real]",
				"       [--brief-chars 20000] [--keep-copies] [--allow-unpinned-model] [--allow-unverified-arm] [--dry-run]",
				"",
				"Each task card: { id, repo, base, target, prompt, testCommand, graderFiles, canary, excludePaths, wikiRoot, timeoutMinutes, linkDirs }",
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
	const briefChars = Number(args["brief-chars"] ?? 20000);
	const userContext = args["user-context"] ?? "none";
	if (!["none", "real"].includes(userContext)) throw new Error(`--user-context must be none or real, not ${userContext}`);

	if (!args.model && !args["allow-unpinned-model"] && !args["dry-run"]) {
		const suggested = await suggestModel();
		throw new Error(
			`--model is required: both arms must run the same model, or the comparison measures the model.${suggested ? ` Your configured default is ${suggested}.` : ""} Pass --allow-unpinned-model to override.`,
		);
	}

	const piCommand = args["dry-run"] ? { command: "pi", prefix: [], source: "dry-run" } : await resolvePiCommand(args["pi-bin"]);
	const cards = [];
	for (const cardPath of (Array.isArray(args.tasks) ? args.tasks : [args.tasks]).map((card) => resolve(card))) cards.push(await readJson(cardPath));
	// Free, and before anything is spent: a grader without its canary would leak undetected.
	for (const card of cards) await assertCanary(card);

	// With --resume, a run that died halfway continues instead of paying for the finished arms again. Only
	// valid rows count as finished: an arm that ran in the wrong environment is run again.
	const alreadyRun = new Set();
	if (args.resume === true) {
		let invalid = 0;
		for (const row of await readJsonl(join(runsDir, id, "results.jsonl"))) {
			if (isValidRow(row)) alreadyRun.add(`${row.task}|${row.arm}|${row.repeat}`);
			else invalid += 1;
		}
		if (alreadyRun.size > 0) console.log(`  resume: ${alreadyRun.size} valid run(s) already recorded will be skipped${invalid ? `; ${invalid} invalid row(s) will be run again` : ""}`);
	}

	console.log(`run ${id} · ${cards.length} task(s) · arms ${arms.join(",")} · ${repeats} repeat(s) · model ${args.model ?? "(unpinned)"} · user context ${userContext}`);
	if (!args["dry-run"]) await mkdir(join(runsDir, id), { recursive: true });

	const briefs = new Map();
	let argsFor = () => [];
	let forbidden = [];
	if (!args["dry-run"]) {
		console.log(`  pi: ${piCommand.command}${piCommand.prefix.length ? ` ${piCommand.prefix.join(" ")}` : ""}${piCommand.version ? ` (v${piCommand.version}, ${piCommand.source})` : ""}`);
		const probe = await mkdtemp(join(tmpdir(), "ag-"));
		const control = await prepareAgentDir({ target: probe, excludePackages: [WIKI_PACKAGE], userContext });
		await rm(probe, { recursive: true, force: true });
		if (control.removedPackages.length === 0) {
			throw new Error(`${WIKI_PACKAGE} is not in the agent's package list, so the control arm cannot be built by removing it — refusing to run, because disabling all extensions would make the control a less capable agent.`);
		}
		console.log(`  isolation: each run gets a fresh copy and agent dir under ${tmpdir()} (neutral names); no wiki registry; user context: ${userContext}${control.contextFilesSkipped.length ? ` (${control.contextFilesSkipped.join(", ")} left out)` : ""}`);
		forbidden = await forbiddenLocations({ runsDir, cards });

		const pre = await preflight({ piCommand, dir: join(runsDir, id), model: args.model, arms: ["off", "wiki"], userContext, argsFor });
		for (const arm of ["off", "wiki"]) console.log(`  preflight ${arm}: ${pre[arm].tools.length} tool(s), wiki tools ${pre[arm].hasWikiTools ? "present" : "absent"}${pre[arm].timedOut ? " · TIMED OUT" : ""}`);
		if (pre.wiki.tools.length === 0 || pre.off.tools.length === 0) {
			if (!args["allow-unverified-arm"]) throw new Error("preflight could not read a tool loadout, so the arms cannot be compared — pass --allow-unverified-arm to run anyway");
		} else {
			const comparison = compareToolsets(pre.off.tools, pre.wiki.tools);
			console.log(`  fairness: arms share ${comparison.sharedCount} non-wiki tool(s); wiki arm adds ${comparison.wikiToolCount} wiki tool(s)${comparison.comparable ? " — comparable" : " — NOT COMPARABLE"}`);
			if (!comparison.comparable) {
				console.log(`    only in off:  ${comparison.onlyOff.join(", ") || "(none)"}`);
				console.log(`    only in wiki: ${comparison.onlyWiki.join(", ") || "(none)"}`);
				if (!args["allow-unverified-arm"]) throw new Error("the arms do not load the same tools apart from the wiki — refusing to measure a confounded comparison");
			}
		}
		// The read-only wiki arm withholds every wiki write tool the treatment loads.
		const writeTools = pre.wiki.tools.filter((tool) => isWikiCall(tool) && wikiCallKind(tool) === "write");
		argsFor = (arm) => (arm === "wiki-nocapture" && writeTools.length > 0 ? ["--exclude-tools", writeTools.join(",")] : []);
		if (arms.includes("wiki-nocapture")) {
			const readOnly = (await preflight({ piCommand, dir: join(runsDir, id), model: args.model, arms: ["wiki-nocapture"], userContext, argsFor }))["wiki-nocapture"];
			const problem = loadoutProblem("wiki-nocapture", readOnly.tools);
			console.log(`  preflight wiki-nocapture: ${readOnly.tools.filter(isWikiCall).join(", ") || "no wiki tools"} (withheld: ${writeTools.length})`);
			if (problem && !args["allow-unverified-arm"]) throw new Error(`preflight: ${problem}`);
		}
		if (arms.includes("brief")) {
			// Built per task, from that task's base commit: one brief for the whole run would be wrong for
			// a second repository, and reading it from the working tree would hand the arm hindsight.
			for (const card of cards) {
				const built = await buildBrief({ repo: card.repo, base: card.base, wikiRoot: card.wikiRoot ?? "docs/wiki", maxChars: briefChars });
				briefs.set(card.id, built);
				console.log(`  brief arm: ${card.id} — ${built.source}, ${built.pages} page(s), ${built.chars} char(s)${built.truncated ? " (TRUNCATED)" : ""}, read from ${card.base.slice(0, 8)}`);
			}
		}
	}

	for (const task of cards) {
		if (!task.testCommand && !args["dry-run"]) console.warn(`warning: ${task.id} has no testCommand — the run will not be graded`);
		const taskLinkDirs = Array.isArray(task.linkDirs) && task.linkDirs.length > 0 ? task.linkDirs : linkDirs;
		const wikiRoot = (task.wikiRoot ?? "docs/wiki").replace(/\\/g, "/").replace(/\/+$/, "");
		const canaries = [task.canary].filter(Boolean);
		// Rotate the arm order per task: a fixed order always runs the wiki arm last, so any drift in the
		// provider or the machine over a long session would land on one arm.
		const taskIndex = cards.indexOf(task);
		const orderedArms = arms.map((_, offset) => arms[(offset + taskIndex) % arms.length]);
		for (const arm of orderedArms) {
			for (let repeat = 1; repeat <= repeats; repeat += 1) {
				const label = `${task.id} · ${arm} · rep${repeat}`;
				if (alreadyRun.has(`${task.id}|${arm}|${repeat}`)) {
					console.log(`  ${label}: already recorded, skipping`);
					continue;
				}
				if (args["dry-run"]) {
					console.log(`  would run: ${label} in a copy of ${task.repo} @ ${task.base.slice(0, 10)} (target ${task.target?.slice(0, 10) ?? "—"}, wiki ${keepsWiki(arm) ? "present" : "absent"})`);
					continue;
				}
				const slug = `${task.id}-${arm}-rep${repeat}`;
				const attempt = nowIso().replace(/[:.]/g, "-");
				const startedAt = nowIso();
				const runStart = Date.now();
				// Neutral paths. In R1 the copy lived at eval/runs/<run>/copies/<task>-<arm>-rep1: the agent's
				// cwd named the harness, the run and its own arm, and two directories up held every result.
				const workRoot = await mkdtemp(join(tmpdir(), "ws-"));
				const copy = join(workRoot, basename(task.repo));
				const agentDir = await mkdtemp(join(tmpdir(), "ag-"));
				try {
					console.log(`  ${label}: preparing a copy of ${task.repo} @ ${task.base.slice(0, 8)}`);
					const agent = await prepareAgentDir({ target: agentDir, excludePackages: keepsWiki(arm) ? [] : [WIKI_PACKAGE], userContext });
					const environment = await prepareTaskCopy({ task, dir: copy, arm, linkDirs: taskLinkDirs, link: !args["copy-deps"] });
					const capture = arm === "wiki-nocapture" ? await configureCapture({ copy, cadence: "manual" }) : null;
					// Seen from where the agent will stand, just before it starts.
					const refusals = [];
					if (environment.targetReachable) refusals.push("the target commit is reachable inside the copy");
					if (environment.remotes.length > 0) refusals.push(`the copy still has remotes (${environment.remotes.join(", ")})`);
					const leaked = await graderLeaks({ task, copy });
					if (leaked.length > 0) refusals.push(`hidden grader(s) already in the copy: ${leaked.join(", ")}`);
					const mentions = await taskMentions({ task, copy });
					if (mentions.length > 0) refusals.push(`the copy names the task or carries its canary (${mentions.join(", ")}) — add those paths to the card's excludePaths`);
					if (refusals.length > 0) throw new Error(`${label}: refusing to run — ${refusals.join("; ")}`);
					const depsBefore = await depsSignature(task.repo, taskLinkDirs);

					console.log(
						`  ${label}: running pi (wiki files ${environment.wikiPresent ? "present" : "absent"}${environment.sparse.length ? `, sparse ${environment.sparse.slice(1).join(" ")}` : ""}, deps ${environment.deps.map((dep) => `${dep.name}:${dep.mode}`).join(" ") || "none"}${argsFor(arm).length ? ", wiki write tools withheld" : ""})`,
					);
					const brief = arm === "brief" ? briefs.get(task.id) : undefined;
					const sessionDir = join(runsDir, id, "sessions", task.id, arm, `rep${repeat}-${attempt}`);
					const { result, session } = await runArm({
						prompt: brief ? `${brief.text}\n\n---\n\n${task.prompt}` : task.prompt,
						copy,
						piCommand,
						agentDir,
						model: args.model,
						thinking: args.thinking,
						extraArgs: [...extraArgs, ...argsFor(arm)],
						sessionDir,
						logPath: join(runsDir, id, "logs", `${slug}.log`),
						budgetMs: (task.timeoutMinutes ?? 5) * 60 * 1000,
					});

					// Everything that judges the agent's own work comes before any grader is in the tree.
					const { text: patchText, ...patch } = await savePatch({ copy, dir: join(runsDir, id), slug });
					const diff = await diffStats(copy, wikiRoot);
					const quality = await qualitySignals({ task, copy, dir: join(runsDir, id), slug, spawn: spawnCapture });
					const jev = keepsWiki(arm) ? await jevUsage({ copy, wikiRoot }) : { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
					// Only now does the agent's tree receive its grader.
					const grader = await protectGrader({ task, copy });
					const graders = await installGraders({ task, copy });
					const grading = await gradeRun({ task, copy, runsDir: join(runsDir, id), label: slug });
					const depsAfter = await depsSignature(task.repo, taskLinkDirs);
					const metrics = await measure({ copy, sessionDir });
					const contamination = await scanSession({ sessionFile: session.sessionFile, forbidden, canaries });

					const invalidReasons = [];
					const loadoutIssue = loadoutProblem(arm, session.tools);
					if (loadoutIssue) invalidReasons.push(loadoutIssue);
					if (!session.sessionFile) invalidReasons.push("pi wrote no session");
					if (metrics.error) invalidReasons.push(`measurement failed: ${metrics.error}`);
					const sharedDepsChanged = taskLinkDirs.filter((name) => depsBefore[name] !== depsAfter[name]);
					if (sharedDepsChanged.length > 0) invalidReasons.push(`shared dependencies changed during the run (${sharedDepsChanged.join(", ")})`);

					const row = {
						runId: id,
						task: task.id,
						arm,
						repeat,
						attempt,
						armOrder: orderedArms.join(","),
						repo: task.repo,
						base: task.base,
						target: task.target ?? null,
						prompt: task.prompt ?? null,
						wikiRoot,
						startedAt,
						endedAt: nowIso(),
						wallMs: result.wallMs,
						exitCode: result.exitCode,
						timedOut: result.timedOut,
						model: args.model ?? null,
						thinkingLevel: session.thinkingLevel,
						valid: invalidReasons.length === 0,
						invalidReasons,
						contamination,
						armVerified: { expectedWikiTools: keepsWiki(arm), observedWikiTools: session.hasWikiTools, tools: session.tools.length, wikiTools: session.tools.filter(isWikiCall) },
						agent: { userContext, contextFilesSkipped: agent.contextFilesSkipped, packagesRemoved: agent.removedPackages, toolsWithheld: argsFor(arm).length ? argsFor(arm)[1].split(",") : [] },
						brief: brief ? { source: brief.source, pages: brief.pages, chars: brief.chars, truncated: brief.truncated, sha: brief.sha } : null,
						environment: { ...environment, copyPath: copy, capture, graderRestored: grader.restored, gradersInstalled: graders, sharedDepsChanged },
						grading,
						diff,
						patch,
						quality,
						metrics,
						jev,
						upkeep: session.upkeep,
						stdoutTail: result.stdout.slice(-500),
						stderrTail: result.stderr.slice(-500),
					};
					await appendJsonl(join(runsDir, id, "results.jsonl"), row);
					const elapsed = Math.round((Date.now() - runStart) / 1000);
					console.log(
						`  ${label}: done in ${elapsed}s — exit ${result.exitCode}${result.timedOut ? " (TIMEOUT)" : ""} · graded ${grading.passed === null ? "n/a" : grading.passed ? "pass" : "fail"} · $${(metrics.cost ?? 0).toFixed(4)}${jev.calls ? ` + ${jev.calls} Jev call(s) (${jev.inputTokens} in)` : ""} · wiki tools ${session.tools.filter(isWikiCall).length} · patch ${patch.bytes}B${Object.keys(quality).length > 0 ? ` · quality ${Object.entries(quality).map(([name, value]) => `${name}:${value.passed ? "ok" : "FAIL"}`).join(" ")}` : ""}${contamination.clean ? "" : ` · CONTAMINATED (${contamination.reasons.join("; ")})`}`,
					);
					if (invalidReasons.length > 0 && !args["allow-unverified-arm"]) {
						throw new Error(`${label}: ${invalidReasons.join("; ")} — recorded as invalid (--resume runs it again); stopping so an invalid comparison is not measured`);
					}
				} finally {
					if (args["keep-copies"]) console.log(`      kept: ${copy} · agent dir ${agentDir}`);
					else {
						await rm(workRoot, { recursive: true, force: true });
						await rm(agentDir, { recursive: true, force: true });
					}
				}
			}
		}
	}
	if (!args["dry-run"]) console.log(`\nresults: ${join(runsDir, id, "results.jsonl")}\nreport:  node eval/report.mjs --run ${id}`);
}

main().catch((error) => {
	console.error(`run failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
