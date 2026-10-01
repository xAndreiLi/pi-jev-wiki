#!/usr/bin/env node
/**
 * Self-test for the fairness machinery: no model calls, no API cost, seconds to run.
 *
 * These are the guarantees that make the A/B comparison meaningful, and each one is cheap to break
 * silently — a control arm that quietly loses its web tools, a checkout that reports the wiki as
 * deleted, a clone that still contains the answer, a grader the agent can edit.
 *
 *   node eval/selftest.mjs
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBrief, compareToolsets, configureCapture, keepsWiki, linkDependencies, prepareAgentDir, sparseExclude } from "./arms.mjs";
import { git, spawnCapture } from "./lib.mjs";

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function makeRepo(root) {
	await mkdir(join(root, "src"), { recursive: true });
	await mkdir(join(root, "docs", "wiki", "wiki", "architecture"), { recursive: true });
	await writeFile(join(root, "src", "a.js"), "export const a = 1;\n", "utf8");
	await writeFile(join(root, "docs", "wiki", "wiki", "architecture", "a.md"), '---\ntitle: A\nsummary: "One line."\n---\n\n# A\n', "utf8");
	await git(root, ["init", "-q", "-b", "main"]);
	await git(root, ["config", "user.email", "self@test"]);
	await git(root, ["config", "user.name", "selftest"]);
	await git(root, ["add", "-A"]);
	await git(root, ["commit", "-qm", "base"]);
	const base = await git(root, ["rev-parse", "HEAD"]);
	// The answer, on a branch, so the leak check has something to prune.
	await git(root, ["checkout", "-q", "-b", "eval/t1"]);
	await writeFile(join(root, "src", "a.js"), "export const a = 2;\n", "utf8");
	await git(root, ["add", "-A"]);
	await git(root, ["commit", "-qm", "answer"]);
	const target = await git(root, ["rev-parse", "HEAD"]);
	return { base, target };
}

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
	const fakeAgent = join(root, "agent-src");
	await mkdir(join(fakeAgent, "npm"), { recursive: true });
	await mkdir(join(fakeAgent, "jev-wiki", "models"), { recursive: true });
	await mkdir(join(fakeAgent, "jev-wiki", "vector"), { recursive: true });
	await mkdir(join(fakeAgent, "sessions"), { recursive: true });
	await writeFile(join(fakeAgent, "npm", "big.txt"), "store\n", "utf8");
	await writeFile(join(fakeAgent, "jev-wiki", "models", "cache.bin"), "model cache\n", "utf8");
	await writeFile(join(fakeAgent, "jev-wiki", "vector", "index.db"), "derived index\n", "utf8");
	await writeFile(join(fakeAgent, "jev-wiki", "wikis.json"), "{}\n", "utf8");
	await writeFile(join(fakeAgent, "auth.json"), "{}\n", "utf8");
	await writeFile(join(fakeAgent, "AGENTS.md"), "context\n", "utf8");
	await writeFile(
		join(fakeAgent, "settings.json"),
		`${JSON.stringify({ defaultModel: "m", packages: ["npm:pi-web-access", "npm:pi-jev-wiki@latest", "npm:@dietrichgebert/ponytail"] }, null, 2)}\n`,
		"utf8",
	);
	await writeFile(join(fakeAgent, "sessions", "s.jsonl"), "{}\n", "utf8");

	const control = await prepareAgentDir({ source: fakeAgent, target: join(root, "agent-off"), excludePackages: ["pi-jev-wiki"] });
	const controlSettings = JSON.parse(await readFile(join(control.dir, "settings.json"), "utf8"));
	check("the wiki package is removed from the control", control.removedPackages.length === 1 && control.removedPackages[0].includes("pi-jev-wiki"));
	check("every other package stays in the control", controlSettings.packages.length === 2 && controlSettings.packages.some((p) => String(p).includes("pi-web-access")));
	check("user context is carried into the control", existsSync(join(control.dir, "AGENTS.md")));
	check("sessions are not carried into the control", !existsSync(join(control.dir, "sessions")));
	check("large directories are linked, not copied", control.linked.includes("npm"));
	check("the embedding-model cache is linked, not copied", control.linked.includes("jev-wiki/models"));
	check("the wiki registry is carried over", existsSync(join(control.dir, "jev-wiki", "wikis.json")));
	check("a stale derived index is NOT carried into a run", !existsSync(join(control.dir, "jev-wiki", "vector")));
	check("the isolation is reported", control.isolated.some((entry) => entry.includes("vector")));

	const treated = await prepareAgentDir({ source: fakeAgent, target: join(root, "agent-wiki"), excludePackages: [] });
	const treatedSettings = JSON.parse(await readFile(join(treated.dir, "settings.json"), "utf8"));
	check("the treatment keeps every package", treatedSettings.packages.length === 3);
	check("nothing is reported removed for the treatment", treated.removedPackages.length === 0);

	// --- sparse checkout, leak pruning, dependencies ------------------------------------------
	const { base, target } = await makeRepo(join(root, "repo"));
	const copy = join(root, "copy");
	await git(root, ["clone", "--no-hardlinks", "--no-checkout", "--quiet", join(root, "repo"), copy]);
	await git(copy, ["checkout", "--detach", "--quiet", base]);
	const patterns = await sparseExclude({ dir: copy, git, wikiRoot: "docs/wiki" });
	check("sparse patterns cover the whole tree and exclude the wiki", patterns[0] === "/*" && patterns[1] === "!docs/wiki");
	check("the wiki directory is gone from the control copy", !existsSync(join(copy, "docs", "wiki")));
	const status = await git(copy, ["status", "--porcelain"]);
	check("the control copy has a clean working tree", status.trim() === "", `status was: ${JSON.stringify(status.slice(0, 120))}`);

	const refs = (await git(copy, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])).split(/\r?\n/).filter(Boolean);
	for (const ref of refs) await git(copy, ["update-ref", "-d", ref]);
	await git(copy, ["reflog", "expire", "--expire=now", "--all"]);
	await git(copy, ["gc", "--prune=now", "--quiet"], { allowFailure: true });
	let reachable = true;
	try {
		await git(copy, ["cat-file", "-e", `${target}^{commit}`]);
	} catch {
		reachable = false;
	}
	check("the answer commit is unreachable inside the copy", reachable === false);
	check("the base commit is still checked out", (await git(copy, ["rev-parse", "HEAD"])) === base);

	// Dependencies: linked and copied, and never overwriting something already present.
	await mkdir(join(root, "repo", "node_modules", "pkg"), { recursive: true });
	await writeFile(join(root, "repo", "node_modules", "pkg", "index.js"), "// dep\n", "utf8");
	const linked = await linkDependencies({ sourceRepo: join(root, "repo"), dir: copy, names: ["node_modules"], link: true });
	check("dependencies are made available to the copy", linked.length === 1 && existsSync(join(copy, "node_modules", "pkg", "index.js")));
	const again = await linkDependencies({ sourceRepo: join(root, "repo"), dir: copy, names: ["node_modules"], link: true });
	check("existing dependencies are left alone", again.length === 0);
	const copied = await linkDependencies({ sourceRepo: join(root, "repo"), dir: join(root, "copy2"), names: ["node_modules"], link: false });
	check("copy mode also works", copied.length === 1 && existsSync(join(root, "copy2", "node_modules", "pkg", "index.js")));

	// --- brief --------------------------------------------------------------------------------
	// Read from the base commit, never the working tree: a brief built from what is on disk today would
	// carry knowledge written after the task was done.
	const brief = await buildBrief({ repo: join(root, "repo"), base, wikiRoot: "docs/wiki", maxChars: 500 });
	check("the brief carries page titles", brief.text.includes("A"));
	check("the brief counts pages", brief.pages === 1);
	check("the brief names the commit it came from", brief.fromCommit === base);
	const tiny = await buildBrief({ repo: join(root, "repo"), base, wikiRoot: "docs/wiki", maxChars: 10 });
	check("the brief respects its character budget", tiny.text.length <= 10 + "[... truncated ...]".length + 60);

	// --- arm identity and capture configuration ------------------------------------------------
	check("wiki arms keep the wiki", keepsWiki("wiki") && keepsWiki("wiki-nocapture"));
	check("control arms do not", !keepsWiki("off") && !keepsWiki("brief"));
	const capture = await configureCapture({ copy: join(root, "copy"), cadence: "manual" });
	const projectConfig = JSON.parse(await readFile(join(root, "copy", ".pi", "jev-wiki.json"), "utf8"));
	check("the no-capture arm sets a manual cadence", projectConfig.capture.cadence === "manual");
	check("the capture setting is reported back", capture.cadence === "manual");

	// --- spawning ----------------------------------------------------------------------------
	// A missing log directory used to abort the whole run with an unhandled stream error.
	const logPath = join(root, "not-created-yet", "logs", "run.log");
	const ran = await spawnCapture(process.execPath, ["-e", "console.log('hello from child')"], { cwd: root, logPath, timeoutMs: 30_000 });
	check("a spawned command reports its exit code", ran.exitCode === 0);
	check("the log directory is created for the caller", existsSync(logPath));
	check("the log holds the child's output", (await readFile(logPath, "utf8")).includes("hello from child"));
} finally {
	await rm(root, { recursive: true, force: true });
}

async function listMarkdownForTest(dir) {
	const { readdir } = await import("node:fs/promises");
	const found = [];
	async function walk(current) {
		let entries = [];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "raw" || entry.name.startsWith(".")) continue;
				await walk(full);
			} else if (entry.name.endsWith(".md")) found.push(full);
		}
	}
	await walk(dir);
	return found.sort();
}

for (const failure of failures) console.log(`FAIL  ${failure}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
