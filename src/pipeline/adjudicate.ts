/**
 * Jev adjudication: groundedness, derivability, durability, placement, value.
 *
 * Placement uses a sharded tournament so the wiki can grow past Jev's 255-option
 * choice ceiling: candidates are sharded, each shard nominates a winner (with an
 * `any_fit` gate and an `add_new_page` option), and winners meet in a final call.
 * Probabilities are never compared across shards — only inside a single call.
 */
import {
	choice,
	isChoice,
	isNoul,
	isScore,
	mapLimit,
	noul,
	score,
	JevClient,
	type JevQuestion,
	type JevResponse,
} from "../jev.ts";
import type { ResolvedConfig } from "../config.ts";

export interface CandidatePage {
	path: string;
	title: string;
	type: string;
	summary: string;
	tags: string[];
}

export interface CandidateClaim {
	id?: string;
	text: string;
	page?: string;
	status?: string;
}

export interface ClaimInput {
	text: string;
	kind: string;
	quote?: string;
	files?: string[];
	evidenceText?: string;
}

export const ADD_NEW_PAGE = "add_new_page";
export const NONE_OF_THESE = "none_of_these";

export interface ClaimVerdicts {
	grounded: number;
	derivable: number;
	durable: number;
	sensitive: number;
	kind: string;
	kindConfidence: number;
	importance: number;
	importanceNorm: number;
	importanceConfidence: number;
	criticality: number;
	criticalityNorm: number;
	criticalityConfidence: number;
	alreadyKnown: number;
	trustTier?: string;
	trustConfidence?: number;
	relation?: string;
	relationConfidence?: number;
	relationAgainst?: string;
	pageType?: string;
	pageTypeConfidence?: number;
	topic?: string;
	topicConfidence?: number;
	target?: string;
	targetConfidence?: number;
	mergeInto?: string;
	anyFit?: number;
	topicIsNew?: boolean;
	newPage: boolean;
}

export interface AdjudicationResult {
	verdicts: ClaimVerdicts;
	requestCount: number;
	usage: { input_tokens: number; output_tokens: number };
	raw: Record<string, unknown>;
}

const QUESTION = {
	grounded: noul("The reference passage states or directly implies the claim."),
	derivable: noul("A developer could re-derive this claim from the repository code in under one minute.", {
		true: "It is an implementation detail visible by reading the code",
		false: "It needs synthesis, rationale, history, or cross-file knowledge",
	}),
	durable: noul("This claim will still be true and useful in a month.", {
		true: "Durable knowledge about the system",
		false: "Temporary task state or session-specific detail",
	}),
	sensitive: noul("This claim contains credentials, personal data, or other secrets that must not be stored."),
	kind: choice("What kind of knowledge is this claim?", {
		architecture: "Structure, ownership, boundaries, or data flow",
		invariant: "A rule that must always hold",
		decision: "A choice made with rationale",
		gotcha: "A footgun or non-obvious failure mode",
		procedure: "How to perform a task",
		pattern: "A recurring approach",
		fact: "A plain fact about the project",
	}),
	importance: score("How durable and load-bearing is this knowledge?", ["ephemeral", "contextual", "durable", "canonical"]),
	criticality: score("How costly would acting on this claim incorrectly be?", ["low", "moderate", "high", "critical"]),
	verifiable: choice("What is the strongest basis for this claim?", {
		verified_in_repo: "Confirmed by code, tests, commits, or configuration in the repository",
		source_document: "Supported by a quoted passage from a source document",
		user_stated: "Stated by the user, but not independently verified",
		inference: "Inferred by the agent from partial evidence",
		speculation: "No clear evidence either way",
	}),
} satisfies Record<string, JevQuestion>;

function noulValue(response: JevResponse, key: string, fallback = 0): number {
	const answer = response.answers[key];
	return isNoul(answer) ? answer.noul : fallback;
}

function choiceValue(response: JevResponse, key: string): { value: string; confidence: number } | undefined {
	const answer = response.answers[key];
	if (!isChoice(answer)) return undefined;
	return { value: answer.choice, confidence: answer.confidence };
}

function scoreValue(response: JevResponse, key: string): { value: number; norm: number; confidence: number } | undefined {
	const answer = response.answers[key];
	if (!isScore(answer)) return undefined;
	const levelCount = Object.keys(answer.legend ?? {}).length || 1;
	const norm = levelCount > 1 ? answer.score / (levelCount - 1) : 0;
	return { value: answer.score, norm, confidence: answer.confidence };
}

