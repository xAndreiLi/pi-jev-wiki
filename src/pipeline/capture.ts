/**
 * Automated session capture: serialize the session, extract candidate insights
 * with the session model, and hand them to the Jev adjudication pipeline.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeForMatch, parseJsonObject } from "./extract.ts";

export interface CapturedInsight {
	text: string;
	kind?: string;
	evidence?: Array<{ kind: string; ref: string; quote?: string }>;
	confidence?: number;
}

const SYSTEM_PROMPT = `You extract durable project knowledge from a coding session for a wiki that helps future agents make better decisions.

Return ONLY JSON, no prose, no fences:
{ "insights": [ { "text": "one atomic, self-contained statement", "kind": "decision|invariant|architecture|gotcha|pattern|procedure|fact", "evidence": [ { "kind": "file|commit|test|command|user", "ref": "path, commit hash, command, or short quote from the user", "quote": "optional exact quote" } ], "confidence": 0.0 } ] }

Rules:
- 0 to 8 insights. Fewer is better. An empty list is a valid answer.
- Only durable knowledge: decisions with rationale, invariants, architecture/framing, gotchas, patterns, procedures.
- Never include transient task state ("currently debugging X"), code snippets, or anything a future agent can re-derive by reading the repository in under a minute.
- Evidence must point at something concrete from the session: a file path, commit, command, or the user's own words.
- Prefer knowledge the session produced over knowledge the session merely consumed.`;

interface ContentPart {
	type?: string;
	text?: string;
	name?: string;
	arguments?: unknown;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentPart;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		if (block.type === "toolCall" && typeof block.name === "string") {
			const args = block.arguments ? JSON.stringify(block.arguments).slice(0, 200) : "";
			parts.push(`[tool ${block.name}${args ? ` ${args}` : ""}]`);
		}
	}
	return parts.join("\n");
}

/** Serialize recent session messages into a compact transcript for extraction. */
export function sessionTextFromEntries(entries: unknown[], maxChars = 24_000): string {
	const lines: string[] = [];
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type !== "message" || !entry.message?.role) continue;
		const role = entry.message.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = textFromContent(entry.message.content).trim();
		if (!text) continue;
		lines.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
	}
	let transcript = lines.join("\n\n");
	if (transcript.length > maxChars) transcript = transcript.slice(-maxChars);
	return transcript;
}

/** Concatenated user-turn text, normalized for checking whether a quote really came from the user. */
export function userTextFromEntries(entries: unknown[]): string {
	const lines: string[] = [];
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = textFromContent(entry.message.content).trim();
		if (text) lines.push(text);
	}
	return normalizeForMatch(lines.join("\n"));
}

/** True when a `user`-kind evidence item actually appears verbatim in a user turn. */
export function userEvidenceSupported(userText: string, item: { quote?: string; ref?: string }): boolean {
	const needle = normalizeForMatch(item.quote ?? item.ref ?? "");
	return needle.length >= 12 && userText.includes(needle);
}

export async function extractInsights(
	ctx: ExtensionContext,
	sessionText: string,
	options?: { maxTokens?: number },
): Promise<CapturedInsight[]> {
	if (!sessionText.trim()) return [];
	const model = ctx.model;
	if (!model) return [];
	const response = await ctx.modelRegistry.complete(
		model,
		{
			systemPrompt: SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: `<session>\n${sessionText}\n</session>` }],
					timestamp: Date.now(),
				},
			],
		},
		{ maxTokens: options?.maxTokens ?? 4000, signal: ctx.signal, cacheRetention: "none" },
	);
	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const parsed = parseJsonObject<{ insights?: CapturedInsight[] }>(text);
	if (!parsed || !Array.isArray(parsed.insights)) return [];
	return parsed.insights
		.filter((insight) => insight && typeof insight.text === "string" && insight.text.trim().length > 0)
		.slice(0, 8)
		.map((insight) => ({
			text: insight.text.trim(),
			kind: typeof insight.kind === "string" ? insight.kind : "fact",
			evidence: Array.isArray(insight.evidence)
				? insight.evidence
						.filter((item) => item && typeof item.kind === "string" && typeof item.ref === "string")
						.map((item) => ({ kind: String(item.kind), ref: String(item.ref), quote: item.quote ? String(item.quote) : undefined }))
				: [],
			confidence: typeof insight.confidence === "number" ? insight.confidence : undefined,
		}));
}
