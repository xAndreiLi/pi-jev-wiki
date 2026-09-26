/**
 * Per-wiki TOC manifest: a small derived cache written beside `index.md` so
 * cross-wiki overviews can read metadata without parsing pages. Never a source
 * of truth — `index.md` stays authoritative, and the manifest carries a hash of
 * the entries it was generated from.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { listMarkdownFiles, writeTextAtomic, type WikiLayout } from "./layout.ts";
import type { TocEntry } from "./toc.ts";

export const GENERATED_PAGE_FILES = new Set(["index.md", "log.md", "toc.md"]);

/** True for generated TOC/log files, which are never knowledge pages. */
export function isGeneratedPage(relPath: string): boolean {
	const rel = relPath.replace(/\\/g, "/");
	const base = rel.split("/").pop() ?? rel;
	return GENERATED_PAGE_FILES.has(base) || rel.startsWith("toc/");
}

/** Count real wiki pages (markdown, excluding generated TOC/log files). */
export async function countPages(layout: WikiLayout): Promise<number> {
	if (!existsSync(layout.wikiDir)) return 0;
	const files = await listMarkdownFiles(layout.wikiDir);
	return files.filter((file) => !isGeneratedPage(relative(layout.wikiDir, file))).length;
}

/** Newest mtime across a wiki's real pages (used for staleness checks). */
export async function newestPageMtime(layout: WikiLayout): Promise<string | undefined> {
	if (!existsSync(layout.wikiDir)) return undefined;
	const files = await listMarkdownFiles(layout.wikiDir);
	let newest = 0;
	for (const file of files) {
		if (isGeneratedPage(relative(layout.wikiDir, file))) continue;
		const info = await stat(file).catch(() => undefined);
		if (info && info.mtimeMs > newest) newest = info.mtimeMs;
	}
	return newest > 0 ? new Date(newest).toISOString() : undefined;
}

/** Stable hash of the TOC entries, used to detect drift from index.md. */
export function entriesHash(entries: TocEntry[]): string {
	const canonical = [...entries]
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((entry) => [entry.path, entry.title, entry.type, entry.summary, entry.updated, entry.tags.join(",")].join("\u0000"))
		.join("\n");
	return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

export interface TocManifest {
	generatedAt: string;
	pages: number;
	topics: Array<{ slug: string; count: number }>;
	entriesHash: string;
	newestPageMtime?: string;
}

export function manifestPath(layout: WikiLayout): string {
	return join(layout.stateDir, "toc.json");
}

/** Write the manifest for a freshly written TOC (called by the TOC writer). */
export async function writeManifest(layout: WikiLayout, entries: TocEntry[]): Promise<TocManifest> {
	const topics = new Map<string, number>();
	for (const entry of entries) {
		const topic = entry.path.includes("/") ? entry.path.split("/")[0] : "general";
		topics.set(topic, (topics.get(topic) ?? 0) + 1);
	}
	const newest = await newestPageMtime(layout).catch(() => undefined);
	const manifest: TocManifest = {
		generatedAt: new Date().toISOString(),
		pages: entries.length,
		topics: [...topics.entries()].sort((a, b) => b[1] - a[1]).map(([slug, count]) => ({ slug, count })),
		entriesHash: entriesHash(entries),
		...(newest ? { newestPageMtime: newest } : {}),
	};
	await writeTextAtomic(manifestPath(layout), `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

export async function readManifest(layout: WikiLayout): Promise<TocManifest | undefined> {
	const path = manifestPath(layout);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as TocManifest;
		return typeof parsed?.generatedAt === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}