/**
 * Choose a target page. Single shard when candidates fit; otherwise a tournament.
 */
export async function chooseTarget(
	client: JevClient,
	claim: ClaimInput,
	candidates: CandidatePage[],
	config: ResolvedConfig,
	options?: { signal?: AbortSignal; evidenceText?: string },
): Promise<{ verdicts: Partial<ClaimVerdicts>; requests: number; usage: { input_tokens: number; output_tokens: number }; raw: Record<string, unknown> }> {
	const usage = { input_tokens: 0, output_tokens: 0 };
	const raw: Record<string, unknown> = {};
	const shards = config.routing.shardSize > 0 ? chunkBy(candidates, config.routing.shardSize) : [candidates];

	const optionsFor = (pages: CandidatePage[], includeNone: boolean): Record<string, string | null> => {
		const criteria: Record<string, string | null> = {};
		for (const page of pages) {
			criteria[page.path] = `${page.title} (${page.type})${page.summary ? ` — ${page.summary}` : ""}`;
		}
		criteria[ADD_NEW_PAGE] = "None of these pages fit; a new page should be created";
		if (includeNone) criteria[NONE_OF_THESE] = "No confident placement at all";
		return criteria;
	};

	const stateBase = {
		claim: { text: claim.text, kind: claim.kind, quote: claim.quote ?? null, files: claim.files ?? [] },
		evidence: claim.evidenceText ?? null,
	};

	const shardResults = await mapLimit(shards, 4, async (pages) => {
		if (pages.length === 0) return undefined;
		const response = await client.systemOne(
			{ ...stateBase, candidate_pages: pages.map((p) => ({ path: p.path, title: p.title, type: p.type, summary: p.summary })) },
			{
				best: choice("Which page should absorb this claim?", optionsFor(pages, false)),
				any_fit: noul("Does at least one of the candidate pages substantially fit this claim?"),
			},
			{ signal: options?.signal },
		);
		usage.input_tokens += response.usage.input_tokens;
		usage.output_tokens += response.usage.output_tokens;
		raw[`shard:${pages[0]?.path ?? "empty"}`] = response.answers;
		const best = choiceValue(response, "best");
		return { best: best?.value, confidence: best?.confidence ?? 0, anyFit: noulValue(response, "any_fit") };
	});

	const valid = shardResults.filter((result): result is NonNullable<typeof result> => Boolean(result));
	const winners = valid.filter((result) => result.best && result.best !== ADD_NEW_PAGE && result.anyFit >= config.routing.minFit);
	const maxAnyFit = valid.reduce((max, result) => Math.max(max, result.anyFit), 0);

	if (winners.length === 0) {
		return {
			verdicts: { newPage: true, anyFit: maxAnyFit, target: undefined },
			requests: valid.length,
			usage,
			raw,
		};
	}
	if (winners.length === 1) {
		const only = winners[0];
		const isNew = (only.confidence ?? 0) < config.routing.newPageConfidence && (only.anyFit ?? 0) < config.routing.minFit;
		return {
			verdicts: { target: isNew ? undefined : only.best, targetConfidence: only.confidence, anyFit: only.anyFit, newPage: isNew },
			requests: valid.length,
			usage,
			raw,
		};
	}

	const finalPages = winners
		.map((winner) => candidates.find((page) => page.path === winner.best))
		.filter((page): page is CandidatePage => Boolean(page));
	const finalResponse = await client.systemOne(
		{ ...stateBase, candidate_pages: finalPages.map((p) => ({ path: p.path, title: p.title, type: p.type, summary: p.summary })) },
		{
			final: choice("Which page should absorb this claim?", optionsFor(finalPages, true)),
			fit: noul("Does the selected page substantially fit this claim?"),
		},
		{ signal: options?.signal },
	);
	usage.input_tokens += finalResponse.usage.input_tokens;
	usage.output_tokens += finalResponse.usage.output_tokens;
	raw.final = finalResponse.answers;

	const finalChoice = choiceValue(finalResponse, "final");
	const fit = noulValue(finalResponse, "fit");
	const isNew = !finalChoice || finalChoice.value === ADD_NEW_PAGE || finalChoice.value === NONE_OF_THESE || fit < config.routing.minFit;
	return {
		verdicts: {
			target: isNew ? undefined : finalChoice?.value,
			targetConfidence: finalChoice?.confidence,
			anyFit: Math.max(fit, maxAnyFit),
			newPage: isNew,
		},
		requests: valid.length + 1,
		usage,
		raw,
	};
}

