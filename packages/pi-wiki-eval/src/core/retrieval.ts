/**
 * What the wiki returned, and whether the agent still went looking.
 *
 * Two optional inputs from pi-jev-wiki's on-disk state, both read defensively because the evaluator
 * must also measure projects that never installed it:
 *
 *   - `<stateDir>/metrics.jsonl` — one `ask` row per wiki_ask, with the pages it returned.
 *   - page frontmatter `files:` — the code files a page claims to describe.
 *
 * Rediscovery rate is the join of those with what the agent did next: of the files declared by the
 * pages retrieved during an episode, how many did the agent read itself afterwards? A wiki that
 * answered the question should show a low rate; a wiki visited on the way to reading the code shows
 * a high one. The join needs no model call, so both arms are measured identically.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Episode } from "./episodes.js";

export interface WikiLayout {
	root: string;
	stateDir: string;
	pagesDir: string;
	/** False when the directory exists but carries no pages. */
	hasPages: boolean;
}

export interface RetrievalEvent {
	ts: string;
	query?: string;
	pages: string[];
}

export interface PageFileLinks {
	/** Page path relative to the wiki root, using POSIX separators. */
	page: string;
	files: string[];
}

export interface RediscoveryJoin {
	page: string;
	declared: string[];
	rediscovered: string[];
}

export interface Rediscovery {
	retrievedPages: string[];
	/** Pages that declared at least one `files:` link — the only ones the metric can use. */
	measurablePages: string[];
	joins: RediscoveryJoin[];
	declaredCount: number;
	rediscoveredCount: number;
	/** rediscovered ÷ declared, or null when no retrieved page declared any files. */
	rate: number | null;
}

/** Resolve the wiki layout for a project, honouring pi-jev-wiki's project config when present. */
export async function resolveWikiLayout(projectDir: string): Promise<WikiLayout | undefined> {
	let wikiRoot = "docs/wiki";
	const configPath = join(projectDir, ".pi", "jev-wiki.json");
	if (existsSync(configPath)) {
		try {
			const parsed = JSON.parse(await readFile(configPath, "utf8")) as { wikiRoot?: unknown };
			if (typeof parsed.wikiRoot === "string" && parsed.wikiRoot.trim()) wikiRoot = parsed.wikiRoot.trim();
		} catch {
			/* malformed config: fall back to the default root */
		}
	}
	const root = join(projectDir, wikiRoot);
	if (!existsSync(root)) return undefined;
	const pagesCandidate = join(root, "wiki");
	const pagesDir = existsSync(pagesCandidate) ? pagesCandidate : root;
	const stateDir = join(root, ".jev-wiki");
	return { root, stateDir, pagesDir, hasPages: existsSync(pagesDir) };
}

/** Retrieval events recorded by wiki_ask. Missing or malformed state yields an empty list. */
export async function readRetrievalEvents(stateDir: string): Promise<RetrievalEvent[]> {
	const path = join(stateDir, "metrics.jsonl");
	if (!existsSync(path)) return [];
	const events: RetrievalEvent[] = [];
	for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line) as { ts?: unknown; op?: unknown; query?: unknown; pages?: unknown };
			if (row.op !== "ask" || typeof row.ts !== "string") continue;
			const pages = Array.isArray(row.pages) ? row.pages.filter((page): page is string => typeof page === "string") : [];
			events.push({ ts: row.ts, pages, ...(typeof row.query === "string" ? { query: row.query } : {}) });
		} catch {
			/* a partially written metrics row is not worth failing a report over */
		}
	}
	return events;
}

/** Inline `files: [a, b]` or a block list under `files:`. Unknown shapes are ignored, not guessed. */
export function parseFilesField(frontmatter: string): string[] {
	const lines = frontmatter.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		const match = /^files:\s*(.*)$/.exec(line);
		if (!match) continue;
		const inline = match[1]?.trim() ?? "";
		if (inline.startsWith("[") && inline.endsWith("]")) {
			return inline
				.slice(1, -1)
				.split(",")
				.map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
		}
		if (inline === "" || inline === "[]") {
			const block: string[] = [];
			for (let cursor = index + 1; cursor < lines.length; cursor++) {
				const nested = /^\s*-\s*(.+)$/.exec(lines[cursor] ?? "");
				if (!nested) break;
				block.push((nested[1] ?? "").trim().replace(/^["']|["']$/g, ""));
			}
			return block;
		}
	}
	return [];
}

async function listMarkdown(dir: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(current: string): Promise<void> {
		let entries;
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
			} else if (entry.name.endsWith(".md")) {
				found.push(full);
			}
		}
	}
	await walk(dir);
	return found.sort();
}

