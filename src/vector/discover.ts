/**
 * Wiki discovery: find jev-wiki roots on the machine so existing wikis can be
 * adopted into the cross-wiki semantic index. Read-only; never writes.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { listMarkdownFiles, resolveLayout } from "../wiki/layout.ts";
import { countPages } from "../wiki/manifest.ts";
import { normalizeRoot, wikiNameFor, type WikiRegistration } from "./registry.ts";

const run = promisify(execFile);

export type WikiMarker = "state-dir" | "docs-layout" | "project-config" | "registry" | "wsl";

export interface DiscoveredWiki {
	root: string;
	name: string;
	marker: WikiMarker;
	source: "filesystem" | "wsl" | "registry";
	pages: number;
	rawSources: number;
	registered: boolean;
	enabled?: boolean;
	missing?: boolean;
	chunks?: number;
	model?: string;
	updatedAt?: string;
}

export interface IndexStateLite {
	chunks: number;
	model: string;
	updatedAt: string;
}

export interface DiscoverOptions {
	roots?: string[];
	maxDepth?: number;
	wsl?: boolean;
	stateRoot?: string;
	registry?: WikiRegistration[];
	states?: Map<string, IndexStateLite>;
}

const SKIP_DIRECTORIES = new Set([
	"node_modules",
	".git",
	".cache",
	".bun",
	".cargo",
	".rustup",
	".local",
	".config",
	".venv",
	"venv",
	"env",
	"__pycache__",
	"dist",
	"build",
	"out",
	"target",
	".next",
	".nuxt",
	"coverage",
	"site-packages",
	"AppData",
	"Temp",
]);

const DEFAULT_MAX_DEPTH = 6;

export async function discoverWikis(options: DiscoverOptions = {}): Promise<DiscoveredWiki[]> {
	const roots = options.roots && options.roots.length > 0 ? options.roots : [homedir()];
	const maxDepth = Math.max(1, Math.min(options.maxDepth ?? DEFAULT_MAX_DEPTH, 12));
	const stateRoot = options.stateRoot ?? ".jev-wiki";
	const found = new Map<string, DiscoveredWiki>();

	for (const root of roots) {
		for (const entry of await scanRoot(root, maxDepth, stateRoot)) {
			found.set(entry.root, entry);
		}
	}
	if (options.wsl ?? process.platform === "win32") {
		for (const entry of await scanWsl(stateRoot)) {
			if (!found.has(entry.root)) found.set(entry.root, entry);
		}
	}

	for (const registration of options.registry ?? []) {
		const root = normalizeRoot(registration.root);
		const existing = found.get(root);
		if (existing) {
			existing.registered = true;
			existing.enabled = registration.enabled;
			if (existing.name !== registration.name) existing.name = registration.name;
			continue;
		}
		const describe = await describeRoot(root, "registry", "registry", stateRoot);
		found.set(root, {
			...describe,
			name: registration.name,
			registered: true,
			enabled: registration.enabled,
			missing: !existsSync(root),
		});
	}

	const states = options.states;
	if (states) {
		for (const entry of found.values()) {
			const state = states.get(entry.name);
			if (state) {
				entry.chunks = state.chunks;
				entry.model = state.model;
				entry.updatedAt = state.updatedAt;
			}
		}
	}
	return [...found.values()].sort((a, b) => b.pages - a.pages || a.root.localeCompare(b.root));
}

/** Default scan roots: the user's home directory, plus config-provided extras. */
export function scanRoots(configured?: string[]): string[] {
	const roots = (configured ?? []).filter(Boolean);
	if (roots.length === 0) roots.push(homedir());
	return roots.map((root) => normalizeRoot(resolve(root)));
}

export function maxScanDepth(configured?: number): number {
	if (!configured) return DEFAULT_MAX_DEPTH;
	return Math.max(1, Math.min(configured, 12));
}