function chunkBy<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export interface AdjudicateOptions {
	candidatePages?: CandidatePage[];
	candidateClaims?: CandidateClaim[];
	topics?: string[];
	evidenceText?: string;
	signal?: AbortSignal;
	existingTopics?: string[];
}

export async function adjudicateClaim(
	client: JevClient,
	claim: ClaimInput,
	config: ResolvedConfig,
	options?: AdjudicateOptions,
): Promise<AdjudicationResult> {
	const candidateClaims = (options?.candidateClaims ?? []).slice(0, 12);
	const evidence = claim.evidenceText ?? options?.evidenceText ?? "";

	const state: Record<string, unknown> = {
		claim: { text: claim.text, kind: claim.kind, quote: claim.quote ?? null, files: claim.files ?? [] },
		reference_passage: evidence || null,
	};
	if (candidateClaims.length > 0) {
		state.existing_claims = candidateClaims.map((candidate) => ({
			id: candidate.id ?? candidate.text.slice(0, 40),
			text: candidate.text,
			page: candidate.page ?? null,
			status: candidate.status ?? null,
		}));
	}

	const questions: Record<string, JevQuestion> = {
		grounded: QUESTION.grounded,
		derivable: QUESTION.derivable,
		durable: QUESTION.durable,
		sensitive: QUESTION.sensitive,
		kind: QUESTION.kind,
		importance: QUESTION.importance,
		criticality: QUESTION.criticality,
		verifiable: QUESTION.verifiable,
	};
	if (candidateClaims.length > 0) {
		questions.already_known = noul("The existing claims already contain this knowledge.");
		questions.relation = choice("How does the new claim relate to the existing claims?", {
			consistent: "Agrees with them without adding anything new",
			extends: "Adds detail or a new facet on top of them",
			contradicts: "Conflicts with at least one of them",
			supersedes: "Replaces at least one of them with newer or better information",
			unrelated: "Not about the same thing",
		});
	}

	const topics = (options?.existingTopics ?? options?.topics ?? []).filter(Boolean);
	questions.page_type = choice("What type of page should hold this claim?", {
		"architecture/module": "Module responsibility, surface, or dependencies",
		"architecture/flow": "End-to-end data or control flow",
		"architecture/layer": "Dependency direction or boundaries",
		invariant: "A rule that must always hold",
		decision: "A decision with rationale",
		gotcha: "A footgun or failure mode",
		concept: "A concept or synthesis",
		source_summary: "A summary of a source document",
	});
	if (topics.length > 0) {
		questions.topic = choice(
			"Which existing topic directory should hold this claim?",
			Object.fromEntries([...topics.slice(0, 100).map((topic) => [topic, null]), ["new_topic", "None fit; create a new topic"]]),
		);
	}

	const response = await client.systemOne(state, questions, { signal: options?.signal });
	const kind = choiceValue(response, "kind");
	const importance = scoreValue(response, "importance");
	const criticality = scoreValue(response, "criticality");
	const relation = choiceValue(response, "relation");
	const topicChoice = choiceValue(response, "topic");

	const verdicts: ClaimVerdicts = {
		grounded: noulValue(response, "grounded"),
		derivable: noulValue(response, "derivable"),
		durable: noulValue(response, "durable"),
		sensitive: noulValue(response, "sensitive"),
		kind: kind?.value ?? claim.kind,
		kindConfidence: kind?.confidence ?? 0,
		importance: importance?.value ?? 0,
		importanceNorm: importance?.norm ?? 0,
		importanceConfidence: importance?.confidence ?? 0,
		criticality: criticality?.value ?? 0,
		criticalityNorm: criticality?.norm ?? 0,
		criticalityConfidence: criticality?.confidence ?? 0,
		alreadyKnown: noulValue(response, "already_known"),
		trustTier: choiceValue(response, "verifiable")?.value,
		trustConfidence: choiceValue(response, "verifiable")?.confidence,
		relation: relation?.value,
		relationConfidence: relation?.confidence,
		pageType: choiceValue(response, "page_type")?.value,
		pageTypeConfidence: choiceValue(response, "page_type")?.confidence,
		topic: topicChoice?.value === "new_topic" ? suggestTopic(kind?.value ?? claim.kind) : topicChoice?.value,
		topicConfidence: topicChoice?.confidence,
		topicIsNew: topicChoice?.value === "new_topic",
		newPage: true,
	};

	return {
		verdicts,
		requestCount: 1,
		usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
		raw: { adjudicate: response.answers },
	};
}

