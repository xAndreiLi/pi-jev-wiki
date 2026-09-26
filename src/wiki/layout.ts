/**
 * Wiki filesystem layout: paths, atomic writes, hashing, and page I/O.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter, serializeFrontmatter, type Frontmatter } from "./frontmatter.ts";

export interface WikiLayout {
	root: string;
	rawDir: string;
	wikiDir: string;
	stateDir: string;
	ledgerPath: string;
	reviewQueuePath: string;
	sessionLogPath: string;
}

export function resolveLayout(cwd: string, wikiRoot: string, stateRoot = ".jev-wiki"): WikiLayout {
	const root = resolve(cwd, wikiRoot);
	const stateDir = isAbsolute(stateRoot) ? stateRoot : join(root, stateRoot);
	return {
		root,
		rawDir: join(root, "raw"),
		wikiDir: join(root, "wiki"),
		stateDir,
		ledgerPath: join(stateDir, "decisions.jsonl"),
		reviewQueuePath: join(stateDir, "review-queue.jsonl"),
		sessionLogPath: join(stateDir, "session-log.jsonl"),
	};
}

export async function ensureLayout(layout: WikiLayout): Promise<void> {
	for (const dir of [layout.rawDir, layout.wikiDir, layout.stateDir]) {
		await mkdir(dir, { recursive: true });
	}
}

export function slugify(input: string, maxLength = 60): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (slug.length <= maxLength) return slug || "untitled";
	const clipped = slug.slice(0, maxLength);
	const boundary = clipped.lastIndexOf("-");
	// Prefer a clean word boundary unless it would discard most of the allowance.
	const cut = boundary >= Math.max(8, Math.floor(maxLength * 0.6)) ? clipped.slice(0, boundary) : clipped;
	const result = cut.replace(/-+$/g, "");
	return result || "untitled";
}

export function todayISO(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

/** Normalize CRLF/CR to LF so hashes and stored sources do not depend on the editor. */
export function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

export function timeStamp(date = new Date()): string {
	return date.toISOString().slice(11, 16).replace(":", "");
}

export async function sha256Hex(text: string): Promise<string> {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function writeTextAtomic(absPath: string, text: string): Promise<void> {
	await withFileMutationQueue(absPath, async () => {
		await mkdir(dirname(absPath), { recursive: true });
		const temp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
		await writeFile(temp, text, "utf8");
		await rename(temp, absPath);
	});
}

export async function readPage(absPath: string): Promise<Frontmatter & { path: string }> {
	const text = await readFile(absPath, "utf8");
	const { data, body } = parseFrontmatter(text);
	return { data, body, path: absPath };
}

export async function writePage(absPath: string, data: Record<string, unknown>, body: string): Promise<void> {
	await writeTextAtomic(absPath, serializeFrontmatter(data, body));
}

export async function writeRawSource(
	layout: WikiLayout,
	topic: string,
	slug: string,
	data: Record<string, unknown>,
	body: string,
): Promise<string> {
	const dir = join(layout.rawDir, slugify(topic, 40));
	const base = `${todayISO()}-${slugify(slug)}`;
	let path = join(dir, `${base}.md`);
	if (existsSync(path)) {
		// Never overwrite a source: same-day/same-title (or same-minute session) captures
		// get a content-hash suffix, keeping raw/ append-only.
		const suffix = (await sha256Hex(body)).slice(0, 8);
		path = join(dir, `${base}-${suffix}.md`);
		let counter = 2;
		while (existsSync(path)) path = join(dir, `${base}-${suffix}-${counter++}.md`);
	}
	await writePage(path, data, body);
	return path;
}

export function relativeTo(fromDir: string, to: string): string {
	const rel = relative(fromDir, to).split("\\").join("/");
	return rel.startsWith(".") ? rel : `./${rel}`;
}

export function toPosix(path: string): string {
	return path.split("\\").join("/");
}

export async function listMarkdownFiles(dir: string): Promise<string[]> {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	async function walk(current: string): Promise<void> {
		const entries = await readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === ".jev-wiki" || entry.name === "raw" || entry.name === "toc") continue;
				await walk(full);
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				out.push(full);
			}
		}
	}
	await walk(dir);
	return out.sort();
}

export async function removeFileIfExists(path: string): Promise<void> {
	if (existsSync(path)) await rm(path, { force: true });
}