async function scanRoot(start: string, maxDepth: number, stateRoot: string): Promise<DiscoveredWiki[]> {
	const found: DiscoveredWiki[] = [];
	const discovered = new Set<string>();
	const seen = new Set<string>();
	const stack: Array<{ dir: string; depth: number }> = [{ dir: normalizeRoot(start), depth: 0 }];

	while (stack.length > 0) {
		const { dir, depth } = stack.pop()!;
		if (seen.has(dir) || !existsSync(dir)) continue;
		seen.add(dir);

		const marker = await detectWikiRoot(dir);
		if (marker) {
			if (!discovered.has(dir)) {
				discovered.add(dir);
				found.push(await describeRoot(dir, marker, "filesystem", stateRoot));
			}
			continue; // a wiki root's children belong to that wiki
		}

		const configuredRoot = await projectConfigRoot(dir);
		if (configuredRoot && !discovered.has(configuredRoot) && (await detectWikiRoot(configuredRoot))) {
			discovered.add(configuredRoot);
			found.push(await describeRoot(configuredRoot, "project-config", "filesystem", stateRoot));
		}

		if (depth >= maxDepth) continue;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
			stack.push({ dir: normalizeRoot(join(dir, entry.name)), depth: depth + 1 });
		}
	}
	return found;
}

async function detectWikiRoot(dir: string): Promise<WikiMarker | undefined> {
	if (existsSync(join(dir, ".jev-wiki"))) return "state-dir";
	if (!existsSync(join(dir, "wiki"))) return undefined;
	if (existsSync(join(dir, "raw"))) return "docs-layout";
	if (existsSync(join(dir, "wiki", "index.md"))) return "docs-layout";
	return undefined;
}

async function projectConfigRoot(dir: string): Promise<string | undefined> {
	const configPath = join(dir, ".pi", "jev-wiki.json");
	if (!existsSync(configPath)) return undefined;
	try {
		const config = JSON.parse(await readFile(configPath, "utf8")) as { wikiRoot?: string };
		if (typeof config.wikiRoot !== "string" || !config.wikiRoot.trim()) return undefined;
		return normalizeRoot(resolve(dir, config.wikiRoot));
	} catch {
		return undefined;
	}
}

async function describeRoot(root: string, marker: WikiMarker, source: DiscoveredWiki["source"], stateRoot: string): Promise<DiscoveredWiki> {
	const pages = await countPages(resolveLayout(root, ".", stateRoot)).catch(() => 0);
	const rawSources = existsSync(join(root, "raw")) ? (await listMarkdownFiles(join(root, "raw"))).length : 0;
	return {
		root,
		name: wikiNameFor(root),
		marker,
		source,
		pages,
		rawSources,
		registered: false,
	};
}

/** Discover wikis inside WSL distros (Windows only), mapped to \\wsl.localhost paths. */
async function scanWsl(stateRoot: string): Promise<DiscoveredWiki[]> {
	if (process.platform !== "win32") return [];
	const distros = await run("wsl.exe", ["-l", "-q"], { timeout: 15_000, windowsHide: true })
		.then((result) => result.stdout.replace(/\0/g, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
		.catch(() => [] as string[]);
	const out: DiscoveredWiki[] = [];
	for (const distro of distros) {
		const script = [
			`find "$HOME" -maxdepth 6 \\( -name node_modules -o -name .git -o -name .cache -o -name .local -o -name .cargo -o -name .rustup -o -name .config -o -name .bun \\) -prune -o -type d -name .jev-wiki -print 2>/dev/null | head -30`,
			`find "$HOME" -maxdepth 6 -type d -path '*/docs/wiki' -print 2>/dev/null | head -30`,
		].join("; echo '---'; ");
		const result = await run("wsl.exe", ["-d", distro, "--", "bash", "-lc", script], { timeout: 60_000, windowsHide: true }).catch(() => undefined);
		if (!result) continue;
		const [stateDirs = "", docsCandidates = ""] = result.stdout.split(/\r?\n---\r?\n/);
		const roots = new Set<string>();
		for (const line of stateDirs.split(/\r?\n/)) {
			const path = line.trim();
			if (path.endsWith("/.jev-wiki")) roots.add(path.slice(0, -"/.jev-wiki".length));
		}
		for (const line of docsCandidates.split(/\r?\n/)) {
			const path = line.trim();
			if (path) roots.add(path);
		}
		for (const linuxRoot of roots) {
			const unc = normalizeRoot(["", "", "wsl.localhost", distro, ...linuxRoot.split("/").filter(Boolean)].join("\\"));
			if (!existsSync(join(unc, "wiki"))) continue;
			const described = await describeRoot(unc, "wsl", "wsl", stateRoot);
			out.push(described);
		}
	}
	return out;
}
