/**
 * Cross-wiki target resolution and subject inference.
 *
 * A write tool keeps the session's wiki by default; passing a registered wiki name
 * retargets it. Auto-capture can infer the subject wiki from the files the session
 * actually edited (not merely read) and falls back to the session wiki — with a
 * warning — when the evidence is ambiguous or unknown.
 */
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { normalizeRoot, readRegistry, resolveWikiRoot, type WikiRegistration } from "../vector/registry.ts";
import { resolveLayout, type WikiLayout } from "./layout.ts";

export interface ResolvedTarget {
	name?: string;
	root: string;
	layout: WikiLayout;
}

/** Resolve the layout a write tool should use: a registered wiki by name, or the session wiki. */
export async function resolveWriteTarget(options: {
	agentDir: string;
	cwd: string;
	wikiRoot: string;
	stateRoot: string;
	wikiName?: string;
}): Promise<ResolvedTarget> {
	const { agentDir, cwd, wikiRoot, stateRoot, wikiName } = options;
	if (!wikiName) {
		return { root: resolve(cwd, wikiRoot), layout: resolveLayout(cwd, wikiRoot, stateRoot) };
	}
	const registry = await readRegistry(agentDir);
	const entry = registry.wikis.find((candidate) => candidate.name === wikiName);
	if (!entry) {
		const names = registry.wikis.map((candidate) => candidate.name).join(", ") || "(none registered)";
		throw new Error(`Wiki "${wikiName}" is not registered (registered: ${names}). Run wiki_toc scope=all to list wikis.`);
	}
	const root = await resolveWikiRoot(entry.root).catch(() => entry.root);
	return { name: entry.name, root, layout: resolveLayout(root, ".", stateRoot) };
}

/**
 * Resolve a page argument to an absolute path. `baseDir` (the session cwd) is only
 * consulted in the default same-wiki case; a cross-wiki target resolves against the
 * target wiki alone, so a same-named file in the session workspace cannot win.
 */
export function resolvePageFile(layout: WikiLayout, page: string, baseDir?: string): string | undefined {
	const candidates: string[] = [];
	if (baseDir) candidates.push(isAbsolute(page) ? page : resolve(baseDir, page));
	if (isAbsolute(page)) candidates.push(page);
	candidates.push(resolve(layout.wikiDir, page), resolve(layout.root, page));
	for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	return undefined;
}

/**
 * Resolve an ingest source path for a write target. Relative paths are anchored to
 * the target project root first (then the wiki root), never to the session cwd.
 */
export function resolveSourceFile(target: { root: string }, path: string): { absolute?: string; tried: string[] } {
	if (isAbsolute(path)) return { absolute: existsSync(path) ? path : undefined, tried: [path] };
	const project = projectRootFor(target.root);
	const tried = [resolve(project, path), resolve(target.root, path)];
	for (const candidate of tried) if (existsSync(candidate)) return { absolute: candidate, tried };
	return { absolute: undefined, tried };
}

/**
 * Nearest ancestor of the wiki root that looks like its project: a `.git` entry, or
 * — with no repository — the `<project>/{docs,wiki}` convention, else the parent.
 */
export function projectRootFor(wikiRoot: string): string {
	let current = resolve(wikiRoot);
	for (let depth = 0; depth < 5; depth++) {
		if (existsSync(resolve(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const parent = dirname(resolve(wikiRoot));
	const name = basename(parent).toLowerCase();
	return name === "docs" || name === "documentation" ? dirname(parent) : parent;
}

function owns(registration: WikiRegistration, absolutePath: string): boolean {
	const file = normalizeRoot(absolutePath);
	const roots = [normalizeRoot(registration.root), normalizeRoot(projectRootFor(registration.root))];
	return roots.some((root) => file === root || file.startsWith(`${root}/`));
}

export interface SubjectMatch {
	/** Registered wiki names whose project contains one of the given paths. */
	names: string[];
	/** First matching path per wiki name, for the routing note. */
	matches: Map<string, string>;
	ambiguous: boolean;
}

/**
 * Map file references to registered wikis. Explicit paths (session edits) are tried
 * against the session cwd only; `bases` additionally lets evidence references be tried
 * against other wikis' project roots — the case where a session in project A reads or
 * writes about project B and cannot resolve B's relative paths from A.
 */
export async function matchRegisteredWikis(options: {
	agentDir: string;
	cwd: string;
	paths: string[];
	bases?: string[];
}): Promise<SubjectMatch> {
	const matches = new Map<string, string>();
	if (options.paths.length === 0) return { names: [], matches, ambiguous: false };
	const registry = await readRegistry(options.agentDir);
	for (const raw of options.paths.slice(0, 20)) {
		if (typeof raw !== "string" || !raw.trim()) continue;
		const candidates = [isAbsolute(raw) ? raw : resolve(options.cwd, raw)];
		for (const base of options.bases ?? []) candidates.push(resolve(base, raw));
		const existing = candidates.find((candidate) => existsSync(candidate));
		if (!existing) continue;
		for (const entry of registry.wikis) {
			if (owns(entry, existing) && !matches.has(entry.name)) matches.set(entry.name, existing);
		}
	}
	const names = [...matches.keys()];
	return { names, matches, ambiguous: names.length > 1 };
}

/** Project roots of every registered wiki, used as extra bases for evidence refs. */
export async function registeredProjectRoots(agentDir: string): Promise<Array<{ name: string; root: string }>> {
	const registry = await readRegistry(agentDir);
	return registry.wikis.map((entry) => ({ name: entry.name, root: projectRootFor(entry.root) }));
}
