#!/usr/bin/env node
/**
 * Self-test for the fairness machinery: no model calls, no API cost, well under a minute.
 *
 * Two layers. The unit checks cover each helper: a control arm that quietly loses its web tools, a
 * checkout that reports the wiki as deleted, a clone that still contains the answer. The end-to-end
 * checks drive the real runner, report and judge with a stub pi (`stub-pi.mjs`) that records what an
 * agent standing in its working directory could see. In R1 every helper passed its unit check while
 * the composed pipeline handed every arm its grader; only the agent's-eye view catches that.
 *
 *   node eval/selftest.mjs
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertCanary,
	blindOrder,
	buildBrief,
	codeOnlyPatch,
	compareToolsets,
	configureCapture,
	depsSignature,
	graderLeaks,
	jevUsage,
	keepsWiki,
	linkDependencies,
	prepareAgentDir,
	prepareTaskCopy,
	savePatch,
	scanSession,
	sparseExclude,
	taskMentions,
} from "./arms.mjs";
import { git, gitOk, isValidRow, readJsonl, spawnCapture } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(here, "..");
let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function write(path, text) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text, "utf8");
}

async function commitAll(dir, message) {
	await git(dir, ["add", "-A"]);
	await git(dir, ["commit", "-qm", message]);
	return git(dir, ["rev-parse", "HEAD"]);
}

/** A testbed with everything R1 tripped over: raw captures in the wiki, notes naming the task, a tracked project config and ledger. */
async function makeRepo(root, taskId) {
	await write(join(root, ".gitignore"), "node_modules/\n.venv/\n");
	await write(join(root, "src", "a.js"), "export const a = 1;\n");
	await write(join(root, "docs", "wiki", "wiki", "architecture", "a.md"), '---\ntitle: Alpha page\nsummary: "One line."\n---\n\n# A\n');
	await write(join(root, "docs", "wiki", "wiki", "index.md"), "# Wiki Index\n\n| Page | Summary |\n|---|---|\n| [Alpha page](architecture/a.md) | One line. |\n");
	await write(join(root, "docs", "wiki", "raw", "sessions", "2026-10-01-s.md"), "---\ntitle: Session capture 2026-10-01 (tool)\n---\n");
	await write(join(root, "docs", "wiki", ".jev-wiki", "decisions.jsonl"), `${JSON.stringify({ op: "base", usage: { input_tokens: 5, output_tokens: 1 } })}\n`);
	await write(join(root, ".pi", "jev-wiki.json"), '{ "capture": { "cadence": "task" } }\n');
	await write(join(root, "handoffs", "notes.md"), `The eval card ${taskId}, and what its grader checks.\n`);
	// A quality command that fails if any grader is already in the tree — without naming the task.
	await write(
		join(root, "scripts", "no-grader.mjs"),
		'import { existsSync, readdirSync, readFileSync } from "node:fs";\nconst files = existsSync("tests") ? readdirSync("tests") : [];\nprocess.exit(files.some((file) => readFileSync(`tests/${file}`, "utf8").includes("eval-canary:")) ? 1 : 0);\n',
	);
	await git(root, ["init", "-q", "-b", "main"]);
	await git(root, ["config", "user.email", "self@test"]);
	await git(root, ["config", "user.name", "selftest"]);
	const base = await commitAll(root, "base");
	// The answer, on a branch, so the leak check has something to prune.
	await git(root, ["checkout", "-q", "-b", "eval/t1"]);
	await write(join(root, "src", "a.js"), "export const a = 2;\n");
	const target = await commitAll(root, "answer");
	await git(root, ["checkout", "-q", "main"]);
	return { base, target };
}

