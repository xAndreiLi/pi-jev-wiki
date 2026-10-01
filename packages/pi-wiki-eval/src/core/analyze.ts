/**
 * The pipeline: session files → active branch → episodes → classification → retrieval join → totals.
 *
 * Everything is derived from files that already exist on disk. No network, no model calls, and no
 * dependency on pi-jev-wiki — which is what lets the same code measure a session with the wiki
 * installed and one without it.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { activePath, listSessionFiles, projectSlug, readTranscript, resolveAgentPaths, sameDir, type SessionEntry } from "./sessions.js";
import { emptyUsage, segmentEpisodes, type Episode, type EpisodeUsage } from "./episodes.js";
import { joinRediscovery, readPageFileLinks, readRetrievalEvents, resolveWikiLayout, type Rediscovery, type WikiLayout } from "./retrieval.js";
import type { Bucket } from "./classify.js";

export interface AnalyzeOptions {
	projectDir: string;
	agentDir?: string;
	sessionsRoot?: string;
	sinceDays?: number;
	includeQueries?: boolean;
	/** Keep only this many episodes in the result, most expensive first. Zero keeps all. */
	episodeLimit?: number;
	/** Read sessions from exactly this directory instead of deriving it from the project path. */
	sessionDir?: string;
}

export interface SessionSummary {
	path: string;
	startedAt?: string;
	endedAt?: string;
	episodes: number;
	bytes: number;
	warnings: string[];
	branchNote?: string;
}

export interface AnalyzedEpisode extends Episode {
	/** Chronological, project-wide identifier (`E01`). Episode.index is per session and collides. */
	label: string;
	retrieval: Rediscovery;
}

export interface ProjectAnalysis {
	projectDir: string;
	generatedAt: string;
	wiki?: { root: string; stateDir: string; pagesWithLinks: number; retrievalEvents: number };
	sessions: SessionSummary[];
	episodes: AnalyzedEpisode[];
	totals: {
		episodes: number;
		requests: number;
		usage: EpisodeUsage;
		byBucket: Record<Bucket, number>;
		compactions: number;
		consultedEpisodes: number;
		consultationRate: number | null;
		readFiles: number;
		readChars: number;
		searches: number;
		wikiReads: number;
		wikiWrites: number;
		rediscovery: { declared: number; rediscovered: number; rate: number | null; pagesWithLinks: number };
		models: Array<{ model: string; requests: number }>;
		/**
		 * Retrieval attribution coverage: episodes that read the wiki but had no event matched to them.
		 * A missing metrics.jsonl and a genuinely empty retrieval look identical without this.
		 */
		retrievalAttribution: { episodesReadingWiki: number; episodesWithRetrieval: number };
	};
	windows: { from?: string; to?: string };
	notes: string[];
}

