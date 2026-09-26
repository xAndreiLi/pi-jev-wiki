/**
 * User-level wiki registry: which wiki roots the vector index covers.
 * Lives at <agentDir>/jev-wiki/wikis.json so every session sees the same set.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

export interface WikiRegistration {
	name: string;
	root: string;
	enabled: boolean;
	added: string;
}

export interface WikiRegistry {
	wikis: WikiRegistration[];
}

export function registryPath(agentDir: string): string {
	return join(agentDir, "jev-wiki", "wikis.json");
}

export function vectorDataDir(agentDir: string): string {
	return join(agentDir, "jev-wiki", "vector");
}

export async function readRegistry(agentDir: string): Promise<WikiRegistry> {
	const path = registryPath(agentDir);
	if (!existsSync(path)) return { wikis: [] };
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as WikiRegistry;
		return { wikis: Array.isArray(parsed.wikis) ? parsed.wikis : [] };
	} catch {
		return { wikis: [] };
	}
}

export async function writeRegistry(agentDir: string, registry: WikiRegistry): Promise<void> {
	const path = registryPath(agentDir);
	await mkdir(join(agentDir, "jev-wiki"), { recursive: true });
	const temp = `${path}.tmp`;
	await writeFile(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
	await rename(temp, path);
}

export function normalizeRoot(root: string): string {
	return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

const GENERIC_SEGMENTS = new Set(["wiki", "docs", "documentation", "notes"]);

/** Derive a stable, human-friendly wiki name from its root path. */
export function wikiNameFor(root: string): string {
	const normalized = normalizeRoot(root);
	const segments = normalized.split("/").filter(Boolean);
	for (let index = segments.length - 1; index >= 0; index--) {
		const segment = segments[index];
		if (GENERIC_SEGMENTS.has(segment.toLowerCase())) continue;
		if (segment.toLowerCase() === basename(homedir()).toLowerCase()) return "home";
		const slug = segment
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		if (slug) return slug;
	}
	return "home";
}

export async function registerWiki(
	agentDir: string,
	root: string,
	options: { name?: string; enabled?: boolean } = {},
): Promise<{ registration: WikiRegistration; created: boolean }> {
	const registry = await readRegistry(agentDir);
	const normalized = normalizeRoot(root);
	const existing = registry.wikis.find((entry) => normalizeRoot(entry.root) === normalized);
	if (existing) return { registration: existing, created: false };

	const names = new Set(registry.wikis.map((entry) => entry.name));
	let name = options.name?.trim() || wikiNameFor(normalized);
	if (names.has(name)) {
		let index = 2;
		while (names.has(`${name}-${index}`)) index += 1;
		name = `${name}-${index}`;
	}
	const registration: WikiRegistration = {
		name,
		root: normalized,
		enabled: options.enabled ?? true,
		added: new Date().toISOString(),
	};
	registry.wikis.push(registration);
	await writeRegistry(agentDir, registry);
	return { registration, created: true };
}

/**
 * Resolve a path the user named (project root or wiki root) to the wiki root —
 * the directory that contains the `wiki/` pages. Checks the project's
 * `.pi/jev-wiki.json` wikiRoot, then the spec's default `docs/wiki`.
 */
export async function resolveWikiRoot(path: string): Promise<string> {
	const normalized = normalizeRoot(path);
	const candidates: string[] = [normalized];
	const configPath = join(normalized, ".pi", "jev-wiki.json");
	if (existsSync(configPath)) {
		try {
			const config = JSON.parse(await readFile(configPath, "utf8")) as { wikiRoot?: string };
			if (typeof config.wikiRoot === "string" && config.wikiRoot.trim()) candidates.push(resolve(normalized, config.wikiRoot));
		} catch {
			// Fall through to the default candidates.
		}
	}
	for (const candidate of [join(normalized, "docs", "wiki"), join(normalized, "wiki"), normalized]) {
		if (!candidates.includes(candidate)) candidates.push(candidate);
	}
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "wiki"))) return normalizeRoot(candidate);
	}
	throw new Error(`No wiki found at ${normalized} (looked for a wiki/ directory, docs/wiki, and the project .pi/jev-wiki.json wikiRoot).`);
}

export async function setWikiRoot(agentDir: string, name: string, root: string): Promise<WikiRegistration | undefined> {
	const registry = await readRegistry(agentDir);
	const registration = registry.wikis.find((entry) => entry.name === name);
	if (!registration) return undefined;
	registration.root = normalizeRoot(root);
	await writeRegistry(agentDir, registry);
	return registration;
}

export async function setWikiEnabled(agentDir: string, name: string, enabled: boolean): Promise<WikiRegistration | undefined> {
	const registry = await readRegistry(agentDir);
	const registration = registry.wikis.find((entry) => entry.name === name);
	if (!registration) return undefined;
	registration.enabled = enabled;
	await writeRegistry(agentDir, registry);
	return registration;
}

export async function unregisterWiki(agentDir: string, name: string): Promise<WikiRegistration | undefined> {
	const registry = await readRegistry(agentDir);
	const index = registry.wikis.findIndex((entry) => entry.name === name);
	if (index === -1) return undefined;
	const [removed] = registry.wikis.splice(index, 1);
	await writeRegistry(agentDir, registry);
	return removed;
}

export function enabledWikiNames(registry: WikiRegistry): string[] {
	return registry.wikis.filter((entry) => entry.enabled).map((entry) => entry.name);
}
