/**
 * Automatic wiki retrieval on prompt.
 *
 * On `before_agent_start`, search the session wiki for knowledge relevant to the prompt, have Jev
 * judge the candidates, and — only when the evidence is sufficient — return a brief that pi injects
 * alongside the user prompt, before the first provider request.
 *
 * Three rules, from `docs/plans/AUTO-RETRIEVAL.md`:
 *   - **Session wiki only.** Other registered wikis and the global vault stay a deliberate, manual
 *     `wiki_ask`; auto-injection never reaches across projects.
 *   - **Fail closed.** No sufficiency verdict, a low verdict, or a timeout means no injection. This
 *     is deliberately stricter than `wiki_ask`, which degrades to unranked keyword results.
 *   - **The metric is `op: "auto"`, never `op: "ask"`.** Auto-retrieval is not a consultation, and
 *     counting it as one would repeat the maintenance/consultation defect.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "./config.ts";
import type { JevClient } from "./jev.ts";
import type { WikiLayout } from "./wiki/layout.ts";
import { createSearchEngine, tokenize, VectorSearchEngine, type SearchResult } from "./wiki/search.ts";
import { modelsDir, resolvePreset } from "./vector/embed.ts";
import { judgeRetrieval, RELEVANCE_MIDPOINT } from "./vector/judgments.ts";
import { providerFor, vectorEnabled, vectorSearch } from "./vector/query.ts";
import { vectorDbFor } from "./vector/db.ts";
import { registerWiki, vectorDataDir } from "./vector/registry.ts";

/** Prompts this short, or starting like this, carry no topic of their own. */
const CONTINUATION = /^(yes|yeah|yep|ok|okay|sure|continue|go on|go ahead|do it|proceed|next|and then|please do)\b/i;

/** A fenced block at least this long is pasted material, not the request. */
const PASTE_CHARS = 1000;

function stripLongPaste(text: string): string {
	const fence = text.match(/```[\s\S]*?```/);
	if (!fence || fence[0].length < PASTE_CHARS || fence.index === undefined) return text;
	const before = text.slice(0, fence.index).trim();
	const firstContentLine = fence[0].split(/\r?\n/)[1]?.trim() ?? "";
	return [before, firstContentLine].filter(Boolean).join("\n");
}

/**
 * Build the search query for a prompt. Deterministic only: a continuation is answered from the
 * previous user turn, a long paste is dropped, and the result is capped. When this produces a weak
 * query the gate blocks the injection — a bad query costs latency, not context.
 */
export function buildAutoQuery(prompt: string, previousUser?: string, maxChars = 1200): string {
	const trimmed = prompt.trim();
	if (!trimmed) return "";
	const continuation = tokenize(trimmed).length < 4 || CONTINUATION.test(trimmed);
	const base = stripLongPaste(continuation && previousUser?.trim() ? previousUser.trim() : trimmed);
	if (base.length <= maxChars) return base;
	// Keep both ends: long prompts put the instruction first, but often restate it last.
	const head = Math.floor(maxChars * 0.67);
	const tail = maxChars - head - 3;
	return `${base.slice(0, head)} … ${base.slice(-tail)}`.trim();
}

/** The most recent user-authored prompt in a session branch. Injected messages are `custom`, not `user`. */
export function lastUserPrompt(entries: unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const text = Array.isArray(content)
			? content
					.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
					.join("\n")
			: typeof content === "string"
				? content
				: "";
		if (text.trim()) return text.trim();
	}
	return undefined;
}

export interface AutoRetrieveOptions {
	loaded: LoadedConfig;
	layout: WikiLayout;
	client: JevClient;
	prompt: string;
	previousUser?: string;
	signal?: AbortSignal;
}

export interface AutoRetrieveResult {
	query: string;
	/** Present only when the gate passed; the caller injects it verbatim. */
	brief?: string;
	pages: string[];
	detail: Record<string, unknown>;
}

/**
 * Retrieve, judge, and — if the evidence holds up — render the brief.
 *
 * The gate is `search.jev.sufficiency`'s threshold. The `rerank`/`sufficiency` toggles that govern
 * `wiki_ask` are ignored on purpose: an ungated auto-injection is not a configuration option.
 */
