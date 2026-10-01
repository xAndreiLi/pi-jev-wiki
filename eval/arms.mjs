/**
 * Per-arm environments — where fairness is either enforced or silently lost.
 *
 * The control arm must differ from the treatment arm in exactly one thing: the wiki. The mechanisms
 * below make that true, and each exists because the naive version was unfair:
 *
 * 1. **A per-arm agent directory.** `pi --no-extensions` disables *every* extension, so the old
 *    control also lost the web tools, MCP servers, and unrelated skills — a strictly less capable
 *    agent. Instead each arm gets its own agent dir: the same packages, the same auth, with one
 *    package removed from the list, and none of the user's machine-wide knowledge (registry, context).
 * 2. **Sparse checkout.** Deleting the wiki directory from a clone leaves tracked files missing, so
 *    the agent's own `git status` shows a wall of deletions. Sparse checkout removes it — and any
 *    notes about the experiment that live in the testbed — without dirtying the tree.
 * 3. **Identical dependencies.** A clone has no `node_modules`, so nothing can be graded. Both arms
 *    get the same dependency state, linked or copied from the source repository.
 *
 * Fairness also means the agent cannot reach the answer, the harness, or its own arm label. That is
 * checked from the agent's side: `graderLeaks` and `taskMentions` before it starts, `scanSession`
 * after it finishes (see `docs/wiki/wiki/architecture/gotcha-eval-harness-leaks.md` for why).
 */
