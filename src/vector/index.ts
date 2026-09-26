/**
 * Index orchestration: pages → chunks → embeddings → PGlite. Incremental by
 * content hash; a model change purges the previous model's rows for that wiki.
 */
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { listMarkdownFiles, readPage, resolveLayout } from "../wiki/layout.ts";
import { chunkPage, type WikiPageInput } from "./chunks.ts";
import { createLocalProvider, modelsDir, resolvePreset, type EmbeddingProvider } from "./embed.ts";
import { vectorDbFor, type IndexState } from "./db.ts";
import { readRegistry, vectorDataDir } from "./registry.ts";

export interface IndexOptions {
	agentDir: string;
	wiki: string;
	root: string;
	model: string;
	dimensions?: number;
	/** Restrict reindexing to these page paths (relative to the wiki dir). */
	paths?: string[];
	/** Use this provider instead of loading a local model (tests, future backends). */
	provider?: EmbeddingProvider;
}

export interface IndexReport {
	wiki: string;
	model: string;
	dim: number;
	embedded: number;
	removed: number;
	skipped: number;
	total: number;
	milliseconds: number;
}

const GENERATED = new Set(["index.md", "log.md"]);

export async function indexWiki(options: IndexOptions): Promise<IndexReport> {
	const started = Date.now();
	const layout = resolveLayout(options.root, ".", ".jev-wiki");
	if (!existsSync(layout.wikiDir)) throw new Error(`Wiki pages not found at ${layout.wikiDir}`);
	const preset = resolvePreset(options.model);
	const dimensions = options.dimensions ?? preset.dimensions;

	const scope = options.paths && options.paths.length > 0 ? new Set(options.paths.map(normalizePath)) : undefined;
	const files = (await listMarkdownFiles(layout.wikiDir))
		.map((absolute) => relative(layout.wikiDir, absolute).replace(/\\/g, "/"))
		.filter((rel) => !GENERATED.has(rel) && !rel.startsWith("toc/"))
		.filter((rel) => !scope || scope.has(rel));

	const chunks: Array<{ path: string; chunk: ReturnType<typeof chunkPage>[number] }> = [];
	for (const rel of files) {
		const page = await readPage(join(layout.wikiDir, rel));
		const input = pageInput(rel, page);
		for (const chunk of chunkPage(input)) chunks.push({ path: rel, chunk });
	}

	const db = vectorDbFor(vectorDataDir(options.agentDir));
	await db.init();
	const existing = await db.hashes(options.wiki, options.model, scope ? [...scope] : undefined);

	const pending: Array<{ path: string; chunk: (typeof chunks)[number]["chunk"] }> = [];
	let skipped = 0;
	for (const entry of chunks) {
		const current = existing.get(`${entry.path}\u0000${entry.chunk.key}`);
		if (current && current.hash === entry.chunk.hash) skipped += 1;
		else pending.push(entry);
	}

	const removed: Array<{ path: string; key: string }> = [];
	const currentKeys = new Set(chunks.map((entry) => `${entry.path}\u0000${entry.chunk.key}`));
	for (const key of existing.keys()) if (!currentKeys.has(key)) removed.push(splitKey(key));
	await db.deleteKeys(options.wiki, removed);

	let embedded = 0;
	if (pending.length > 0) {
		const provider = options.provider ?? (await createLocalProvider({
			preset,
			...(options.dimensions !== undefined ? { dimensions: options.dimensions } : {}),
			cacheDir: modelsDir(options.agentDir),
			onProgress: (message) => console.log(`[jev-wiki] embedding model: ${message}`),
		}));
		const vectors = await provider.embed(
			pending.map((entry) => ({ title: entry.chunk.title, text: entry.chunk.text })),
			"document",
		);
		const rows = pending.map((entry, index) => ({
			wiki: options.wiki,
			path: entry.path,
			key: entry.chunk.key,
			kind: entry.chunk.kind,
			claimId: entry.chunk.claimId ?? null,
			status: entry.chunk.status ?? null,
			title: entry.chunk.title,
			text: entry.chunk.text,
			hash: entry.chunk.hash,
			model: options.model,
			dim: provider.dimensions,
			embedding: vectors[index],
		}));
		await db.upsert(rows);
		embedded = rows.length;
	}

	if (!scope) await db.purgeOtherModels(options.wiki, options.model);
	const totals = await db.hashes(options.wiki, options.model);
	const state: IndexState = {
		wiki: options.wiki,
		model: options.model,
		dim: dimensions,
		chunks: totals.size,
		updatedAt: new Date().toISOString(),
	};
	await db.setState(state);
	return {
		wiki: options.wiki,
		model: options.model,
		dim: dimensions,
		embedded,
		removed: removed.length,
		skipped,
		total: totals.size,
		milliseconds: Date.now() - started,
	};
}

