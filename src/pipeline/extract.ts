/**
 * Claim extraction from a source document using the session's generative model.
 * Extraction is the only generative step at ingest; Jev judges the results.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface ExtractedClaim {
	text: string;
	kind: string;
	quote?: string;
	files?: string[];
	confidence?: number;
	quoteVerified?: boolean;
}

export interface ExtractionResult {
	title?: string;
	summary?: string;
	topics: string[];
	entities: string[];
	claims: ExtractedClaim[];
	raw: string;
}

const MAX_SOURCE_CHARS = 40_000;

const SYSTEM_PROMPT = `You extract durable project knowledge for a wiki that helps coding agents make better decisions on large codebases.

Return ONLY a JSON object, no prose, no code fences:
{
  "title": "short page/source title",
  "summary": "one sentence",
  "topics": ["topic-slug"],
  "entities": ["named modules, services, files, people"],
  "claims": [
    {
      "text": "one atomic, self-contained statement (a single fact, rule, decision, or structure)",
      "kind": "architecture|invariant|decision|fact|gotcha|procedure|pattern",
      "quote": "exact verbatim span from the source that supports this, or empty string",
      "files": ["path/to/file.ts"],
      "confidence": 0.0
    }
  ]
}

Rules:
- Atomic: one idea per claim. Split compound sentences.
- High-level framing over implementation detail. Prefer ownership, boundaries, data flow, invariants, rationale, contracts, and failure modes.
- Skip anything trivially visible from reading the code (function bodies, obvious implementation).
- Include the exact quote when one exists; never paraphrase a quote. If no quote supports it, leave quote empty.
- Include file paths only when they appear in the source or are explicitly referenced.
- Maximum 40 claims, ordered by how much they help a future decision.`;

function stripFences(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith("```")) {
		return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
	}
	return trimmed;
}

export function parseJsonObject<T>(text: string): T | undefined {
	const cleaned = stripFences(text);
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return undefined;
	try {
		return JSON.parse(cleaned.slice(start, end + 1)) as T;
	} catch {
		return undefined;
	}
}

export function normalizeForMatch(text: string): string {
	return text
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

export function quoteIsPresent(sourceText: string, quote: string | undefined): boolean {
	if (!quote || quote.trim().length < 12) return false;
	return normalizeForMatch(sourceText).includes(normalizeForMatch(quote));
}

export async function extractClaims(
	ctx: ExtensionContext,
	sourceText: string,
	options?: { title?: string; maxTokens?: number },
): Promise<{ result: ExtractionResult; sourceTruncated: boolean }> {
	const truncated = sourceText.length > MAX_SOURCE_CHARS;
	const source = truncated ? `${sourceText.slice(0, MAX_SOURCE_CHARS)}\n\n[... source truncated for extraction ...]` : sourceText;
	const user = `${options?.title ? `Document title: ${options.title}\n\n` : ""}<document>\n${source}\n</document>`;

	const model = ctx.model;
	if (!model) throw new Error("No active model available for claim extraction.");

	const response = await ctx.modelRegistry.complete(
		model,
		{
			systemPrompt: SYSTEM_PROMPT,
			messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }],
		},
		{ maxTokens: options?.maxTokens ?? 8000, signal: ctx.signal, cacheRetention: "none" },
	);

	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");

	const parsed = parseJsonObject<Partial<ExtractionResult>>(text);
	if (!parsed || !Array.isArray(parsed.claims)) {
		return {
			result: { topics: [], entities: [], claims: [], raw: text },
			sourceTruncated: truncated,
		};
	}

	const claims: ExtractedClaim[] = parsed.claims
		.filter((claim) => claim && typeof claim.text === "string" && claim.text.trim().length > 0)
		.slice(0, 40)
		.map((claim) => ({
			text: claim.text.trim(),
			kind: typeof claim.kind === "string" ? claim.kind : "fact",
			quote: typeof claim.quote === "string" && claim.quote.trim() ? claim.quote.trim() : undefined,
			files: Array.isArray(claim.files) ? claim.files.map(String).slice(0, 10) : [],
			confidence: typeof claim.confidence === "number" ? claim.confidence : undefined,
		}));

	for (const claim of claims) {
		if (claim.quote) {
			claim.quoteVerified = quoteIsPresent(sourceText, claim.quote);
			if (!claim.quoteVerified) claim.quote = undefined;
		}
	}

	return {
		result: {
			title: typeof parsed.title === "string" ? parsed.title : options?.title,
			summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
			topics: Array.isArray(parsed.topics) ? parsed.topics.map(String).slice(0, 6) : [],
			entities: Array.isArray(parsed.entities) ? parsed.entities.map(String).slice(0, 20) : [],
			claims,
			raw: text,
		},
		sourceTruncated: truncated,
	};
}
