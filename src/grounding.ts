/**
 * Writer grounding: extract load-bearing literals from generated page bodies
 * (numbers, URLs, version strings) and check them against the evidence the
 * writer was given. Anything absent is flagged for review — this catches the
 * characteristic failure of generative writing: plausible invented specifics.
 */

export interface LiteralCheck {
	literals: string[];
	missing: string[];
}

const LITERAL_PATTERNS: RegExp[] = [
	/\b\d+(?:[.,]\d+)*(?:\s?(?:ms|s|m|h|kb|mb|gb|tok|tokens|%)|(?:\s?(?:million|billion)))?\b/g,
	/https?:\/\/[^\s)"'\]]+/g,
	/\bv?\d+\.\d+(?:\.\d+)?\b/g,
];

function normalizeNumber(value: string): string {
	return value.replace(/[,\s]/g, "").toLowerCase();
}

/** Extract literals worth verifying; single digits and years are ignored as noise. */
export function extractLiterals(body: string): string[] {
	const withoutCode = body.replace(/```[\s\S]*?```/g, " ");
	const found = new Set<string>();
	for (const pattern of LITERAL_PATTERNS) {
		for (const match of withoutCode.matchAll(pattern)) {
			const value = match[0].trim();
			if (/^\d$/.test(value)) continue;
			if (/^(19|20)\d{2}$/.test(value)) continue;
			found.add(value);
		}
	}
	return [...found];
}

export function checkLiterals(body: string, evidence: string): LiteralCheck {
	const literals = extractLiterals(body);
	const haystack = evidence.toLowerCase();
	const missing = literals.filter((literal) => {
		const candidates = [literal.toLowerCase(), normalizeNumber(literal)];
		return !candidates.some((candidate) => haystack.includes(candidate));
	});
	return { literals, missing };
}

function tokens(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter((token) => token.length > 3),
	);
}

/** Line excerpts around terms from the claim, so Jev sees the relevant part of a long source. */
export function excerptAroundTerms(content: string, claimText: string, maxChars: number): string {
	const lines = content.split(/\r?\n/);
	const terms = [...new Set(claimText.toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 3))].slice(0, 12);
	if (terms.length === 0 || lines.length <= 60) return content.length > maxChars ? `${content.slice(0, maxChars)}\n\n[... truncated ...]` : content;
	const scored = lines
		.map((line, index) => ({ index, score: terms.reduce((sum, term) => sum + (line.toLowerCase().includes(term) ? 1 : 0), 0) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 10);
	if (scored.length === 0) return content.length > maxChars ? `${content.slice(0, maxChars)}\n\n[... truncated ...]` : content;
	const chosen = new Set<number>();
	for (const { index } of scored) {
		for (let i = Math.max(0, index - 4); i <= Math.min(lines.length - 1, index + 4); i++) chosen.add(i);
	}
	const out: string[] = [];
	let last = -1;
	for (const index of [...chosen].sort((a, b) => a - b)) {
		if (last !== -1 && index > last + 1) out.push("  ...");
		out.push(`${String(index + 1).padStart(4)}| ${lines[index]}`);
		last = index;
	}
	const body = out.join("\n");
	return body.length > maxChars ? `${body.slice(0, maxChars)}\n\n[... truncated ...]` : body;
}

export interface ClosestPassage {
	excerpt: string;
	overlap: number;
}

/**
 * Best-matching paragraph for a claim, with a token-overlap score. Used to explain
 * `reject_unsupported` verdicts: the closest thing the source actually says.
 */
export function closestPassage(source: string, claim: string, maxChars = 320): ClosestPassage | undefined {
	const claimTokens = tokens(claim);
	if (claimTokens.size === 0) return undefined;
	let best: { excerpt: string; overlap: number } | undefined;
	for (const raw of source.split(/\n{2,}/)) {
		const segment = raw.replace(/\s+/g, " ").trim();
		if (!segment) continue;
		const segmentTokens = tokens(segment);
		if (segmentTokens.size === 0) continue;
		let shared = 0;
		for (const token of claimTokens) if (segmentTokens.has(token)) shared++;
		const overlap = shared / Math.min(claimTokens.size, segmentTokens.size);
		if (!best || overlap > best.overlap) best = { excerpt: segment, overlap };
	}
	if (!best || best.overlap === 0) return undefined;
	return {
		excerpt: best.excerpt.length > maxChars ? `${best.excerpt.slice(0, maxChars)}…` : best.excerpt,
		overlap: Number(best.overlap.toFixed(2)),
	};
}