export interface VectorStatus {
	preset: string;
	repo: string;
	dimensions: number;
	downloadBytes: number;
	modelsDir: string;
	modelsBytes: number;
	registry: Awaited<ReturnType<typeof readRegistry>>;
	states: Array<IndexState & { name: string; root: string; enabled: boolean }>;
	dbAvailable: boolean;
	error?: string;
}

export async function vectorStatus(agentDir: string, model: string, dimensions?: number): Promise<VectorStatus> {
	const preset = resolvePreset(model);
	const registry = await readRegistry(agentDir);
	const db = vectorDbFor(vectorDataDir(agentDir));
	const states: VectorStatus["states"] = [];
	let dbAvailable = true;
	let error: string | undefined;
	try {
		await db.init();
	} catch (cause) {
		dbAvailable = false;
		error = cause instanceof Error ? cause.message : String(cause);
	}
	for (const entry of registry.wikis) {
		const state = dbAvailable ? await db.state(entry.name) : undefined;
		if (state) states.push({ ...state, name: entry.name, root: entry.root, enabled: entry.enabled });
	}
	return {
		preset: preset.id,
		repo: preset.repo,
		dimensions: dimensions ?? preset.dimensions,
		downloadBytes: preset.expectedBytes,
		modelsDir: modelsDir(agentDir),
		modelsBytes: await modelsCacheBytes(modelsDir(agentDir)),
		registry,
		states,
		dbAvailable,
		...(error ? { error } : {}),
	};
}

/** True when the wiki has been indexed for this model (an empty index still counts). */
export async function hasWarmIndex(agentDir: string, wiki: string, model: string): Promise<boolean> {
	const db = vectorDbFor(vectorDataDir(agentDir));
	await db.init();
	const state = await db.state(wiki);
	if (state && state.model === model) return true;
	const counts = await db.counts();
	return counts.some((entry) => entry.wiki === wiki && entry.model === model && entry.chunks > 0);
}

/** True when any wiki has chunks or build state in the index database. */
export async function indexExists(agentDir: string): Promise<boolean> {
	const db = vectorDbFor(vectorDataDir(agentDir));
	await db.init();
	if (await db.hasAny()) return true;
	const counts = await db.counts();
	return counts.length > 0;
}

/** Total bytes of the local model cache (used for first-run status messages). */
export async function modelsCacheBytes(dir: string): Promise<number> {
	if (!existsSync(dir)) return 0;
	let total = 0;
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) total += await modelsCacheBytes(path);
		else if (entry.isFile()) total += (await stat(path).catch(() => undefined))?.size ?? 0;
	}
	return total;
}

export async function forgetWikiIndex(agentDir: string, wiki: string): Promise<void> {
	const db = vectorDbFor(vectorDataDir(agentDir));
	await db.init();
	await db.purgeWiki(wiki);
}

function pageInput(rel: string, page: { data: Record<string, unknown>; body: string }): WikiPageInput {
	const title = typeof page.data.title === "string" && page.data.title.trim() ? page.data.title.trim() : rel.replace(/\.md$/, "");
	const rawClaims = Array.isArray(page.data.claims) ? (page.data.claims as Array<Record<string, unknown>>) : [];
	const claims = rawClaims
		.filter((claim) => typeof claim.text === "string")
		.map((claim) => ({
			...(typeof claim.id === "string" ? { id: claim.id } : {}),
			text: String(claim.text),
			...(typeof claim.status === "string" ? { status: claim.status } : {}),
		}));
	return { path: rel, title, body: page.body, claims };
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function splitKey(key: string): { path: string; key: string } {
	const index = key.indexOf("\u0000");
	return { path: key.slice(0, index), key: key.slice(index + 1) };
}