/** A user's agent dir, with the machine-wide knowledge an arm must not inherit. */
async function makeAgent(root, secretWiki) {
	const dir = join(root, "agent-src");
	await write(join(dir, "npm", "big.txt"), "store\n");
	await write(join(dir, "jev-wiki", "models", "cache.bin"), "model cache\n");
	await write(join(dir, "jev-wiki", "vector", "index.db"), "derived index\n");
	await write(join(dir, "jev-wiki", "wikis.json"), `${JSON.stringify({ wikis: [{ name: "secret", root: secretWiki }] })}\n`);
	await write(join(dir, "auth.json"), "{}\n");
	await write(join(dir, "AGENTS.md"), "the user's own context\n");
	await write(join(dir, "settings.json"), `${JSON.stringify({ defaultModel: "m", packages: ["npm:pi-web-access", "npm:pi-jev-wiki@latest", "npm:@dietrichgebert/ponytail"] }, null, 2)}\n`);
	await write(join(dir, "sessions", "s.jsonl"), "{}\n");
	return dir;
}

const norm = (value) => String(value).replace(/\\+/g, "/").toLowerCase();
const root = await mkdtemp(join(tmpdir(), "eval-selftest-"));
try {
	// --- toolset comparison -------------------------------------------------------------------
	const same = compareToolsets(["read", "bash", "web_search"], ["read", "bash", "web_search", "wiki_ask", "wiki_toc"]);
	check("identical non-wiki tools compare equal", same.comparable === true);
	check("wiki tools are excluded from the comparison", same.sharedCount === 3 && same.wikiToolCount === 2);
	const missing = compareToolsets(["read", "bash"], ["read", "bash", "web_search", "wiki_ask"]);
	check("a tool missing from the control is caught", missing.comparable === false && missing.onlyWiki.includes("web_search"));
	const extra = compareToolsets(["read", "mcp_notion"], ["read", "wiki_ask"]);
	check("a tool present only in the control is caught", extra.comparable === false && extra.onlyOff.includes("mcp_notion"));

	// --- agent directory ----------------------------------------------------------------------
	const fakeAgent = await makeAgent(root, join(root, "secret-wiki"));
	const control = await prepareAgentDir({ source: fakeAgent, target: join(root, "agent-off"), excludePackages: ["pi-jev-wiki"] });
	const controlSettings = JSON.parse(await readFile(join(control.dir, "settings.json"), "utf8"));
	check("the wiki package is removed from the control", control.removedPackages.length === 1 && control.removedPackages[0].includes("pi-jev-wiki"));
	check("every other package stays in the control", controlSettings.packages.length === 2 && controlSettings.packages.some((p) => String(p).includes("pi-web-access")));
	check("sessions are not carried into an arm", !existsSync(join(control.dir, "sessions")));
	check("large directories are linked, not copied", control.linked.includes("npm"));
	check("the embedding-model cache is linked, not copied", control.linked.includes("jev-wiki/models"));
	check("a stale derived index is NOT carried into a run", !existsSync(join(control.dir, "jev-wiki", "vector")));
	check("the user's wiki registry is NOT carried into an arm", !existsSync(join(control.dir, "jev-wiki", "wikis.json")));
	check("the user's context file is left out by default", !existsSync(join(control.dir, "AGENTS.md")) && control.contextFilesSkipped.includes("AGENTS.md"));
	const realContext = await prepareAgentDir({ source: fakeAgent, target: join(root, "agent-real"), excludePackages: [], userContext: "real" });
	check("userContext real keeps the user's context file", existsSync(join(realContext.dir, "AGENTS.md")));
	const treated = await prepareAgentDir({ source: fakeAgent, target: join(root, "agent-wiki"), excludePackages: [] });
	const treatedSettings = JSON.parse(await readFile(join(treated.dir, "settings.json"), "utf8"));
	check("the treatment keeps every package", treatedSettings.packages.length === 3);
	check("nothing is reported removed for the treatment", treated.removedPackages.length === 0);
	check("wiki arms keep the wiki", keepsWiki("wiki") && keepsWiki("wiki-nocapture"));
	check("control arms do not", !keepsWiki("off") && !keepsWiki("brief"));

	// --- the copy: sparse checkout, leak pruning, remotes ------------------------------------------
	const taskId = "st-001";
	const canary = "EVAL-CANARY-selftest-7d2e";
	const repo = join(root, "testbed");
	const { base, target } = await makeRepo(repo, taskId);
	const card = { id: taskId, repo, base, target, wikiRoot: "docs/wiki", excludePaths: ["handoffs"], canary };
	const offCopy = join(root, "copy-off");
	const offEnv = await prepareTaskCopy({ task: card, dir: offCopy, arm: "off" });
	check("sparse patterns exclude the wiki and the experiment's notes", offEnv.sparse.join(" ") === "/* !/docs/wiki !/handoffs", offEnv.sparse.join(" "));
	check("the wiki directory is gone from the control copy", !existsSync(join(offCopy, "docs", "wiki")));
	check("notes about the experiment are gone from the copy", !existsSync(join(offCopy, "handoffs")));
	check("the control copy has a clean working tree", (await git(offCopy, ["status", "--porcelain"])) === "");
	check("the answer commit is unreachable inside the copy", offEnv.targetReachable === false && !(await gitOk(offCopy, ["cat-file", "-e", `${target}^{commit}`])));
	check("the copy has no remote to fetch the answer back from", offEnv.remotes.length === 0 && (await git(offCopy, ["remote"])) === "");
	check("the base commit is still checked out", (await git(offCopy, ["rev-parse", "HEAD"])) === base);
	check("excluded notes do not count as mentions of the task", (await taskMentions({ task: card, copy: offCopy })).length === 0);
	const wikiCopy = join(root, "copy-wiki");
	await prepareTaskCopy({ task: card, dir: wikiCopy, arm: "wiki" });
	check("the wiki arm keeps the wiki", existsSync(join(wikiCopy, "docs", "wiki", "wiki", "index.md")));
	const leakyCopy = join(root, "copy-leaky");
	await prepareTaskCopy({ task: { ...card, excludePaths: [] }, dir: leakyCopy, arm: "wiki" });
	check("notes naming the task are found when not excluded", (await taskMentions({ task: card, copy: leakyCopy })).includes("handoffs/notes.md"));
	check("no sparse checkout when nothing is excluded", (await sparseExclude({ dir: leakyCopy, git, paths: [] })).length === 0);

	// --- capture configuration ------------------------------------------------------------------
	const capture = await configureCapture({ copy: wikiCopy, cadence: "manual" });
	check("the no-capture arm sets a manual cadence", JSON.parse(await readFile(join(wikiCopy, ".pi", "jev-wiki.json"), "utf8")).capture.cadence === "manual");
	check("the harness's config edit is invisible to the agent's git status", capture.hidden === "assume-unchanged" && (await git(wikiCopy, ["status", "--porcelain"])) === "", capture.hidden);

	// --- dependencies -----------------------------------------------------------------------------
	await write(join(repo, "node_modules", "pkg", "index.js"), "// dep\n");
	const linked = await linkDependencies({ sourceRepo: repo, dir: offCopy, names: ["node_modules"], link: true });
	check("dependencies are made available to the copy", linked.length === 1 && existsSync(join(offCopy, "node_modules", "pkg", "index.js")));
	check("existing dependencies are left alone", (await linkDependencies({ sourceRepo: repo, dir: offCopy, names: ["node_modules"], link: true })).length === 0);
	const copied = await linkDependencies({ sourceRepo: repo, dir: join(root, "copy2"), names: ["node_modules"], link: false });
	check("copy mode also works", copied.length === 1 && existsSync(join(root, "copy2", "node_modules", "pkg", "index.js")));
	const depsBefore = await depsSignature(repo, ["node_modules", ".venv"]);
	await write(join(repo, "node_modules", "added", "index.js"), "// installed mid-run\n");
	const depsAfter = await depsSignature(repo, ["node_modules", ".venv"]);
	check("a package installed into the shared store changes its signature", depsBefore.node_modules !== depsAfter.node_modules && depsAfter[".venv"] === null);

	// --- brief --------------------------------------------------------------------------------------
	const brief = await buildBrief({ repo, base, wikiRoot: "docs/wiki" });
	check("the brief is the wiki's own index at the base commit", brief.source === "index.md" && brief.text.includes("Alpha page") && brief.fromCommit === base);
	check("the brief carries no raw session captures", !brief.text.includes("Session capture"));
	check("the brief records its size and hash", brief.chars === brief.text.length && brief.sha.length === 12 && brief.truncated === false);
	const bare = join(root, "bare");
	await write(join(bare, "docs", "wiki", "wiki", "architecture", "a.md"), '---\ntitle: Alpha page\nsummary: "One line."\n---\n');
	await write(join(bare, "docs", "wiki", "raw", "sessions", "s.md"), "---\ntitle: Session capture 2026-10-01 (tool)\n---\n");
	await git(bare, ["init", "-q", "-b", "main"]);
	await git(bare, ["config", "user.email", "self@test"]);
	await git(bare, ["config", "user.name", "selftest"]);
	const bareBase = await commitAll(bare, "base");
	const fallback = await buildBrief({ repo: bare, base: bareBase, wikiRoot: "docs/wiki" });
	check("without an index the brief lists pages, never raw sources", fallback.source === "frontmatter" && fallback.text.includes("Alpha page") && !fallback.text.includes("Session capture"));

	// --- graders and canaries --------------------------------------------------------------------
	const graderPath = join(root, "graders", `${taskId}.test.mjs`);
	await write(graderPath, `// eval-canary: ${canary}\nimport { existsSync } from "node:fs";\nprocess.exit(existsSync("src/stub-work.js") ? 0 : 1);\n`);
	const graded = { ...card, graderFiles: [{ from: graderPath, to: `tests/${taskId}.test.mjs` }] };
	check("a card whose graders carry its canary is accepted", await assertCanary(graded).then(() => true, () => false));
	check("a grader without the card's canary is refused", await assertCanary({ ...graded, canary: "EVAL-CANARY-other" }).then(() => false, () => true));
	check("a card with graders but no canary is refused", await assertCanary({ ...graded, canary: undefined }).then(() => false, () => true));
	check("a clean copy has no grader in it", (await graderLeaks({ task: graded, copy: offCopy })).length === 0);
	await write(join(offCopy, "tests", `${taskId}.test.mjs`), await readFile(graderPath, "utf8"));
	check("a grader already in the copy is caught before the agent starts", (await graderLeaks({ task: graded, copy: offCopy })).includes(`tests/${taskId}.test.mjs`));
	await rm(join(offCopy, "tests"), { recursive: true, force: true });

	// --- patches, Jev usage, the session scan -----------------------------------------------------
	await write(join(wikiCopy, "src", "written-by-an-arm.js"), "export const touched = true;\n");
	await write(join(wikiCopy, "docs", "wiki", "wiki", "notes", "n.md"), "---\ntitle: N\n---\n");
	await writeFile(join(wikiCopy, "docs", "wiki", ".jev-wiki", "decisions.jsonl"), `${await readFile(join(wikiCopy, "docs", "wiki", ".jev-wiki", "decisions.jsonl"), "utf8")}${JSON.stringify({ op: "run", usage: { input_tokens: 300, output_tokens: 30 } })}\n`);
	const patch = await savePatch({ copy: wikiCopy, dir: join(root, "patch-out"), slug: "t-1" });
	check("the arm's diff is preserved next to the results", existsSync(join(root, "patch-out", patch.path)) && patch.text.includes("written-by-an-arm"));
	check("the harness's hidden config never reaches the patch", !patch.text.includes(".pi/jev-wiki.json"));
	const code = codeOnlyPatch(patch.text, { excludePrefixes: ["docs/wiki", ".pi"] });
	check("the judge's diff keeps the code", code.kept.includes("src/written-by-an-arm.js") && code.text.includes("written-by-an-arm"));
	check("the judge's diff drops the wiki's own files", code.dropped.some((path) => path.startsWith("docs/wiki/")) && !code.text.includes("docs/wiki/"));
	const usage = await jevUsage({ copy: wikiCopy, wikiRoot: "docs/wiki" });
	check("Jev usage counts only the calls this run added to the ledger", usage.calls === 1 && usage.inputTokens === 300 && usage.outputTokens === 30, JSON.stringify(usage));

	const wanderSession = join(root, "wander.jsonl");
	await writeFile(
		wanderSession,
		[
			{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "1", name: "bash", arguments: { command: `cat ${join(harnessRoot, "eval", "tasks", "ds-001.json")}` } }] } },
			{ type: "message", message: { role: "toolResult", toolCallId: "1", content: [{ type: "text", text: `// eval-canary: ${canary}` }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "2", name: "bash", arguments: { command: "cd /c/Elsewhere/source && git log" } }] } },
		]
			.map((entry) => JSON.stringify(entry))
			.join("\n"),
		"utf8",
	);
	const scan = await scanSession({ sessionFile: wanderSession, forbidden: [harnessRoot, "C:\\Elsewhere\\source"], canaries: [canary] });
	check("a tool call that reaches the harness is caught", scan.reasons.some((reason) => reason.includes("reached") && reason.includes(norm(harnessRoot))), JSON.stringify(scan.reasons));
	check("a POSIX-style path to a forbidden location is caught", scan.reasons.some((reason) => reason.includes("/c/elsewhere/source")), JSON.stringify(scan.reasons));
	check("a canary in a tool result is caught", scan.reasons.some((reason) => reason.includes("canary")));
	const ordinary = join(root, "ordinary.jsonl");
	await writeFile(ordinary, JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "src/a.js" } }] } }), "utf8");
	check("an ordinary session is clean", (await scanSession({ sessionFile: ordinary, forbidden: [harnessRoot], canaries: [canary] })).clean);

	// --- validity ------------------------------------------------------------------------------------
	check("a legacy row whose arm had the wrong tools is invalid", !isValidRow({ armVerified: { expectedWikiTools: true, observedWikiTools: false } }));
	check("a legacy row whose arm had the right tools is valid", isValidRow({ armVerified: { expectedWikiTools: false, observedWikiTools: false } }));
	check("an explicit invalid flag wins", !isValidRow({ valid: false, armVerified: { expectedWikiTools: true, observedWikiTools: true } }));

	// --- blinding -----------------------------------------------------------------------------------
	const blindA = blindOrder(["off", "brief", "wiki"], "run:task");
	check("blinding is deterministic for the same run and task", blindA.join(",") === blindOrder(["off", "brief", "wiki"], "run:task").join(","));
	check("blinding labels every arm exactly once", [...blindA].sort().join(",") === "brief,off,wiki");
	const orders = new Set(["t1", "t2", "t3", "t4", "t5", "t6"].map((task) => blindOrder(["off", "brief", "wiki"], `run:${task}`).join(",")));
	check("blinding varies across tasks", orders.size > 1, `every task produced the same order: ${[...orders][0]}`);

	// --- spawning -----------------------------------------------------------------------------------
	const logPath = join(root, "not-created-yet", "logs", "run.log");
	const ran = await spawnCapture(process.execPath, ["-e", "console.log('hello from child')"], { cwd: root, logPath, timeoutMs: 30_000 });
	check("a spawned command reports its exit code", ran.exitCode === 0);
	check("the log directory is created for the caller", existsSync(logPath));
	check("the log holds the child's output", (await readFile(logPath, "utf8")).includes("hello from child"));

	// --- end to end: the real runner, report and judge, driven by a stub pi --------------------------
	const cardPath = join(root, "card.json");
	await writeFile(
		cardPath,
		JSON.stringify({ ...graded, prompt: "Add src/stub-work.js exporting work.", testCommand: `node tests/${taskId}.test.mjs`, qualityCommands: { nograder: "node scripts/no-grader.mjs" }, timeoutMinutes: 1, linkDirs: ["node_modules"] }),
		"utf8",
	);
	const runsDir = join(root, "runs");
	const probePath = join(root, "probe.jsonl");
	const stub = join(here, "stub-pi.mjs");
	const stubEnv = { PI_CODING_AGENT_DIR: fakeAgent, EVAL_STUB_PROBE: probePath, EVAL_STUB_CANARY: canary };
	const runner = (runs, arms, extraEnv = {}) =>
		spawnCapture(process.execPath, [join(here, "run.mjs"), "--tasks", cardPath, "--arms", arms, "--model", "stub", "--pi-bin", stub, "--runs-dir", runsDir, "--runs", runs], {
			cwd: harnessRoot,
			env: { ...stubEnv, ...extraEnv },
			timeoutMs: 240_000,
			logPath: join(root, `${runs}.log`),
		});

	const full = await runner("e2e", "off,brief,wiki,wiki-nocapture");
	check("the runner completes all four arms with a stub pi", full.exitCode === 0, `${full.stdout.slice(-700)}\n${full.stderr.slice(-700)}`);
	const probes = (await readJsonl(probePath)).filter((probe) => probe.kind === "agent");
	const armOf = (probe) =>
		probe.prompt.startsWith("Project knowledge index") ? "brief" : probe.tools.includes("wiki_insights") ? "wiki" : probe.tools.includes("wiki_ask") ? "wiki-nocapture" : "off";
	check("the stub ran once per arm", probes.length === 4 && new Set(probes.map(armOf)).size === 4, `saw ${probes.map(armOf).join(",")}`);
	const runsNorm = norm(runsDir);
	const namesNothing = (path) => !norm(path).includes(taskId) && !norm(path).includes(runsNorm) && !/\/(off|brief|wiki|wiki-nocapture)(-rep\d+)?(\/|$)/.test(norm(path));
	for (const probe of probes) {
		const arm = armOf(probe);
		check(`${arm}: the agent's cwd names neither the task, the run nor the arm`, namesNothing(probe.cwd), probe.cwd);
		check(`${arm}: the agent's agent dir names neither the run nor the arm`, namesNothing(probe.agentDirEnv), probe.agentDirEnv);
		check(`${arm}: no grader is in the copy when the agent starts`, !probe.files.includes(`tests/${taskId}.test.mjs`) && !probe.canaryInTree, probe.canaryInTree ?? "");
		check(`${arm}: the experiment's notes are not in the copy`, !probe.files.some((file) => file.startsWith("handoffs/")));
		check(`${arm}: the copy has no remote`, probe.remotes === "", String(probe.remotes));
		check(`${arm}: the agent's git status is clean when it starts`, probe.status === "", String(probe.status));
		check(`${arm}: no user context and no wiki registry reach the arm`, !probe.userContext && !probe.registry);
		const wikiTools = probe.tools.filter((tool) => tool.startsWith("wiki_"));
		const wikiFiles = probe.files.some((file) => file.startsWith("docs/wiki/"));
		if (arm === "off" || arm === "brief") check(`${arm}: no wiki tools and no wiki files`, wikiTools.length === 0 && !wikiFiles);
		if (arm === "brief") check("brief: the prompt carries the base index, not raw captures", probe.prompt.includes("Alpha page") && !probe.prompt.includes("Session capture"));
		if (arm === "wiki") check("wiki: the full wiki toolset and the wiki files", probe.tools.includes("wiki_insights") && wikiFiles);
		if (arm === "wiki-nocapture") check("wiki-nocapture: read tools only, wiki files present", probe.tools.includes("wiki_ask") && !probe.tools.includes("wiki_insights") && !probe.tools.includes("wiki_finalize") && wikiFiles, wikiTools.join(","));
	}
	const rows = await readJsonl(join(runsDir, "e2e", "results.jsonl"));
	const byArm = Object.fromEntries(rows.map((row) => [row.arm, row]));
	check(
		"every arm recorded a valid, clean, graded pass",
		rows.length === 4 && rows.every((row) => row.valid && row.contamination?.clean && row.grading?.passed === true),
		JSON.stringify(rows.map((row) => [row.arm, row.valid, row.invalidReasons, row.contamination?.reasons, row.grading?.passed])),
	);
	check("quality signals run before any grader is installed", rows.length === 4 && rows.every((row) => row.quality?.nograder?.passed === true));
	check("the wiki arm's Jev calls and upkeep turns are counted", byArm.wiki?.jev?.calls === 1 && byArm.wiki?.jev?.inputTokens === 1000 && byArm.wiki?.upkeep?.messages === 1, JSON.stringify([byArm.wiki?.jev, byArm.wiki?.upkeep]));
	check("the read-only arm withheld the wiki's write tools", byArm["wiki-nocapture"]?.agent?.toolsWithheld?.includes("wiki_insights") === true);
	let patchesClean = rows.length === 4;
	for (const row of rows) {
		const text = await readFile(join(runsDir, "e2e", row.patch.path), "utf8");
		if (!text.includes("src/stub-work.js") || text.includes(`tests/${taskId}`) || text.includes(".pi/jev-wiki.json")) patchesClean = false;
	}
	check("each patch is the agent's work, without the grader or the harness's config", patchesClean);

	const report = await spawnCapture(process.execPath, [join(here, "report.mjs"), "--run", "e2e", "--runs-dir", runsDir], { cwd: harnessRoot, timeoutMs: 60_000 });
	check(
		"the report compares every arm with the control",
		report.exitCode === 0 && ["wiki vs off", "wiki-nocapture vs off", "brief vs off", "wiki vs wiki-nocapture"].every((heading) => report.stdout.includes(heading)),
		report.stdout.slice(0, 600) + report.stderr.slice(-300),
	);

	const judge = await spawnCapture(process.execPath, [join(here, "judge.mjs"), "--run", "e2e", "--runs-dir", runsDir, "--model", "stub-judge", "--pi-bin", stub, "--samples", "2"], {
		cwd: harnessRoot,
		env: stubEnv,
		timeoutMs: 120_000,
		logPath: join(root, "judge.log"),
	});
	const judgeProbes = (await readJsonl(probePath)).filter((probe) => probe.kind === "judge");
	check("the judge runs once per sample", judge.exitCode === 0 && judgeProbes.length === 2, `${judge.stdout.slice(-500)}\n${judge.stderr.slice(-300)}`);
	check("the judge has no tools and no user context", judgeProbes.length > 0 && judgeProbes.every((probe) => probe.tools.length === 0 && !probe.userContext));
	check("the judge's prompt names no arm, run or patch file", judgeProbes.length > 0 && judgeProbes.every((probe) => !/-rep\d|\.patch|wiki-nocapture/i.test(probe.prompt) && !norm(probe.prompt).includes(runsNorm)));
	check("the judge sees the code and not the wiki's own files", judgeProbes.length > 0 && judgeProbes.every((probe) => probe.prompt.includes("stub-work.js") && !probe.prompt.includes("decisions.jsonl") && !probe.prompt.includes("docs/wiki/")));
	check("the judge is not shown test results", judgeProbes.length > 0 && judgeProbes.every((probe) => !/Automated test result|Type-check \/ lint/.test(probe.prompt)));
	const judged = await readJsonl(join(runsDir, "e2e", "judgements.jsonl"));
	const orderOf = (sample) => ["A", "B", "C", "D"].map((label) => judged.find((entry) => entry.sample === sample && entry.label === label)?.arm).join(",");
	check("every arm is judged in every sample", judged.length === 8, `${judged.length} judgement(s)`);
	check("the label order changes between samples", orderOf(0) !== orderOf(1), `${orderOf(0)} / ${orderOf(1)}`);

	const wander = await runner("e2e-wander", "off", { EVAL_STUB_WANDER: join(harnessRoot, "eval", "README.md") });
	const wanderRows = await readJsonl(join(runsDir, "e2e-wander", "results.jsonl"));
	check(
		"an arm that reaches the harness is recorded as contaminated",
		wander.exitCode === 0 && wanderRows[0]?.contamination?.clean === false && wanderRows[0].contamination.reasons.some((reason) => reason.includes("canary")),
		JSON.stringify(wanderRows[0]?.contamination) + wander.stderr.slice(-300),
	);
	const wanderReport = await spawnCapture(process.execPath, [join(here, "report.mjs"), "--run", "e2e-wander", "--runs-dir", runsDir], { cwd: harnessRoot, timeoutMs: 60_000 });
	check("the report leaves a contaminated run out of the statistics", wanderReport.stdout.includes("contaminated, left out"), wanderReport.stdout.slice(0, 500));
} finally {
	await rm(root, { recursive: true, force: true });
}

for (const failure of failures) console.log(`FAIL  ${failure}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
