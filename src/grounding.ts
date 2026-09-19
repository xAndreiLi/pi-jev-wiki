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