export type ClaimAction =
	| "file"
	| "file_user_stated"
	| "reinforce"
	| "review"
	| "reject_duplicate"
	| "reject_derivable"
	| "reject_sensitive"
	| "reject_unsupported";

export interface ClaimDecision {
	action: ClaimAction;
	score: number;
	reasons: string[];
}

export function decideClaim(verdicts: ClaimVerdicts, config: ResolvedConfig): ClaimDecision {
	const reasons: string[] = [];
	const { thresholds, weights } = config;

	if (verdicts.sensitive >= 0.9) {
		return { action: "reject_sensitive", score: 0, reasons: ["contains sensitive content"] };
	}
	if (verdicts.derivable >= thresholds.minDerivable) {
		const framingKinds = ["architecture", "invariant", "decision"];
		const framing =
			framingKinds.includes(verdicts.kind) &&
			verdicts.importanceNorm >= thresholds.framingImportance &&
			verdicts.grounded >= 0.5;
		if (framing) {
			return {
				action: "review",
				score: 0,
				reasons: [
					`derivable from code (${verdicts.derivable.toFixed(2)} ≥ ${thresholds.minDerivable}) but high-importance ${verdicts.kind} framing — queued for confirmation instead of dropped`,
				],
			};
		}
		return {
			action: "reject_derivable",
			score: 0,
			reasons: [`derivable from code (${verdicts.derivable.toFixed(2)} ≥ ${thresholds.minDerivable})`],
		};
	}
	if (verdicts.alreadyKnown >= 0.9) {
		return { action: "reject_duplicate", score: 0, reasons: ["already known"] };
	}
	if (verdicts.relation === "supersedes") {
		reasons.push("supersedes an existing claim");
	}
	if (verdicts.relation === "contradicts") {
		reasons.push("contradicts existing knowledge — dispute");
	}

	const score =
		weights.grounded * verdicts.grounded +
		weights.importance * verdicts.importanceNorm +
		weights.nonDerivable * (1 - verdicts.derivable) +
		weights.authority * 0.8;

	const relationReinforces = verdicts.relation === "extends" || verdicts.relation === "consistent";
	if (verdicts.grounded >= thresholds.autoAccept && verdicts.importance >= thresholds.minImportance && relationReinforces) {
		return { action: "reinforce", score, reasons: [...reasons, "reinforces existing knowledge"] };
	}
	if (verdicts.grounded >= thresholds.autoAccept && verdicts.importance >= thresholds.minImportance) {
		if (verdicts.durable < 0.5 && verdicts.importanceNorm < 0.5) {
			return { action: "review", score, reasons: [...reasons, "low durability"] };
		}
		return { action: "file", score, reasons };
	}
	if (verdicts.grounded >= thresholds.minSupport) {
		if (
			config.review.autoAcceptUserStated &&
			verdicts.trustTier === "user_stated" &&
			verdicts.durable >= 0.5 &&
			verdicts.importance >= thresholds.minImportance
		) {
			return { action: "file_user_stated", score, reasons: [...reasons, "user-stated trust tier (auto-accepted)"] };
		}
		return { action: "review", score, reasons: [...reasons, "below auto-accept threshold"] };
	}
	if (verdicts.trustTier === "user_stated" && verdicts.durable >= 0.5 && verdicts.importance >= thresholds.minImportance) {
		return { action: "file_user_stated", score, reasons: [...reasons, "user-stated trust tier (lower confidence)"] };
	}
	if (verdicts.trustTier === "verified_in_repo" && verdicts.durable >= 0.5 && verdicts.importance >= thresholds.minImportance) {
		return { action: "file", score, reasons: [...reasons, "repo-verified evidence"] };
	}
	return { action: "reject_unsupported", score, reasons: [...reasons, "not grounded in evidence"] };
}

/** Concrete topic suggestion for a claim kind when Jev finds no existing topic fits. */
const TOPIC_BY_KIND: Record<string, string> = {
	architecture: "architecture",
	invariant: "invariants",
	decision: "decisions",
	gotcha: "gotchas",
	procedure: "procedures",
	pattern: "patterns",
	concept: "concepts",
	fact: "facts",
	preference: "preferences",
};

export function suggestTopic(kind: string): string {
	return TOPIC_BY_KIND[kind] ?? "notes";
}
