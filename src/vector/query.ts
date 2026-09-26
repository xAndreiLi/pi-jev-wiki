/**
 * Query path: embed the query with the configured preset and run a cosine KNN
 * across registered wikis, mapping hits to search results with [wiki] provenance.
 */
import type { ResolvedConfig } from "../config.ts";
import type { SearchResult } from "../wiki/search.ts";
import { vectorDbFor } from "./db.ts";
import { createLocalProvider, modelsDir, resolvePreset, type EmbeddingProvider } from "./embed.ts";
import { vectorDataDir } from "./registry.ts";

const providers = new Map<string, Promise<EmbeddingProvider>>();

export function vectorEnabled(config: ResolvedConfig): boolean {
	return config.search.vector.enabled;
}

export function providerFor(agentDir: string, config: ResolvedConfig): Promise<EmbeddingProvider> {
	const preset = resolvePreset(config.search.vector.model);
	const dimensions = config.search.vector.dimensions ?? preset.dimensions;
	const dtype = config.search.vector.dtype ?? preset.dtype;
	const key = `${agentDir}|${preset.id}|${dtype}|${dimensions}`;
	let provider = providers.get(key);
	if (!provider) {
		provider = createLocalProvider({ preset, dimensions, dtype, cacheDir: modelsDir(agentDir) });
		providers.set(key, provider);
	}
	return provider;
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
	const provider = await providerFor(agentDir, config);
	const [embedding] = await provider.embed([{ text: query }], "query");
	const db = vectorDbFor(vectorDataDir(agentDir));
	await db.init();
	const hits = await db.knn(embedding, {
		model: config.search.vector.model,
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
		anchor: hit.claimId ?? hit.key,
		kind: hit.kind,
		...(hit.status ? { status: hit.status } : {}),
	}));
}