export async function analyzeProject(options: AnalyzeOptions): Promise<ProjectAnalysis> {
	const projectDir = options.projectDir;
	const notes: string[] = [];
	const paths = options.agentDir
		? { agentDir: options.agentDir, sessionsRoot: options.sessionsRoot ?? resolveAgentPaths().sessionsRoot }
		: resolveAgentPaths();
	const sessionsRoot = options.sessionsRoot ?? paths.sessionsRoot;

	const layout = await resolveWikiLayout(projectDir);
	// Both spellings matter: an absolute root for absolute paths, and the project-relative form,
	// because tool arguments are usually relative (`docs/wiki/wiki/x.md`) while the root is absolute.
	const wikiRoots = layout ? [layout.root, relative(projectDir, layout.root).replace(/[\\/]+/g, "/")] : [];
	if (!layout) notes.push("no wiki found for this project (docs/wiki missing) — wiki metrics will be zero, which is expected for a control run");

	// Fast path: pi stores a project's sessions under a slug directory. Fall back to scanning the
	// whole sessions root and matching the header cwd, which also catches renamed or moved projects.
	const slugDir = options.sessionDir ?? join(sessionsRoot, projectSlug(projectDir));
	const fast = existsSync(slugDir);
	const files = fast ? await listSessionFiles(slugDir) : await listSessionFiles(sessionsRoot);
	if (!fast) notes.push(`no session directory for this project under ${sessionsRoot}; scanned every session and matched on recorded cwd`);

	const cutoff = options.sinceDays && options.sinceDays > 0 ? Date.now() - options.sinceDays * 86_400_000 : undefined;
	const sessions: SessionSummary[] = [];
	const collected: Array<{ episode: Episode; retrieval: Rediscovery }> = [];
	let events: Awaited<ReturnType<typeof readRetrievalEvents>> = [];
	let pageFiles = new Map<string, string[]>();
	if (layout) {
		events = await readRetrievalEvents(layout.stateDir);
		pageFiles = await readPageFileLinks(layout);
		if (events.length === 0) notes.push("wiki state has no retrieval events (metrics.jsonl missing or empty) — consultation and rediscovery cannot be measured");
	}

	for (const path of files) {
		const transcript = await readTranscript(path);
		if (transcript.header && !sameDir(transcript.header.cwd, projectDir)) continue;
		if (cutoff && transcript.header) {
			const started = Date.parse(transcript.header.timestamp);
			if (Number.isFinite(started) && started < cutoff) continue;
		}
		const branch = activePath(transcript.entries);
		const segmented = segmentEpisodes(path, branch.entries, { wikiRoots }, { includeQueries: options.includeQueries });
		// The last timestamp in the file bounds an episode that never settled.
		const sessionEnd = lastTimestamp(transcript.entries) ?? transcript.header?.timestamp;
		for (const episode of segmented) {
			collected.push({ episode, retrieval: joinRediscovery(episode, events, pageFiles, episode.endedAt ?? sessionEnd) });
		}
		const summary: SessionSummary = {
			path,
			episodes: segmented.length,
			bytes: transcript.bytes,
			warnings: transcript.warnings,
		};
		if (transcript.header?.timestamp) summary.startedAt = transcript.header.timestamp;
		const last = segmented[segmented.length - 1]?.endedAt;
		if (last) summary.endedAt = last;
		if (branch.note) summary.branchNote = branch.note;
		sessions.push(summary);
	}

	collected.sort((a, b) => (a.episode.startedAt ?? "").localeCompare(b.episode.startedAt ?? ""));
	const episodes: AnalyzedEpisode[] = collected.map((item, position) => ({
		...item.episode,
		retrieval: item.retrieval,
		label: `E${String(position + 1).padStart(2, "0")}`,
	}));
	const usage = emptyUsage();
	const byBucket: Record<Bucket, number> = { explore: 0, wiki: 0, act: 0, verify: 0, other: 0 };
	const readFiles = new Set<string>();
	const models = new Map<string, number>();
	let requests = 0;
	let compactions = 0;
	let readChars = 0;
	let searches = 0;
	let wikiReads = 0;
	let wikiWrites = 0;
	let consulted = 0;
	let readingWiki = 0;
	let withRetrieval = 0;
	let declared = 0;
	let rediscovered = 0;
	for (const episode of episodes) {
		addUsage(usage, episode.usage);
		requests += episode.requests;
		compactions += episode.compactions;
		readChars += episode.readChars;
		searches += episode.searches;
		wikiReads += episode.wikiReads;
		wikiWrites += episode.wikiWrites;
		for (const bucket of Object.keys(byBucket) as Bucket[]) byBucket[bucket] += episode.byBucket[bucket];
		for (const file of episode.readFiles) readFiles.add(file);
		for (const [model, count] of Object.entries(episode.models)) models.set(model, (models.get(model) ?? 0) + count);
		// Consultation means the agent *read* the wiki. Maintenance-only episodes (filing a capture,
		// working the review queue) are work the wiki caused, not evidence that it answered anything.
		if (episode.wikiReads > 0) consulted += 1;
		if (episode.wikiReads > 0) {
			readingWiki += 1;
			if (episode.retrieval.retrievedPages.length > 0) withRetrieval += 1;
		}
		declared += episode.retrieval.declaredCount;
		rediscovered += episode.retrieval.rediscoveredCount;
	}

	const limited = options.episodeLimit && options.episodeLimit > 0
		? [...episodes].sort((a, b) => b.usage.cost - a.usage.cost).slice(0, options.episodeLimit).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))
		: episodes;

	const analysis: ProjectAnalysis = {
		projectDir,
		generatedAt: new Date().toISOString(),
		sessions,
		episodes: limited,
		totals: {
			episodes: episodes.length,
			requests,
			usage,
			byBucket,
			compactions,
			consultedEpisodes: consulted,
			consultationRate: episodes.length === 0 ? null : consulted / episodes.length,
			readFiles: readFiles.size,
			readChars,
			searches,
			wikiReads,
			wikiWrites,
			rediscovery: {
				declared,
				rediscovered,
				rate: declared === 0 ? null : rediscovered / declared,
				pagesWithLinks: pageFiles.size,
			},
			models: [...models.entries()].map(([model, count]) => ({ model, requests: count })).sort((a, b) => b.requests - a.requests),
			retrievalAttribution: { episodesReadingWiki: readingWiki, episodesWithRetrieval: withRetrieval },
		},
		windows: {},
		notes,
	};
	if (layout) analysis.wiki = { root: layout.root, stateDir: layout.stateDir, pagesWithLinks: pageFiles.size, retrievalEvents: events.length };
	const first = episodes[0]?.startedAt;
	const last = episodes[episodes.length - 1]?.endedAt ?? episodes[episodes.length - 1]?.startedAt;
	if (first) analysis.windows.from = first;
	if (last) analysis.windows.to = last;
	if (limited.length !== episodes.length) notes.push(`episode list limited to the ${limited.length} most expensive of ${episodes.length}; totals cover every episode`);
	return analysis;
}

function addUsage(target: EpisodeUsage, delta: EpisodeUsage): void {
	target.input += delta.input;
	target.output += delta.output;
	target.cacheRead += delta.cacheRead;
	target.cacheWrite += delta.cacheWrite;
	target.reasoning += delta.reasoning;
	target.totalTokens += delta.totalTokens;
	target.cost += delta.cost;
}

/** The last timestamp anywhere in a session's entries, used to bound an unsettled episode. */
function lastTimestamp(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const timestamp = entries[index]?.timestamp;
		if (typeof timestamp === "string") return timestamp;
	}
	return undefined;
}