/** Page → declared code files, from frontmatter. Pages without a `files:` field are omitted. */
export async function readPageFileLinks(layout: WikiLayout): Promise<Map<string, string[]>> {
	const map = new Map<string, string[]>();
	for (const path of await listMarkdown(layout.pagesDir)) {
		let text: string;
		try {
			text = await readFile(path, "utf8");
		} catch {
			continue;
		}
		if (!text.startsWith("---")) continue;
		const end = text.indexOf("\n---", 3);
		if (end < 0) continue;
		const files = parseFilesField(text.slice(3, end));
		if (files.length === 0) continue;
		map.set(relative(layout.root, path).replace(/[\\/]+/g, "/"), files);
	}
	return map;
}

/** Compare a declared page path with a page name as recorded in metrics. */
export function samePage(a: string, b: string): boolean {
	const clean = (value: string): string =>
		value
			.replace(/[\\/]+/g, "/")
			.replace(/^\.\//, "")
			.replace(/^wiki\//, "")
			.replace(/\.md$/, "")
			.toLowerCase();
	return clean(a) === clean(b) || clean(a).endsWith(`/${clean(b)}`) || clean(b).endsWith(`/${clean(a)}`);
}

/** Compare a `files:` entry with a path the agent read. Accepts absolute, relative, and basename forms. */
export function pathMatches(declared: string, read: string): boolean {
	const clean = (value: string): string => value.replace(/[\\/]+/g, "/").replace(/^\.\//, "").toLowerCase();
	const left = clean(declared);
	const right = clean(read);
	if (!left || !right) return false;
	if (left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)) return true;
	const base = (value: string): string => value.slice(value.lastIndexOf("/") + 1);
	return base(left) === base(right);
}

/** Attribute retrieval events to episodes by timestamp, then ask what the agent read anyway. */
export function joinRediscovery(
	episode: Episode,
	events: RetrievalEvent[],
	pageFiles: Map<string, string[]>,
	windowEnd?: string,
): Rediscovery {
	const empty: Rediscovery = { retrievedPages: [], measurablePages: [], joins: [], declaredCount: 0, rediscoveredCount: 0, rate: null };
	const start = episode.startedAt ? Date.parse(episode.startedAt) : Number.NaN;
	// An episode that never settled has no end of its own. The caller supplies the session's last
	// timestamp; without a bound there is none, and attributing every later event to that episode
	// would quietly inflate its retrieval set with other episodes' work.
	const end = windowEnd ? Date.parse(windowEnd) : episode.endedAt ? Date.parse(episode.endedAt) : Number.NaN;
	if (!Number.isFinite(start) || !Number.isFinite(end)) return empty;
	const retrieved: string[] = [];
	for (const event of events) {
		const at = Date.parse(event.ts);
		if (!Number.isFinite(at) || at < start || at > end) continue;
		for (const page of event.pages) if (!retrieved.includes(page)) retrieved.push(page);
	}
	const joins: RediscoveryJoin[] = [];
	let declaredCount = 0;
	let rediscoveredCount = 0;
	for (const page of retrieved) {
		const declared = [...pageFiles.entries()].find(([key]) => samePage(key, page))?.[1];
		if (!declared || declared.length === 0) continue;
		const rediscovered = declared.filter((file) => episode.readFiles.some((read) => pathMatches(file, read)));
		joins.push({ page, declared, rediscovered });
		declaredCount += declared.length;
		rediscoveredCount += rediscovered.length;
	}
	return {
		retrievedPages: retrieved,
		measurablePages: joins.map((join) => join.page),
		joins,
		declaredCount,
		rediscoveredCount,
		rate: declaredCount === 0 ? null : rediscoveredCount / declaredCount,
	};
}
