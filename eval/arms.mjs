/**
 * Per-arm environments — where fairness is either enforced or silently lost.
 *
 * The control arm must differ from the treatment arm in exactly one thing: the wiki. Three
 * mechanisms make that true, and each of them exists because the naive version is unfair:
 *
 * 1. **A per-arm agent directory.** `pi --no-extensions` disables *every* extension, so the old
 *    control also lost the web tools, MCP servers, and unrelated skills — a strictly less capable
 *    agent. Instead each arm gets its own agent dir: the same packages, the same auth, the same
 *    user context, with one package removed from the list.
 * 2. **Sparse checkout.** Deleting the wiki directory from a clone leaves tracked files missing, so
 *    the agent's own `git status` shows a wall of deletions — a hint that something was removed, and
 *    noise in any task that inspects the tree. Sparse checkout removes the wiki without dirtying the
 *    tree.
 * 3. **Identical dependencies.** A clone has no `node_modules`, so nothing can be graded. Both arms
 *    get the same dependency state, linked or copied from the source repository.
 *
 * `assertComparableExpectations` then proves the arms match: the same tools, minus the wiki.
 */
import { cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { git, gitOk } from "./lib.mjs";

/** Directories in an agent dir that are large enough to link rather than copy. */
const LINKED_DIRS = ["npm", "jev-wiki"];
/** Directories never carried into an arm: runs use --session-dir. */
const SKIPPED_DIRS = ["sessions"];

export function defaultAgentDir() {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

/**
 * Build an agent directory for one arm: every file copied, large directories linked, and the named
 * packages removed from `settings.json`. Everything else stays identical to the user's real setup.
 */
export async function prepareAgentDir({ source = defaultAgentDir(), target, excludePackages = [] }) {
	await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });
	const linked = [];
	let entries;
	try {
		entries = await readdir(source, { withFileTypes: true });
	} catch (error) {
		throw new Error(`cannot read agent dir ${source}: ${error.message}`);
	}
	for (const entry of entries) {
		const from = join(source, entry.name);
		const to = join(target, entry.name);
		if (entry.isDirectory()) {
			if (SKIPPED_DIRS.includes(entry.name)) continue;
			if (LINKED_DIRS.includes(entry.name)) {
				await linkDir(from, to);
				linked.push(entry.name);
				continue;
			}
			await cp(from, to, { recursive: true });
			continue;
		}
		await cp(from, to);
	}

	const settingsPath = join(target, "settings.json");
	let removed = [];
	if (existsSync(settingsPath)) {
		const settings = JSON.parse(await readFile(settingsPath, "utf8"));
		if (Array.isArray(settings.packages)) {
			const kept = [];
			for (const entry of settings.packages) {
				const source = typeof entry === "string" ? entry : entry?.source ?? "";
				if (excludePackages.some((name) => String(source).includes(name))) removed.push(source);
				else kept.push(entry);
			}
			settings.packages = kept;
		}
		await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	}
	return { dir: target, linked, removedPackages: removed };
}

