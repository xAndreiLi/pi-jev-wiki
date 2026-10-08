/**
 * Query path: embed the query with the configured preset and run a cosine KNN
 * across registered wikis, mapping hits to search results with [wiki] provenance.
 */
import type { ResolvedConfig } from "../config.ts";
import type { SearchResult } from "../wiki/search.ts";
import { vectorDbFor } from "./db.ts";
import { fingerprintFor, type EmbeddingProvider } from "./embed.ts";
import { DEFAULT_IDLE_EXIT_MS, sharedEmbedderFor, type EmbedderOptions } from "./embedder/client.ts";
import { vectorDataDir } from "./registry.ts";

export function vectorEnabled(config: ResolvedConfig): boolean {
	return config.search.vector.enabled;
}

/** The single mapping from config to embedder identity — every caller shares it, so none can drift. */
export function embedderOptionsFor(agentDir: string, config: ResolvedConfig): EmbedderOptions {
	return {
		agentDir,
		model: config.search.vector.model,
		dtype: config.search.vector.dtype ?? null,
		dimensions: config.search.vector.dimensions ?? null,
		idleExitMs: config.search.vector.embedder?.idleExitMs ?? DEFAULT_IDLE_EXIT_MS,
		...(config.search.vector.embedder?.logMaxBytes !== undefined ? { logMaxBytes: config.search.vector.embedder.logMaxBytes } : {}),
	};
}

/**
 * The embedder, which now lives in a shared process. Sessions never load the model themselves and
 * there is deliberately no inline mode: a second embedder is exactly what parity cannot survive.
 */
export function providerFor(agentDir: string, config: ResolvedConfig): Promise<EmbeddingProvider> {
	return Promise.resolve(sharedEmbedderFor(embedderOptionsFor(agentDir, config)));
}

export interface VectorQueryOptions {
	limit: number;
	wikis?: string[];
	kinds?: string[];
}

export async function vectorSearch(
	agentDir: string,
	config: ResolvedConfig,
	query: string,
	options: VectorQueryOptions,
): Promise<SearchResult[]> {
	const db = vectorDbFor(vectorDataDir(agentDir));
	await db.init();
	// Queries never download a model: a cold or mismatched index degrades to keyword search.
	const model = config.search.vector.model;
	// Identity is decided by config alone, so a cold index can be recognised without loading anything.
	const fingerprint = fingerprintFor(model, {
		dtype: config.search.vector.dtype ?? null,
		dimensions: config.search.vector.dimensions ?? null,
	});
	const counts = await db.counts();
	const warm = counts.some(
		(entry) =>
			entry.fingerprint === fingerprint &&
			entry.chunks > 0 &&
			(!options.wikis || options.wikis.length === 0 || options.wikis.includes(entry.wiki)),
	);
	if (!warm) return [];
	const provider = await providerFor(agentDir, config);
	// Refuse to compare vectors from two identities, whatever the source of the provider is.
	if (provider.fingerprint !== fingerprint) return [];
	const [embedding] = await provider.embed([{ text: query }], "query");
	const hits = await db.knn(embedding, {
		fingerprint,
		dim: provider.dimensions,
		limit: options.limit,
		...(options.wikis && options.wikis.length > 0 ? { wikis: options.wikis } : {}),
		...(options.kinds && options.kinds.length > 0 ? { kinds: options.kinds } : {}),
	});
	return hits.map((hit) => ({
		path: hit.path,
		title: hit.title,
		score: hit.score,
		excerpt: hit.text.length > 600 ? `${hit.text.slice(0, 600)}…` : hit.text,
		wiki: hit.wiki,
		anchor: hit.claimId ?? (hit.kind === "page-section" ? hit.key.replace(/^section:/, "") : hit.key),
		kind: hit.kind,
		...(hit.status ? { status: hit.status } : {}),
	}));
}