import { appendFile, cp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { git, gitOk } from "./lib.mjs";

/** Directories in an agent dir that are large enough to link rather than copy. */
const LINKED_DIRS = ["npm"];
/** Directories never carried into an arm: runs use --session-dir, and the user's history is not the arm's. */
const SKIPPED_DIRS = ["sessions"];
/** User-level context files. A neutral arm runs without them (see `prepareAgentDir`). */
const USER_CONTEXT_FILES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
/**
 * State that must NOT be shared between runs. The wiki's vector index is a derived cache: a shared one
 * accumulated entries for every previous run's deleted copy. The registry is worse — it names every
 * wiki on the machine, so in R1 the wiki arm could list the live testbed wiki (newer than the task's
 * base), this repository's notes about the experiment, and the user's life wiki. Both are left behind;
 * the extension registers the copy's own wiki on first use. The embedding-model cache is read-only and
 * 900 MB, so it is linked.
 */
const ISOLATED_STATE = { "jev-wiki": { link: ["models"], skip: ["vector", "wikis.json"] } };

export function defaultAgentDir() {
	return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

/**
 * Build an agent directory for one arm: every file copied, large directories linked, and the named
 * packages removed from `settings.json`. Everything else stays identical to the user's real setup,
 * except what hands an arm knowledge the experiment does not control: the wiki registry (always left
 * behind) and, by default, the user's context files.
 *
 * `userContext: "none"` (default) drops the user's AGENTS.md: it belongs to the user's setup, not the
 * package, and in R1 it told every arm to consult a life wiki, to ask for consent (impossible in print
 * mode), and to keep the wiki current — upkeep the package itself did not ask for. `"real"` keeps it,
 * for measuring one user's actual setup rather than the package.
 */
export async function prepareAgentDir({ source = defaultAgentDir(), target, excludePackages = [], userContext = "none" }) {
	await rm(target, { recursive: true, force: true });
	await mkdir(target, { recursive: true });
	const linked = [];
	const isolated = [];
	const contextFilesSkipped = [];
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
			const isolation = ISOLATED_STATE[entry.name];
			if (isolation) {
				await mkdir(to, { recursive: true });
				for (const child of isolation.link) {
					const childPath = join(from, child);
					if (!existsSync(childPath)) continue;
					await linkDir(childPath, join(to, child));
					linked.push(`${entry.name}/${child}`);
				}
				isolated.push(`${entry.name} (${isolation.skip.join(", ")} left behind)`);
				continue;
			}
			if (LINKED_DIRS.includes(entry.name)) {
				await linkDir(from, to);
				linked.push(entry.name);
				continue;
			}
			await cp(from, to, { recursive: true });
			continue;
		}
		if (userContext !== "real" && USER_CONTEXT_FILES.includes(entry.name)) {
			contextFilesSkipped.push(entry.name);
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
	return { dir: target, linked, isolated, removedPackages: removed, userContext, contextFilesSkipped };
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
 * Remove paths from the working tree without leaving deleted tracked files behind. Returns the sparse
 * patterns applied, or none when there is nothing to exclude.
 */
export async function sparseExclude({ dir, git, paths }) {
	const clean = paths.map((path) => path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean);
	if (clean.length === 0) return [];
	const patterns = ["/*", ...clean.map((path) => `!/${path}`)];
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
 * A cheap content signature of the shared dependency directories. Directory mtimes (the old check)
 * miss an install that rewrites nested packages; npm's hidden lockfile changes on every install, and
 * the listings catch a package added or removed, including in a Python venv's site-packages.
 */
export async function depsSignature(repoDir, names) {
	const out = {};
	for (const name of names) {
		const dir = join(repoDir, name);
		if (!existsSync(dir)) {
			out[name] = null;
			continue;
		}
		const hash = createHash("sha1");
		try {
			hash.update(await readFile(join(dir, ".package-lock.json")));
		} catch {
			/* not an npm tree */
		}
		const listing = async (path) => (await readdir(path).catch(() => [])).sort().join("\n");
		hash.update(await listing(dir));
		hash.update(await listing(join(dir, "Lib", "site-packages")));
		for (const lib of (await readdir(join(dir, "lib")).catch(() => [])).filter((child) => child.startsWith("python"))) {
			hash.update(await listing(join(dir, "lib", lib, "site-packages")));
		}
		out[name] = hash.digest("hex").slice(0, 12);
	}
	return out;
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
 * Arms that keep the wiki present. `wiki-nocapture` is the read-only wiki: same pages, same read
 * tools, automatic capture off and every wiki *write* tool withheld (`--exclude-tools`, chosen by the
 * runner from the loadout). A cadence flag alone was not enough: in R1 agents still filed knowledge on
 * their own, 4–10 wiki writes per run.
 */
export function keepsWiki(arm) {
	return arm.startsWith("wiki");
}

/** Write the per-arm project config that changes how much upkeep the wiki does. */
export async function configureCapture({ copy, cadence }) {
	const relative = ".pi/jev-wiki.json";
	const path = join(copy, ".pi", "jev-wiki.json");
	let config = {};
	try {
		config = JSON.parse(await readFile(path, "utf8"));
	} catch {
		/* no project config yet */
	}
	config.capture = { ...(config.capture ?? {}), cadence };
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
	// The harness's edit must not look like the agent's: in R1 it showed up in the arm's patch (and so in
	// front of the judge) and in the agent's own `git status`. assume-unchanged, not skip-worktree: in a
	// sparse checkout git (2.37+) clears skip-worktree on any file present in the working tree.
	const tracked = await gitOk(copy, ["ls-files", "--error-unmatch", relative]);
	if (tracked) await git(copy, ["update-index", "--assume-unchanged", relative]);
	else {
		await mkdir(join(copy, ".git", "info"), { recursive: true });
		await appendFile(join(copy, ".git", "info", "exclude"), `\n/${relative}\n`);
	}
	return { path: relative, cadence, hidden: tracked ? "assume-unchanged" : "info/exclude" };
}

/**
 * The `brief` arm's knowledge: the wiki's own index at the **base commit** — the catalog `wiki_toc`
 * returns — with no way to open the pages.
 *
 * Read from the base commit, not the working tree: a brief built from what is on disk today would
 * contain knowledge written after the task was done. And read the index rather than every markdown
 * file: listing files picked up raw session captures, so in R1 21 of 37 lines read "Session capture
 * 2026-10-01" and the real pages were truncated away.
 */
export async function buildBrief({ repo, base, wikiRoot = "docs/wiki", maxChars = 20000 }) {
	const root = wikiRoot.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
	let body = await git(repo, ["show", `${base}:${root}/wiki/index.md`], { allowFailure: true, trim: false });
	const source = body ? "index.md" : "frontmatter";
	if (!body) body = await frontmatterIndex(repo, base, `${root}/wiki`);
	const pages = (body.match(/^\| \[/gm) ?? body.match(/^- /gm) ?? []).length;
	const truncated = body.length > maxChars;
	const header = "Project knowledge index (titles and one-line summaries; the pages themselves are not in this checkout):";
	const text = `${header}\n\n${truncated ? `${body.slice(0, maxChars)}\n[... truncated ...]` : body.trim()}`;
	return { text, pages, chars: text.length, truncated, sha: createHash("sha1").update(text).digest("hex").slice(0, 12), fromCommit: base, source };
}

/** Fallback for a wiki with no index.md: page titles and summaries, never raw sources or catalog files. */
async function frontmatterIndex(repo, base, pagesRoot) {
	const listed = (await git(repo, ["ls-tree", "-r", "--name-only", base, "--", pagesRoot], { allowFailure: true }))
		.split(/\r?\n/)
		.filter((path) => path.endsWith(".md") && !/(^|\/)(index|log|toc)\.md$/.test(path) && !path.includes("/toc/"));
	const lines = [];
	for (const path of listed) {
		const text = await git(repo, ["show", `${base}:${path}`], { allowFailure: true, trim: false });
		if (!text.startsWith("---")) continue;
		const end = text.indexOf("\n---", 3);
		const front = end < 0 ? "" : text.slice(3, end);
		const title = /^title:\s*"?(.+?)"?\s*$/m.exec(front)?.[1];
		const summary = /^summary:\s*"?(.+?)"?\s*$/m.exec(front)?.[1];
		if (title) lines.push(summary ? `- ${title} — ${summary}` : `- ${title}`);
	}
	return lines.join("\n");
}

/**
 * Order arms under blind labels, deterministically from the run and task ids. Deterministic matters: a
 * judgement has to be reproducible, and a reviewer has to be able to un-blind it afterwards.
 */
export function blindOrder(arms, seedText) {
	let seed = 2166136261;
	for (const character of String(seedText)) seed = ((seed ^ character.charCodeAt(0)) * 16777619) >>> 0;
	const shuffled = [...arms];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		seed = (seed * 1103515245 + 12345) >>> 0;
		const swap = seed % (index + 1);
		[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
	}
	return shuffled;
}

/**
 * Keep the diff each arm produced. Without this the interesting artefact is deleted with the copy, and a
 * quality review afterwards has nothing to read — which is exactly what happened to the first pilot.
 * Taken before any grader is installed, so the patch is the agent's work and nothing else.
 */
export async function savePatch({ copy, dir, slug }) {
	await git(copy, ["add", "-A"], { allowFailure: true });
	const patch = await git(copy, ["diff", "--cached", "--binary", "HEAD"], { allowFailure: true, trim: false });
	const path = join(dir, "diffs", `${slug}.patch`);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, patch, "utf8");
	return { path: `diffs/${slug}.patch`, bytes: patch.length, text: patch };
}

/**
 * The diff a reviewer should judge: source changes only. Files the agent's tooling wrote — its wiki,
 * its config — are dropped, because only wiki arms have them (they name the arm) and because they bury
 * the code (in R1, 102 KB of one 161 KB patch was the wiki's ledger). The full patch stays on disk.
 */
export function codeOnlyPatch(patch, { excludePrefixes = [] } = {}) {
	const prefixes = excludePrefixes.map((prefix) => `${prefix.replace(/\\/g, "/").replace(/\/+$/, "")}/`);
	const kept = [];
	const dropped = [];
	let text = "";
	for (const block of String(patch).split(/^(?=diff --git )/m).filter(Boolean)) {
		const path = /^diff --git "?a\/(.+?)"? "?b\//.exec(block)?.[1] ?? "";
		if (prefixes.some((prefix) => path.startsWith(prefix))) dropped.push(path);
		else {
			kept.push(path);
			text += block;
		}
	}
	return { text, kept, dropped };
}

/**
 * The wiki's own model spend, which pi's session never records: every Jev call is a line in the
 * wiki's ledger with its usage. The ledger is append-only, so the lines past the base commit's copy are
 * this run's calls. Tokens are always there; a price only when the extension records one.
 */
export async function jevUsage({ copy, wikiRoot = "docs/wiki" }) {
	const ledger = `${wikiRoot.replace(/\\/g, "/").replace(/\/+$/, "")}/.jev-wiki/decisions.jsonl`;
	const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
	let after = "";
	try {
		after = await readFile(join(copy, ledger), "utf8");
	} catch {
		return usage;
	}
	const before = await git(copy, ["show", `HEAD:${ledger}`], { allowFailure: true, trim: false });
	const baseLines = before ? before.split(/\r?\n/).length - 1 : 0;
	for (const line of after.split(/\r?\n/).slice(baseLines)) {
		if (!line.startsWith("{")) continue;
		try {
			const entry = JSON.parse(line);
			if (!entry.usage) continue;
			usage.calls += 1;
			usage.inputTokens += entry.usage.input_tokens ?? 0;
			usage.outputTokens += entry.usage.output_tokens ?? 0;
			usage.cost += entry.usage.cost ?? 0;
		} catch {
			/* a partially written line is not a call */
		}
	}
	return usage;
}

/**
 * Objective quality signals, collected while the copy still exists: does the project's own type-checker
 * and linter still pass on what the arm wrote? A test can pass while leaving the code untypeable. Run
 * before the graders are installed — in R1 the graders' own type errors failed every arm.
 */
export async function qualitySignals({ task, copy, dir, slug, spawn }) {
	const commands = task.qualityCommands ?? {};
	const results = {};
	for (const [name, command] of Object.entries(commands)) {
		const [executable, args] = shellCommand(String(command));
		const run = await spawn(executable, args, {
			cwd: copy,
			timeoutMs: (task.testTimeoutMinutes ?? 3) * 60 * 1000,
			logPath: join(dir, "logs", `${slug}-${name}.log`),
		});
		results[name.replace(/[^a-z0-9_-]/gi, "")] = { command: String(command), exitCode: run.exitCode, passed: run.exitCode === 0, tail: run.stdout.slice(-400) };
	}
	return results;
}

/** Test-file patterns, shared by grader protection and by the diff report. */
export const TEST_PATTERN = /(^|\/)(test|tests|spec|specs|__tests__|e2e)(\/|$)|[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$/i;

export function shellCommand(command) {
	return process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", command]] : ["/bin/sh", ["-c", command]];
}

/**
 * Clone at base, with the target commit pruned, no remote to fetch it back from, and dependencies
 * present. Control arms lose the wiki; every arm loses the card's `excludePaths` (notes about the
 * experiment that live in the testbed — in R1 a handoff listed every card and what its grader checks).
 */
export async function prepareTaskCopy({ task, dir, arm, linkDirs = [], link = true }) {
	const wikiRoot = (task.wikiRoot ?? "docs/wiki").replace(/\\/g, "/");
	await rm(dir, { recursive: true, force: true });
	await mkdir(dirname(dir), { recursive: true });
	await git(dirname(dir), ["clone", "--no-hardlinks", "--no-checkout", "--quiet", task.repo, dir]);
	await git(dir, ["checkout", "--detach", "--quiet", task.base]);

	const sparse = await sparseExclude({ dir, git, paths: [...(keepsWiki(arm) ? [] : [wikiRoot]), ...(task.excludePaths ?? [])] });

	// A clone remembers where it came from: `git fetch` would bring back every ref pruned below.
	for (const remote of (await git(dir, ["remote"])).split(/\r?\n/).filter(Boolean)) await git(dir, ["remote", "remove", remote]);
	const refs = (await git(dir, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])).split(/\r?\n/).filter(Boolean);
	for (const ref of refs) await git(dir, ["update-ref", "-d", ref]);
	await git(dir, ["reflog", "expire", "--expire=now", "--all"]);
	await git(dir, ["gc", "--prune=now", "--quiet"], { allowFailure: true });

	const targetReachable = task.target ? await gitOk(dir, ["cat-file", "-e", `${task.target}^{commit}`]) : false;
	const remotes = (await git(dir, ["remote"])).split(/\r?\n/).filter(Boolean);
	const deps = await linkDependencies({ sourceRepo: task.repo, dir, names: linkDirs, link });
	return { targetReachable, remotes, wikiPresent: existsSync(join(dir, wikiRoot)), refsDeleted: refs.length, sparse, deps };
}

/**
 * Restore the test files the target commit touched, straight from the source repository, once the
 * agent has finished. Restored before the agent ran, they would hand it the answer's tests — and it
 * could edit them before being graded by them.
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

function graderSource(entry) {
	return typeof entry === "string" ? entry : entry?.from;
}

function graderDestination(entry) {
	const from = graderSource(entry);
	return ((typeof entry === "object" && entry?.to) || join("tests", String(from).replace(/[\\/]+/g, "/").split("/").pop())).replace(/[\\/]+/g, "/");
}

/**
 * Copy hidden graders into the copy *after* the agent has finished. The agent never sees them, which
 * is what makes them a grader rather than a hint: a card may specify an interface in its prompt but
 * never its assertions. Entries are absolute paths, or `{ from, to }` to choose the destination; the
 * default destination is `tests/<basename>` so the project's own runner collects it.
 */
export async function installGraders({ task, copy }) {
	const installed = [];
	for (const entry of task.graderFiles ?? []) {
		const from = graderSource(entry);
		if (!from || !existsSync(from)) throw new Error(`grader file not found: ${from}`);
		const destination = graderDestination(entry);
		const target = join(copy, destination);
		const overwrote = existsSync(target);
		await mkdir(dirname(target), { recursive: true });
		await cp(from, target);
		installed.push({ from, to: destination, overwrote });
	}
	return installed;
}

/** The check R1 lacked: just before the agent starts, no hidden grader may already be in the copy. */
export async function graderLeaks({ task, copy }) {
	const leaks = [];
	for (const entry of task.graderFiles ?? []) {
		const target = join(copy, graderDestination(entry));
		if (existsSync(target) && (await readFile(target, "utf8")) === (await readFile(graderSource(entry), "utf8"))) leaks.push(graderDestination(entry));
	}
	return leaks;
}

/** Tracked files in the copy that name the task or carry its canary: notes about the experiment. */
export async function taskMentions({ task, copy }) {
	const needles = [task.id, task.canary].filter(Boolean);
	if (needles.length === 0) return [];
	const out = await git(copy, ["grep", "-l", "-I", "-F", ...needles.flatMap((needle) => ["-e", needle])], { allowFailure: true });
	// On disk only: a file sparse checkout left out is invisible to the agent, whatever the index holds.
	return out.split(/\r?\n/).filter((file) => file && existsSync(join(copy, file)));
}

/**
 * A card with hidden graders carries a unique canary string that every one of its graders contains,
 * so that an agent seeing a grader — wherever it found it — shows up in its own session.
 */
export async function assertCanary(task) {
	const graders = task.graderFiles ?? [];
	if (graders.length === 0) return;
	if (!task.canary) throw new Error(`${task.id}: the card has hidden graders but no "canary" — add a unique string to the card and to every grader file`);
	for (const entry of graders) {
		if (!(await readFile(graderSource(entry), "utf8")).includes(task.canary)) throw new Error(`${task.id}: grader ${graderSource(entry)} does not contain the card's canary ${task.canary}`);
	}
}

const normalizePath = (value) => String(value).replace(/\\+/g, "/").replace(/\/{2,}/g, "/").toLowerCase();

/** `C:\x\y` the ways an agent might write it: `c:/x/y`, or from a POSIX shell, `/c/x/y`. */
function pathForms(path) {
	const forward = normalizePath(path).replace(/\/+$/, "");
	if (!forward) return [];
	const drive = /^([a-z]):\/(.*)$/.exec(forward);
	return drive ? [forward, `/${drive[1]}/${drive[2]}`] : [forward];
}

/**
 * Everything an arm reached that it should not have, read from its own session afterwards: a tool call
 * whose arguments name a forbidden location (the harness, the source repository, another wiki, the
 * user's other sessions), or a tool result carrying a canary planted in the graders and cards.
 */
export async function scanSession({ sessionFile, forbidden = [], canaries = [] }) {
	if (!sessionFile) return { clean: false, reasons: ["no session file to scan"] };
	const roots = [...new Set(forbidden.flatMap(pathForms))];
	const reasons = new Set();
	for (const line of (await readFile(sessionFile, "utf8")).split(/\r?\n/)) {
		if (!line.trim()) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		const message = entry?.message;
		if (message?.role === "assistant") {
			for (const part of message.content ?? []) {
				if (part?.type !== "toolCall") continue;
				const args = normalizePath(JSON.stringify(part.arguments ?? {}));
				for (const root of roots) if (args.includes(root)) reasons.add(`${part.name} reached ${root}`);
			}
		} else if (message?.role === "toolResult") {
			const output = JSON.stringify(message.content ?? "");
			for (const canary of canaries) if (canary && output.includes(canary)) reasons.add(`a tool result contained canary ${canary}`);
		}
	}
	return { clean: reasons.size === 0, reasons: [...reasons] };
}