async function linkDir(from, to) {
	try {
		await symlink(from, to, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		// Linking can fail on locked-down filesystems; copying 600 MB silently would be worse than
		// failing, because it turns a fast rerun into a mystery slowdown.
		throw new Error(`cannot link ${from} → ${to}: ${error.message}. Use --copy-deps to copy instead.`);
	}
}

/**
 * Make the working tree contain (or not contain) the wiki, without leaving deleted tracked files
 * behind. Returns the sparse patterns applied.
 */
export async function sparseExclude({ dir, git, wikiRoot }) {
	const patterns = ["/*", `!${wikiRoot.replace(/\\/g, "/").replace(/\/+$/, "")}`];
	await git(dir, ["sparse-checkout", "init", "--no-cone"]);
	await git(dir, ["sparse-checkout", "set", ...patterns]);
	return patterns;
}

/** Copy or link the dependencies a clone is missing, identically for every arm. */
export async function linkDependencies({ sourceRepo, dir, names = [], link = true }) {
	const applied = [];
	for (const name of names) {
		const from = join(sourceRepo, name);
		const to = join(dir, name);
		if (!existsSync(from) || existsSync(to)) continue;
		await mkdir(join(to, ".."), { recursive: true });
		if (link) {
			try {
				await symlink(from, to, process.platform === "win32" ? "junction" : "dir");
				applied.push({ name, mode: "link" });
				continue;
			} catch {
				/* fall through to copying */
			}
		}
		await cp(from, to, { recursive: true });
		applied.push({ name, mode: "copy" });
	}
	return applied;
}

/**
 * The fairness assertion. Both arms must load the same tools except the wiki's own. If they differ in
 * anything else — a missing web tool, a different MCP server, an extra skill's tool — the comparison
 * is measuring more than the wiki and must not proceed.
 */
export function compareToolsets(offTools, wikiTools) {
	const wikiPrefix = (name) => name.startsWith("wiki_") || name.startsWith("jev_");
	const off = [...new Set(offTools)].filter((name) => !wikiPrefix(name)).sort();
	const wiki = [...new Set(wikiTools)].filter((name) => !wikiPrefix(name)).sort();
	const onlyOff = off.filter((name) => !wiki.includes(name));
	const onlyWiki = wiki.filter((name) => !off.includes(name));
	return {
		comparable: onlyOff.length === 0 && onlyWiki.length === 0,
		sharedCount: off.length,
		onlyOff,
		onlyWiki,
		wikiToolCount: [...new Set(wikiTools)].filter(wikiPrefix).length,
	};
}

/**
 * A budget-matched brief for the `brief` arm: the wiki's own table of contents, which is the cheapest
 * useful thing a wiki gives an agent, without its retrieval machinery.
 */
export async function buildBrief({ wikiDir, maxChars = 2000, listMarkdown }) {
	if (!existsSync(wikiDir)) return { text: "", pages: 0 };
	const lines = [];
	let pages = 0;
	for (const path of await listMarkdown(wikiDir)) {
		let text;
		try {
			text = await readFile(path, "utf8");
		} catch {
			continue;
		}
		if (!text.startsWith("---")) continue;
		const end = text.indexOf("\n---", 3);
		const front = end < 0 ? "" : text.slice(3, end);
		const title = /^title:\s*"?(.+?)"?\s*$/m.exec(front)?.[1];
		const summary = /^summary:\s*"?(.+?)"?\s*$/m.exec(front)?.[1];
		if (!title) continue;
		pages += 1;
		lines.push(summary ? `- ${title} — ${summary}` : `- ${title}`);
	}
	const header = "Project wiki contents (titles and one-line summaries):";
	const body = lines.join("\n");
	const text = body.length > maxChars ? `${header}\n${body.slice(0, maxChars)}\n[... truncated ...]` : `${header}\n${body}`;
	return { text, pages };
}

/** Test-file patterns, shared by grader protection and by the diff report. */
export const TEST_PATTERN = /(^|\/)(test|tests|spec|specs|__tests__|e2e)(\/|$)|[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$/i;

export function shellCommand(command) {
	return process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", command]] : ["/bin/sh", ["-c", command]];
}

/**
 * Clone at base, optionally without the wiki, with the target commit pruned and dependencies present.
 * The control arms must not contain the artifact, and must not show it as deleted either.
 */
export async function prepareTaskCopy({ task, dir, arm, linkDirs = [], link = true }) {
	const wikiRoot = (task.wikiRoot ?? "docs/wiki").replace(/\\/g, "/");
	await rm(dir, { recursive: true, force: true });
	await mkdir(dirname(dir), { recursive: true });
	await git(dirname(dir), ["clone", "--no-hardlinks", "--no-checkout", "--quiet", task.repo, dir]);
	await git(dir, ["checkout", "--detach", "--quiet", task.base]);

	// The control arms must not contain the artifact, and must not look like something was removed.
	let sparse;
	if (arm !== "wiki") sparse = await sparseExclude({ dir, git, wikiRoot });

	const refs = (await git(dir, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])).split(/\r?\n/).filter(Boolean);
	for (const ref of refs) await git(dir, ["update-ref", "-d", ref]);
	await git(dir, ["reflog", "expire", "--expire=now", "--all"]);
	await git(dir, ["gc", "--prune=now", "--quiet"], { allowFailure: true });

	const targetReachable = task.target ? await gitOk(dir, ["cat-file", "-e", `${task.target}^{commit}`]) : false;
	const deps = await linkDependencies({ sourceRepo: task.repo, dir, names: linkDirs, link });
	return { targetReachable, wikiPresent: existsSync(join(dir, wikiRoot)), refsDeleted: refs.length, sparse, deps };
}

/**
 * Restore the test files the target commit touched, straight from the source repository. Without
 * this an arm can pass its own grader by editing the tests, and the two arms would then be graded by
 * different graders.
 */
export async function protectGrader({ task, copy }) {
	if (!task.target || task.restoreGrader === false) return { restored: [], skipped: true };
	const changed = (await git(task.repo, ["show", "--name-only", "--format=", task.target], { allowFailure: true })).split(/\r?\n/).filter(Boolean);
	const testFiles = changed.filter((file) => TEST_PATTERN.test(file));
	const restored = [];
	for (const file of testFiles) {
		const content = await git(task.repo, ["show", `${task.target}:${file}`], { allowFailure: true, trim: false });
		if (!content) continue;
		await mkdir(dirname(join(copy, file)), { recursive: true });
		await writeFile(join(copy, file), content, "utf8");
		restored.push(file);
	}
	return { restored, skipped: false };
}

/**
 * Copy hidden graders into the copy *after* the agent has finished. The agent never sees them, which
 * is what makes them a grader rather than a hint: a card may specify an interface in its prompt but
 * never its assertions. Entries are absolute paths, or `{ from, to }` to choose the destination; the
 * default destination is `tests/<basename>` so the project's own runner collects it.
 */
export async function installGraders({ task, copy }) {
	const entries = task.graderFiles ?? [];
	const installed = [];
	for (const entry of entries) {
		const from = typeof entry === "string" ? entry : entry?.from;
		if (!from || !existsSync(from)) throw new Error(`grader file not found: ${from}`);
		const destination = (typeof entry === "object" && entry?.to) || join("tests", from.replace(/[\\/]+/g, "/").split("/").pop());
		const target = join(copy, destination);
		const overwrote = existsSync(target);
		await mkdir(dirname(target), { recursive: true });
		await cp(from, target);
		installed.push({ from, to: destination.replace(/[\\/]+/g, "/"), overwrote });
	}
	return installed;
}
