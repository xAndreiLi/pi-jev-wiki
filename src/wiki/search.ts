/**
 * Wiki search: pluggable engines behind one interface.
 *   index  — table-of-contents matching plus naive token scan (small wikis)
 *   bm25   — in-process BM25 over page content (up to a few thousand pages)
 *   qmd    — optional adapter to the qmd CLI (hybrid BM25 + vectors + rerank)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResolvedConfig } from "../config.ts";
import { listMarkdownFiles, type WikiLayout } from "./layout.ts";
import { readIndex, type TocEntry } from "./toc.ts";

const run = promisify(execFile);

export interface SearchResult {
	path: string;
	title: string;
	score: number;
	excerpt: string;
	source?: "project" | "global";
}

export interface SearchOptions {
	limit?: number;
	query: string;
}

export interface SearchEngine {
	name: string;
	search(options: SearchOptions): Promise<SearchResult[]>;
}

const STOPWORDS = new Set([
	"the", "and", "for", "with", "that", "this", "from", "into", "when", "what", "where", "which", "does", "how", "why",
	"are", "was", "were", "has", "have", "had", "not", "but", "can", "could", "should", "would", "about", "over", "under",
]);

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_]+/)
		.filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

interface Doc {
	path: string;
	title: string;
	tags: string[];
	summary: string;
	text: string;
	length: number;
}

async function loadDocs(layout: WikiLayout): Promise<Doc[]> {
	const files = await listMarkdownFiles(layout.wikiDir);
	const entries = await readIndex(layout);
	const byPath = new Map<string, TocEntry>(entries.map((entry) => [entry.path, entry]));
	const docs: Doc[] = [];
	for (const file of files) {
		const rel = relative(layout.wikiDir, file).split("\\").join("/");
		if (rel === "index.md" || rel === "log.md") continue;
		try {
			const raw = await readFile(file, "utf8");
			const entry = byPath.get(rel);
			docs.push({
				path: rel,
				title: entry?.title ?? rel,
				tags: entry?.tags ?? [],
				summary: entry?.summary ?? "",
				text: raw,
				length: tokenize(raw).length || 1,
			});
		} catch {
			/* skip unreadable */
		}
	}
	return docs;
}

function excerptFor(doc: Doc, queryTokens: Set<string>): string {
	const lines = doc.text.split(/\r?\n/);
	const hits = lines
		.filter((line) => {
			const lower = line.toLowerCase();
			return [...queryTokens].some((token) => lower.includes(token));
		})
		.slice(0, 3);
	return (hits.length > 0 ? hits : lines.filter((line) => line.trim()).slice(0, 2))
		.map((line) => line.trim().slice(0, 240))
		.join("\n");
}

/** BM25 with field boosts: title x3, summary/tags x2, body x1. */
class Bm25Index {
	private docs: Doc[] = [];
	private df = new Map<string, number>();
	private avgLength = 1;
	private built = 0;

	async ensure(layout: WikiLayout): Promise<void> {
		if (this.built > 0) return;
		this.docs = await loadDocs(layout);
		this.df = new Map();
		let total = 0;
		for (const doc of this.docs) {
			const unique = new Set(tokenize(doc.text));
			for (const token of unique) this.df.set(token, (this.df.get(token) ?? 0) + 1);
			total += doc.length;
		}
		this.avgLength = this.docs.length > 0 ? total / this.docs.length : 1;
		this.built = Date.now();
	}

	search(query: string, limit: number): SearchResult[] {
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];
		const querySet = new Set(tokens);
		const k1 = 1.2;
		const b = 0.75;
		const scored = this.docs.map((doc) => {
			const bodyTokens = tokenize(doc.text);
			const counts = new Map<string, number>();
			for (const token of bodyTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
			const titleTokens = new Set(tokenize(doc.title));
			const metaTokens = new Set([...tokenize(doc.summary), ...tokenize(doc.tags.join(" "))]);
			let score = 0;
			for (const token of querySet) {
				const df = this.df.get(token) ?? 0;
				if (df === 0) continue;
				const idf = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
				const tf = counts.get(token) ?? 0;
				const bodyScore = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / this.avgLength));
				const boost = titleTokens.has(token) ? 3 : metaTokens.has(token) ? 2 : 1;
				score += idf * bodyScore * boost;
			}
			return { doc, score };
		});
		return scored
			.filter((entry) => entry.score > 0)
			.sort((a, b2) => b2.score - a.score)
			.slice(0, limit)
			.map((entry) => ({
				path: entry.doc.path,
				title: entry.doc.title,
				score: Number(entry.score.toFixed(3)),
				excerpt: excerptFor(entry.doc, querySet),
			}));
	}
}

