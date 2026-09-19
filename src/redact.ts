/**
 * Redaction: best-effort secret/PII stripping before content is written to raw/
 * or sent to a model. Redaction is defensive, not a guarantee — regex cannot
 * catch everything, and it is logged so the ledger shows what was removed.
 */

export interface RedactionFinding {
	type: string;
	count: number;
}

export interface RedactionResult {
	text: string;
	findings: RedactionFinding[];
}

const PATTERNS: Array<{ type: string; regex: RegExp; replacement: string }> = [
	{ type: "private_key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
	{ type: "openai_key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED_OPENAI_KEY]" },
	{ type: "openrouter_key", regex: /\bsk-or-v1-[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_OPENROUTER_KEY]" },
	{ type: "anthropic_key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED_ANTHROPIC_KEY]" },
	{ type: "github_token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
	{ type: "aws_key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
	{ type: "bearer_token", regex: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g, replacement: "Bearer [REDACTED_TOKEN]" },
	{ type: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: "[REDACTED_JWT]" },
	{ type: "slack_token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "[REDACTED_SLACK_TOKEN]" },
	{
		type: "generic_secret_assignment",
		regex: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{16,}["']?/gi,
		replacement: "[REDACTED_SECRET]",
	},
	{ type: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[REDACTED_EMAIL]" },
];

/** Redact secrets and PII, returning what was found. */
export function redact(text: string): RedactionResult {
	let output = text;
	const findings: RedactionFinding[] = [];
	for (const pattern of PATTERNS) {
		const matches = output.match(pattern.regex);
		if (!matches || matches.length === 0) continue;
		findings.push({ type: pattern.type, count: matches.length });
		output = output.replace(pattern.regex, pattern.replacement);
	}
	return { text: output, findings };
}
