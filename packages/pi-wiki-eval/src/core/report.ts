/**
 * Markdown rendering. The report is the product: it has to be readable by a human who wants to
 * know where the context went, and honest about what the numbers cannot say.
 */
import type { AnalyzedEpisode, ProjectAnalysis } from "./analyze.js";
import type { Bucket } from "./classify.js";

export interface ReportOptions {
	/** Include prompt text and wiki query text. Off by default — a report may be shared. */
	includeQueries?: boolean;
	/** How many episodes to tabulate. */
	maxEpisodes?: number;
}

const BUCKETS: Bucket[] = ["explore", "wiki", "act", "verify", "other"];

function int(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

function usd(value: number): string {
	if (value === 0) return "$0";
	if (value < 0.01) return `$${value.toFixed(5)}`;
	return `$${value.toFixed(2)}`;
}

function pct(value: number | null): string {
	return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function chars(value: number): string {
	if (value < 1000) return `${int(value)} chars`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k chars`;
	return `${(value / 1_000_000).toFixed(2)}M chars`;
}

/** Rough context equivalent of a character count, for intuition only. */
function approxTokens(chars_: number): string {
	return `~${int(chars_ / 4)} tokens`;
}

function shortTime(iso?: string): string {
	if (!iso) return "—";
	return iso.replace("T", " ").slice(0, 16);
}

function duration(ms?: number): string {
	if (ms === undefined) return "—";
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

function episodeRow(episode: AnalyzedEpisode): string {
	const cells = [
		episode.label,
		shortTime(episode.startedAt),
		duration(episode.durationMs),
		String(episode.requests),
		usd(episode.usage.cost),
		int(episode.usage.totalTokens),
		String(episode.byBucket.explore),
		String(episode.byBucket.wiki),
		String(episode.byBucket.act),
		String(episode.byBucket.verify),
		String(episode.readFiles.length),
		chars(episode.readChars),
		episode.endReason,
	];
	return `| ${cells.join(" | ")} |`;
}

export interface ProjectSummary {
	projectDir: string;
	name: string;
	sessions: number;
	episodes: number;
	cost: number;
	/** Median billed cost per episode — the number a paired experiment has to beat. */
	medianCost: number | null;
	tokens: number;
	hasWiki: boolean;
	exploreShare: number | null;
	wikiShare: number | null;
	consultationRate: number | null;
	rediscoveryRate: number | null;
	readFiles: number;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** One row per project, for comparing several projects side by side. */
export function summarize(analysis: ProjectAnalysis): ProjectSummary {
	const calls = BUCKETS.reduce((sum, bucket) => sum + analysis.totals.byBucket[bucket], 0);
	const costs = analysis.episodes.map((episode) => episode.usage.cost);
	return {
		projectDir: analysis.projectDir,
		name: analysis.projectDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? analysis.projectDir,
		sessions: analysis.sessions.length,
		episodes: analysis.totals.episodes,
		cost: analysis.totals.usage.cost,
		medianCost: median(costs),
		tokens: analysis.totals.usage.totalTokens,
		hasWiki: analysis.wiki !== undefined,
		exploreShare: calls === 0 ? null : analysis.totals.byBucket.explore / calls,
		wikiShare: calls === 0 ? null : analysis.totals.byBucket.wiki / calls,
		consultationRate: analysis.totals.consultationRate,
		rediscoveryRate: analysis.totals.rediscovery.rate,
		readFiles: analysis.totals.readFiles,
	};
}

/** Compact comparison table across projects. */
export function renderSummaryTable(rows: ProjectSummary[]): string {
	const lines: string[] = [];
	lines.push("| Project | Sessions | Episodes | Cost | Median $/ep | Explore | Wiki | Consult | Rediscovery | Files |");
	lines.push("|---|---|---|---|---|---|---|---|---|---|");
	for (const row of rows) {
		lines.push(
			`| ${row.name} | ${int(row.sessions)} | ${int(row.episodes)} | ${usd(row.cost)} | ${row.medianCost === null ? "—" : usd(row.medianCost)} | ${pct(row.exploreShare)} | ${row.hasWiki ? pct(row.wikiShare) : "—"} | ${row.hasWiki ? pct(row.consultationRate) : "—"} | ${row.hasWiki ? pct(row.rediscoveryRate) : "—"} | ${int(row.readFiles)} |`,
		);
	}
	return lines.join("\n");
}

export function renderReport(analysis: ProjectAnalysis, options: ReportOptions = {}): string {
	const { totals } = analysis;
	const lines: string[] = [];
	const maxEpisodes = options.maxEpisodes ?? 20;

	lines.push("# Context and wiki usage — " + analysis.projectDir);
	lines.push("");
	lines.push(`Generated ${shortTime(analysis.generatedAt)} · window ${shortTime(analysis.windows.from)} → ${shortTime(analysis.windows.to)} · ${analysis.sessions.length} session file(s), ${int(totals.episodes)} episode(s)`);
	if (totals.models.length > 0) {
		lines.push(`Models: ${totals.models.map((entry) => `${entry.model} (${entry.requests})`).join(", ")}`);
	}
	if (analysis.wiki) {
		lines.push(`Wiki: ${analysis.wiki.root} · ${analysis.wiki.pagesWithLinks} page(s) with \`files:\` links · ${int(analysis.wiki.retrievalEvents)} recorded retrieval(s)`);
	} else {
		lines.push("Wiki: none found for this project (wiki metrics are zero by design — this is what a control run looks like)");
	}
	lines.push("");

	lines.push("## Context accounting");
	lines.push("");
	lines.push("| Measure | Value |");
	lines.push("|---|---|");
	lines.push(`| Billed cost | ${usd(totals.usage.cost)} |`);
	lines.push(`| Total tokens | ${int(totals.usage.totalTokens)} |`);
	lines.push(`| Uncached input | ${int(totals.usage.input)} |`);
	lines.push(`| Output | ${int(totals.usage.output)} |`);
	lines.push(`| Cache read | ${int(totals.usage.cacheRead)} |`);
	lines.push(`| Cache write | ${int(totals.usage.cacheWrite)} |`);
	lines.push(`| Provider requests | ${int(totals.requests)} |`);
	lines.push(`| Compactions | ${int(totals.compactions)} |`);
	lines.push("");
	if (totals.usage.totalTokens > 0) {
		const cached = totals.usage.cacheRead / totals.usage.totalTokens;
		lines.push(`Cache reads are ${pct(cached)} of all tokens. Because cached tokens are far cheaper than fresh ones,`);
		lines.push("cost per episode is the honest headline; raw token counts overstate what a large context costs.");
		lines.push("");
	}

	lines.push("## Where the calls went");
	lines.push("");
	lines.push("| Bucket | Calls | Share |");
	lines.push("|---|---|---|");
	const calls = BUCKETS.reduce((sum, bucket) => sum + totals.byBucket[bucket], 0);
	for (const bucket of BUCKETS) {
		const value = totals.byBucket[bucket];
		lines.push(`| ${bucket} | ${int(value)} | ${pct(calls === 0 ? null : value / calls)} |`);
	}
	lines.push("");
	lines.push(`Discovery: ${int(totals.readFiles)} distinct file(s) read, ${chars(totals.readChars)} of file content entering context (${approxTokens(totals.readChars)}), ${int(totals.searches)} search call(s).`);
	lines.push("");
	lines.push(`Wiki calls split: ${int(totals.wikiReads)} reading the wiki, ${int(totals.wikiWrites)} maintaining it (filing, review, sync).`);
	lines.push("Maintenance is a real cost of the wiki and is not evidence that it answered anything.");
	lines.push("");

	lines.push("## Wiki");
	lines.push("");
	lines.push("| Measure | Value |");
	lines.push("|---|---|");
	lines.push(`| Episodes reading the wiki | ${int(totals.consultedEpisodes)} of ${int(totals.episodes)} (${pct(totals.consultationRate)}) |`);
	const attribution = totals.retrievalAttribution;
	lines.push(`| ↳ with a recorded retrieval event | ${int(attribution.episodesWithRetrieval)} of ${int(attribution.episodesReadingWiki)} |`);
	lines.push(`| Files declared by retrieved pages | ${int(totals.rediscovery.declared)} |`);
	lines.push(`| Of those, read by the agent anyway | ${int(totals.rediscovery.rediscovered)} |`);
	lines.push(`| Rediscovery rate | ${pct(totals.rediscovery.rate)} |`);
	lines.push("");
	const unattributed = totals.retrievalAttribution.episodesReadingWiki - totals.retrievalAttribution.episodesWithRetrieval;
	if (unattributed > 0) {
		lines.push(`${int(unattributed)} episode(s) read the wiki but have no retrieval event recorded against them, so their retrieval is`);
		lines.push("unknown rather than empty — usually a session that predates the wiki's own state file, or a `wiki_ask` that failed.");
		lines.push("");
	}
	if (totals.usage.cost === 0 && totals.usage.totalTokens > 0) {
		lines.push("The provider reported no cost for these sessions, so every cost figure here is zero. Token counts are unaffected.");
		lines.push("");
	}
	const joined = analysis.episodes.filter((episode) => episode.retrieval.declaredCount > 0);
	if (joined.length > 0) {
		lines.push("Per episode, for the pages that declared `files:` links:");
		lines.push("");
		lines.push("| Episode | Retrieved pages | Declared files | Read anyway |");
		lines.push("|---|---|---|---|");
		for (const episode of joined) {
			lines.push(`| ${episode.label} | ${int(episode.retrieval.retrievedPages.length)} | ${int(episode.retrieval.declaredCount)} | ${int(episode.retrieval.rediscoveredCount)} |`);
		}
		lines.push("");
	}
	lines.push("A low rediscovery rate means the wiki answered the question well enough that the agent did not have to read the");
	lines.push("code it describes. A high rate means the page was visited on the way to the answer rather than instead of it —");
	lines.push("either retrieval is missing the right page, or the page does not say enough once found.");
	lines.push("");
	lines.push("Read this metric with care: the denominator is every file declared by every retrieved page, including files the");
	lines.push("task never needed. A low rate therefore also follows from retrieving broad pages for a narrow task. Treat it as a");
	lines.push("signal to investigate an episode, not as a score — and prefer episodes where the agent edited code, since there its");
	lines.push("denominator is anchored to work that actually happened.");
	lines.push("");

	lines.push(`## Episodes (${Math.min(maxEpisodes, analysis.episodes.length)} of ${analysis.episodes.length}${analysis.episodes.length > maxEpisodes ? ", most expensive" : ""})`);
	lines.push("");
	lines.push("| # | Started | Duration | Reqs | Cost | Tokens | Explore | Wiki | Act | Verify | Files | Content read | End |");
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
	const ranked = [...analysis.episodes].sort((a, b) => b.usage.cost - a.usage.cost).slice(0, maxEpisodes).sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
	for (const episode of ranked) lines.push(episodeRow(episode));
	lines.push("");
	if (options.includeQueries) {
		lines.push("### Prompts");
		lines.push("");
		for (const episode of ranked) {
			if (!episode.userText) continue;
			lines.push(`- **${episode.label}** (${shortTime(episode.startedAt)}, ${usd(episode.usage.cost)}): ${episode.userText.replace(/\s+/g, " ")}`);
		}
		lines.push("");
	}

	lines.push("## How to read this");
	lines.push("");
	lines.push("- **Episodes, not sessions.** An episode runs from one prompt to the agent settling. A second prompt mid-turn closes the previous one as `steered`.");
	lines.push("- **Cost comes from the provider.** Every number is summed from the usage pi recorded on each assistant message, so the system prompt, history, tool results, and compaction are all included.");
	lines.push("- **Nested calls count.** Tool calls made inside a codemode script are recorded by pi with their real names and are classified as those tools, not as one `codemode` call.");
	lines.push("- **Rediscovery rate is a population statistic, not a verdict.** It cannot know *why* a file was read; an agent may open a file for reasons unrelated to the page it just retrieved.");
	lines.push("- **A wiki miss costs more than a hit saves.** Consultation is not automatically good: a page that does not answer the question still spends a call and context.");
	lines.push("- **This measures one project.** It says nothing about whether the wiki helps in general, and nothing at all about the agent's answer quality — pair it with an outcome measure (tests, rework, review) before drawing conclusions.");
	lines.push("");

	if (analysis.notes.length > 0) {
		lines.push("## Notes");
		lines.push("");
		for (const note of analysis.notes) lines.push(`- ${note}`);
		lines.push("");
	}
	const branchNotes = analysis.sessions.filter((session) => session.branchNote);
	if (branchNotes.length > 0) {
		lines.push("## Session parsing");
		lines.push("");
		for (const session of branchNotes) lines.push(`- ${session.path}: ${session.branchNote}`);
		lines.push("");
	}
	const warnings = analysis.sessions.filter((session) => session.warnings.length > 0);
	if (warnings.length > 0) {
		lines.push("## Parse warnings");
		lines.push("");
		for (const session of warnings) lines.push(`- ${session.path}: ${session.warnings.slice(0, 3).join("; ")}${session.warnings.length > 3 ? ` (+${session.warnings.length - 3} more)` : ""}`);
		lines.push("");
	}
	return lines.join("\n");
}