const bm25Cache = new Map<string, Bm25Index>();

export class IndexSearchEngine implements SearchEngine {
	readonly name = "index";
	constructor(private readonly layout: WikiLayout) {}
	async search(options: SearchOptions): Promise<SearchResult[]> {
		return this.indexFallback(options);
	}
	private async indexFallback(options: SearchOptions): Promise<SearchResult[]> {
		const entries = await readIndex(this.layout);
		const tokens = tokenize(options.query);
		const scored = entries
			.map((entry) => {
				const haystack = `${entry.title} ${entry.summary} ${entry.tags.join(" ")}`.toLowerCase();
				const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
				return { entry, score };
			})
			.filter((item) => item.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, options.limit ?? 5);
		return scored.map(({ entry, score }) => ({
			path: entry.path,
			title: entry.title,
			score,
			excerpt: entry.summary,
		}));
	}
}

export class Bm25SearchEngine implements SearchEngine {
	readonly name = "bm25";
	constructor(private readonly layout: WikiLayout) {}
	async search(options: SearchOptions): Promise<SearchResult[]> {
		const key = this.layout.wikiDir;
		let index = bm25Cache.get(key);
		if (!index) {
			index = new Bm25Index();
			bm25Cache.set(key, index);
		}
		await index.ensure(this.layout);
		return index.search(options.query, options.limit ?? 5);
	}
}

export class QmdSearchEngine implements SearchEngine {
	readonly name = "qmd";
	private readonly fallback: SearchEngine;
	constructor(
		private readonly layout: WikiLayout,
		collection?: string,
	) {
		this.collection = collection;
		this.fallback = new Bm25SearchEngine(layout);
	}
	private collection?: string;
	async search(options: SearchOptions): Promise<SearchResult[]> {
		try {
			const args = ["search", options.query, "--json", "-n", String(options.limit ?? 5)];
			if (this.collection) args.push("-c", this.collection);
			const { stdout } = await run("qmd", args, { maxBuffer: 4 * 1024 * 1024 });
			const parsed = JSON.parse(stdout) as Array<{ path?: string; docid?: string; score?: number; snippet?: string; title?: string }>;
			return parsed.slice(0, options.limit ?? 5).map((item) => ({
				path: item.path ?? item.docid ?? "(unknown)",
				title: item.title ?? item.path ?? "(unknown)",
				score: typeof item.score === "number" ? item.score : 0,
				excerpt: item.snippet ?? "",
			}));
		} catch {
			return this.fallback.search(options);
		}
	}
}

export function createSearchEngine(config: ResolvedConfig, layout: WikiLayout, globalLayout?: WikiLayout): SearchEngine {
	const engines: SearchEngine[] = [];
	if (config.search.engine === "qmd") engines.push(new QmdSearchEngine(layout, config.search.qmdCollection));
	if (config.search.engine === "bm25") engines.push(new Bm25SearchEngine(layout));
	if (engines.length === 0) engines.push(new IndexSearchEngine(layout));
	if (globalLayout && existsSync(globalLayout.wikiDir)) engines.push(new Bm25SearchEngine(globalLayout));
	const primary = engines[0];
	if (engines.length <= 1) return primary;
	return {
		name: `${primary.name}+global`,
		async search(options) {
			const results: SearchResult[] = [];
			for (const [index, engine] of engines.entries()) {
				const hits = await engine.search({ ...options, limit: Math.max(3, Math.round((options.limit ?? 5) / engines.length)) });
				for (const hit of hits) results.push({ ...hit, source: index === 0 ? "project" : "global" });
			}
			return results.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 5);
		},
	};
}