export async function retrieveForPrompt(options: AutoRetrieveOptions): Promise<AutoRetrieveResult> {
	const { loaded, layout, client } = options;
	const settings = loaded.config.hooks.autoRetrieve;
	const query = buildAutoQuery(options.prompt, options.previousUser);
	if (!query) return { query: "", pages: [], detail: { outcome: "skipped" } };

	const { registration } = await registerWiki(loaded.agentDir, layout.root);
	const useVector = vectorEnabled(loaded.config);
	let vectorHits = 0;
	let vector: VectorSearchEngine | undefined;
	if (useVector) {
		vector = new VectorSearchEngine(async (text, limit) => {
			const hits = await vectorSearch(loaded.agentDir, loaded.config, text, { limit, wikis: [registration.name] });
			vectorHits = hits.length;
			return hits;
		});
	}
	// `globalLayout` is deliberately undefined: the session wiki only.
	const engine = createSearchEngine(loaded.config, layout, undefined, vector, { wiki: registration.name });
	const results = await engine.search({ query, limit: settings.limit });
	// Honest provenance: the engine object says what was constructed, not what contributed. A run with
	// no vector hits is lexical-only whether the index was cold, broken, or disabled.
	const counts = { lexical: results.length, vector: vectorHits, lexicalOnly: vectorHits === 0 };
	if (results.length === 0) return { query, pages: [], detail: { outcome: "empty", ...counts } };

	const judgment = await judgeRetrieval({
		client,
		query,
		results,
		maxCandidates: loaded.config.search.jev.maxCandidates,
		minSufficiency: loaded.config.search.jev.minSufficiency,
		...(options.signal ? { signal: options.signal } : {}),
	});
	const minSufficiency = loaded.config.search.jev.minSufficiency;
	if (judgment.sufficiency === undefined || judgment.sufficiency < minSufficiency) {
		return {
			query,
			pages: [],
			detail: { outcome: "below_gate", sufficiency: judgment.sufficiency ?? null, ...counts },
		};
	}

	// Jev's relevance order, minus the candidates it judged unhelpful. The midpoint is the model's
	// own decision boundary, so it is not a threshold this code invented.
	const relevanceOf = new Map(judgment.candidateScores.map((score) => [`${score.path}\u0000${score.anchor ?? ""}`, score.relevance]));
	const hits = judgment.results
		.map((result) => ({ result, relevance: relevanceOf.get(`${result.path}\u0000${result.anchor ?? ""}`) ?? RELEVANCE_MIDPOINT }))
		.filter((hit) => hit.relevance >= RELEVANCE_MIDPOINT);
	if (hits.length === 0) {
		return { query, pages: [], detail: { outcome: "no_relevant_candidates", sufficiency: judgment.sufficiency, ...counts } };
	}
	const best = dedupeByPage(hits);

	const brief = renderBrief(best, {
		wiki: registration.name,
		sufficiency: judgment.sufficiency,
		lexicalOnly: counts.lexicalOnly,
		maxChars: settings.maxTokens * 4,
	});
	return {
		query,
		brief,
		pages: best.map((hit) => (hit.result.wiki ? `${hit.result.wiki}/${hit.result.path}` : hit.result.path)),
		detail: {
			outcome: "injected",
			sufficiency: judgment.sufficiency,
			topRelevance: best[0]?.relevance ?? null,
			hits: best.length,
			briefChars: brief.length,
			...counts,
		},
	};
}

/**
 * Keep the best-ranked hit per page. The brief is a pointer to a page, and the index returns one
 * chunk per claim and per section, so without this the same page can fill the whole budget.
 * Order is preserved, so the first (most relevant) chunk wins.
 */
export function dedupeByPage<T extends { result: SearchResult }>(hits: T[]): T[] {
	const seen = new Set<string>();
	return hits.filter((hit) => {
		const key = `${hit.result.wiki ?? ""}\u0000${hit.result.path}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Load the embedding model before the first prompt needs it.
 *
 * Guarded twice so this can never download a model: the package promises that *queries* never do,
 * and warming at session start must not break that. Every other failure is silent — a cold first
 * prompt falls back to the lexical half, exactly as it does today.
 */
export async function warmEmbeddingProvider(loaded: LoadedConfig, wikiDir: string): Promise<void> {
	if (loaded.config.hooks.autoRetrieve.mode === "off" || !vectorEnabled(loaded.config)) return;
	if (!existsSync(wikiDir)) return;
	const preset = resolvePreset(loaded.config.search.vector.model);
	if (!existsSync(join(modelsDir(loaded.agentDir), preset.repo))) return;
	try {
		const counts = await vectorDbFor(vectorDataDir(loaded.agentDir)).counts();
		if (!counts.some((entry) => entry.model === loaded.config.search.vector.model && entry.chunks > 0)) return;
		await providerFor(loaded.agentDir, loaded.config);
	} catch {
		/* warming is best-effort */
	}
}

/** One line per hit: path, claim status, trimmed excerpt. Stops at the character budget. */
export function renderBrief(
	hits: Array<{ result: SearchResult; relevance: number }>,
	options: { wiki: string; sufficiency: number; lexicalOnly: boolean; maxChars: number },
): string {
	const lines: string[] = [];
	let used = 0;
	for (const { result } of hits) {
		const excerpt = result.excerpt.replace(/\s+/g, " ").trim().slice(0, 400);
		const anchor = result.anchor ? `#${result.anchor}` : "";
		const status = result.status ? ` (${result.status})` : "";
		const line = `- ${result.path}${anchor}${status} — ${excerpt}`;
		if (lines.length > 0 && used + line.length > options.maxChars) break;
		lines.push(line);
		used += line.length + 1;
	}
	const degraded = options.lexicalOnly ? ["", "Note: these are keyword matches only — the semantic index contributed nothing."] : [];
	return [
		`<auto-retrieval wiki="${options.wiki}" sufficiency="${options.sufficiency.toFixed(2)}" engine="${options.lexicalOnly ? "lexical-only" : "bm25+vector"}">`,
		"Automatic search of the project wiki for this prompt. It may be incomplete — read the pages before relying on them, and use wiki_ask for anything it does not cover.",
		...degraded,
		"",
		...lines,
		"</auto-retrieval>",
	].join("\n");
}
