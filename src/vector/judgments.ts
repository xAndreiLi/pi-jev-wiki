/**
 * Jev retrieval judgments: a batched relevance score per candidate (rerank) and
 * an evidence-sufficiency verdict. Jev returns calibrated probabilities, never
 * prose; code owns thresholds, ordering, and fallbacks.
 */
import { isNoul, noul, type JevClient, type JevQuestion } from "../jev.ts";
import type { SearchResult } from "../wiki/search.ts";

export interface RetrievalJudgmentOptions {
	client: JevClient;
	query: string;
	results: SearchResult[];
	maxCandidates?: number;
	minSufficiency?: number;
	signal?: AbortSignal;
}

export interface RetrievalJudgment {
	results: SearchResult[];
	sufficiency?: number;
	notes: string[];
	candidateScores: Array<{ path: string; anchor?: string; relevance: number }>;
	usage: { input_tokens: number; output_tokens: number };
}

const NEUTRAL_RELEVANCE = 0.5;

export async function judgeRetrieval(options: RetrievalJudgmentOptions): Promise<RetrievalJudgment> {
	const { client, query } = options;
	const candidates = options.results.slice(0, Math.max(1, Math.min(options.maxCandidates ?? 8, options.results.length)));
	const questions: Record<string, JevQuestion> = {
		sufficient: noul("Taken together, the candidate excerpts contain enough information to answer the query.", {
			true: "The excerpts answer the query",
			false: "The excerpts do not answer the query",
		}),
	};
	candidates.forEach((_, index) => {
		questions[`c${index + 1}`] = noul("This candidate excerpt directly helps answer the query.", {
			true: "Relevant to answering the query",
			false: "Not relevant to answering the query",
		});
	});
	const response = await client.systemOne(
		{
			query,
			candidates: candidates.map((result, index) => ({
				id: `c${index + 1}`,
				wiki: result.wiki ?? null,
				path: result.path,
				kind: result.kind ?? null,
				title: result.title,
				excerpt: result.excerpt.slice(0, 700),
			})),
		},
		questions,
		{ signal: options.signal },
	);

	const relevance = candidates.map((_, index) => {
		const answer = response.answers[`c${index + 1}`];
		return isNoul(answer) ? answer.noul : NEUTRAL_RELEVANCE;
	});
	const sufficiencyAnswer = response.answers.sufficient;
	const sufficiency = isNoul(sufficiencyAnswer) ? sufficiencyAnswer.noul : undefined;

	// Stable rerank: judged relevance first, RRF score as the tiebreaker. Candidates
	// outside the judged window keep a neutral score and their relative order.
	const ranked = options.results.map((result, index) => ({ result, index }));
	ranked.sort((a, b) => {
		const relevanceA = a.index < relevance.length ? relevance[a.index] : NEUTRAL_RELEVANCE;
		const relevanceB = b.index < relevance.length ? relevance[b.index] : NEUTRAL_RELEVANCE;
		if (relevanceB !== relevanceA) return relevanceB - relevanceA;
		return b.result.score - a.result.score;
	});

	const notes: string[] = [];
	if (sufficiency !== undefined && options.minSufficiency !== undefined && sufficiency < options.minSufficiency) {
		notes.push(`Evidence may be insufficient (${sufficiency.toFixed(2)}): the wiki may not cover this yet.`);
	}
	return {
		results: ranked.map((entry) => entry.result),
		...(sufficiency !== undefined ? { sufficiency } : {}),
		notes,
		candidateScores: candidates.map((result, index) => ({
			path: result.path,
			...(result.anchor ? { anchor: result.anchor } : {}),
			relevance: relevance[index],
		})),
		usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
	};
}
