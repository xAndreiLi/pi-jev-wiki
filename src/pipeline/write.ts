/**
 * Writer pipeline: turn accepted claims into wiki pages or drafts.
 *
 * The model writes prose only; code assembles frontmatter from the adjudication
 * results, so status/support/evidence cannot be hallucinated. Mode is adaptive:
 * high-criticality claims downgrade auto -> draft -> guided.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedConfig, WriterMode } from "../config.ts";
import { appendLedger } from "../ledger.ts";
import { readPage, todayISO, writePage, writeTextAtomic, type WikiLayout } from "../wiki/layout.ts";
import { appendLog, entryFromPage, readIndex, upsertEntries, writeIndex } from "../wiki/toc.ts";

export interface WriterClaim {
	text: string;
	kind?: string;
	pageType?: string;
	topic?: string;
	target?: string;
	trustTier?: string;
	files: string[];
	evidence: string[];
	grounded: number;
	criticality: number;
}

export interface WriterPlan {
	title: string;
	topic: string;
	sourcePath?: string;
	claims: WriterClaim[];
}

export interface WriterResult {
	mode: WriterMode;
	written: string[];
	drafted: string[];
	groups: number;
	usage: { input_tokens: number; output_tokens: number };
}

export function resolveWriterMode(requested: WriterMode, claims: WriterClaim[], config: ResolvedConfig): WriterMode {
	const worst = claims.reduce((max, claim) => Math.max(max, claim.criticality), 0);
	let mode = requested;
	if (mode === "auto" && worst >= config.review.escalateCriticality) mode = "draft";
	if (mode === "draft" && worst >= config.review.escalateCriticality) mode = "guided";
	return mode;
}

interface WriterGroup {
	target?: string;
	pageType: string;
	topic: string;
	claims: WriterClaim[];
}

function groupClaims(plan: WriterPlan): WriterGroup[] {
	const groups: WriterGroup[] = [];
	for (const claim of plan.claims) {
		const key = claim.target ?? `${claim.pageType ?? "concept"}:${claim.topic ?? plan.topic}`;
		let group = groups.find((candidate) => (candidate.target ?? `${candidate.pageType}:${candidate.topic}`) === key);
		if (!group) {
			group = {
				target: claim.target,
				pageType: claim.pageType ?? "concept",
				topic: claim.topic ?? plan.topic,
				claims: [],
			};
			groups.push(group);
		}
		group.claims.push(claim);
	}
	return groups;
}

function stripFences(text: string): string {
	const trimmed = text.trim();
	return trimmed.startsWith("```") ? trimmed.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "") : trimmed;
}

function parseWriterJson(text: string): { title?: string; summary?: string; tags?: string[]; body?: string } | undefined {
	const cleaned = stripFences(text);
	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(cleaned.slice(start, end + 1)) as { title?: string; summary?: string; tags?: string[]; body?: string };
	} catch {
		return undefined;
	}
}

const WRITER_RULES = `You maintain a project wiki that gives coding agents the mental model of a system.
Write the page body in markdown: concrete, decision-oriented, no code blocks unless essential, no frontmatter.
Use short sections (Responsibility, Invariants, Change impact, See also) as appropriate.
Every factual statement must come from the supplied claims and evidence. Do not invent file paths, numbers, or behavior.
Prefer updating an existing page over restating it: merge the new claims into the existing text, keeping it coherent.
Return ONLY JSON: { "title": "...", "summary": "one line", "tags": ["..."], "body": "markdown body" }`;

function buildUserPrompt(group: WriterGroup, plan: WriterPlan, existing: { body: string; data: Record<string, unknown> } | undefined, sourceExcerpt: string): string {
	const claims = group.claims.map((claim) => `- (${claim.trustTier ?? "source_document"}) ${claim.text}`).join("\n");
	const files = [...new Set(group.claims.flatMap((claim) => claim.files))];
	const evidence = [...new Set(group.claims.flatMap((claim) => claim.evidence))];
	return [
		`Source title: ${plan.title}`,
		`Page type: ${group.pageType}`,
		`Topic: ${group.topic}`,
		files.length ? `Related code files: ${files.join(", ")}` : "",
		evidence.length ? `Evidence: ${evidence.join(", ")}` : "",
		existing ? `\nExisting page to update (keep what is still true, integrate the claims):\n---\n${existing.body.slice(0, 6000)}\n---` : "",
		`\nClaims to file:\n${claims}`,
		sourceExcerpt ? `\nSource material (may be truncated):\n---\n${sourceExcerpt}\n---` : "",
	].filter(Boolean).join("\n");
}

async function callWriter(
	ctx: ExtensionContext,
	group: WriterGroup,
	plan: WriterPlan,
	existing: { body: string; data: Record<string, unknown> } | undefined,
	sourceExcerpt: string,
): Promise<{ result?: { title?: string; summary?: string; tags?: string[]; body?: string }; usage: { input_tokens: number; output_tokens: number } }> {
	const model = ctx.model;
	if (!model) return { usage: { input_tokens: 0, output_tokens: 0 } };
	const response = await ctx.modelRegistry.complete(
		model,
		{
			systemPrompt: WRITER_RULES,
			messages: [{ role: "user", content: [{ type: "text", text: buildUserPrompt(group, plan, existing, sourceExcerpt) }], timestamp: Date.now() }],
		},
		{ maxTokens: 6000, signal: ctx.signal, cacheRetention: "none" },
	);
	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return {
		result: parseWriterJson(text),
		usage: response.usage
			? { input_tokens: response.usage.input ?? 0, output_tokens: response.usage.output ?? 0 }
			: { input_tokens: 0, output_tokens: 0 },
	};
}

export async function writeAcceptedPages(
	ctx: ExtensionContext,
	layout: WikiLayout,
	config: ResolvedConfig,
	plan: WriterPlan,
	requestedMode: WriterMode,
): Promise<WriterResult> {
	const mode = resolveWriterMode(requestedMode, plan.claims, config);
	const usage = { input_tokens: 0, output_tokens: 0 };
	if (mode === "guided" || plan.claims.length === 0) {
		return { mode, written: [], drafted: [], groups: 0, usage };
	}

	const groups = groupClaims(plan);
	const sourceExcerpt = plan.sourcePath && existsSync(join(layout.root, plan.sourcePath))
		? (await readFile(join(layout.root, plan.sourcePath), "utf8")).slice(0, 12_000)
		: "";

	const written: string[] = [];
	const drafted: string[] = [];
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const draftDir = join(layout.stateDir, "drafts", stamp);

	for (const group of groups) {
		const existing = group.target && existsSync(join(layout.wikiDir, group.target)) ? await readPage(join(layout.wikiDir, group.target)) : undefined;

		const { result, usage: callUsage } = await callWriter(ctx, group, plan, existing, sourceExcerpt);
		usage.input_tokens += callUsage.input_tokens;
		usage.output_tokens += callUsage.output_tokens;
		if (!result?.body) continue;

		const typePrefix = group.pageType.includes("/") ? group.pageType.split("/")[1] : group.pageType;
		const finalRel = group.target ?? `${group.topic}/${typePrefix}-${slugPart(result.title ?? group.claims[0].text)}.md`;
		const absolute = join(layout.wikiDir, finalRel);

		const claimRecords = group.claims.map((claim, index) => ({
			id: `c${index + 1}`,
			text: claim.text,
			status: claim.trustTier === "user_stated" ? "user-stated" : "verified",
			support: Number(claim.grounded.toFixed(2)),
			evidence: claim.evidence.length > 0 ? claim.evidence : plan.sourcePath ? [plan.sourcePath] : [],
		}));
		const data: Record<string, unknown> = {
			title: result.title ?? existing?.data.title ?? plan.title,
			type: group.pageType,
			topic: group.topic,
			summary: result.summary ?? existing?.data.summary ?? "",
			tags: Array.isArray(result.tags) ? result.tags.map(String).slice(0, 8) : [],
			updated: todayISO(),
			sources: [...new Set([...(Array.isArray(existing?.data.sources) ? existing!.data.sources.map(String) : []), ...(plan.sourcePath ? [plan.sourcePath] : [])])],
			files: [...new Set([...(Array.isArray(existing?.data.files) ? existing!.data.files.map(String) : []), ...group.claims.flatMap((claim) => claim.files)])],
			claims: [...(Array.isArray(existing?.data.claims) ? (existing!.data.claims as unknown[]) : []), ...claimRecords],
		};

		if (mode === "draft") {
			const draftPath = join(draftDir, finalRel);
			await writePage(draftPath, data, result.body);
			drafted.push(finalRel);
		} else {
			await writePage(absolute, data, result.body);
			written.push(finalRel);
		}
		await appendLedger(layout, {
			actor: "agent",
			op: "wiki.write",
			subject: finalRel,
			action: mode,
			reason: `${group.claims.length} accepted claim(s)`,
			verdict: { mode, claims: group.claims.length, grounded: group.claims.map((claim) => claim.grounded) },
		});
	}

	if (written.length > 0) {
		const entries = await readIndex(layout);
		const updates = [];
		for (const rel of written) {
			const page = await readPage(join(layout.wikiDir, rel));
			updates.push(entryFromPage(rel, page.data));
		}
		await writeIndex(layout, upsertEntries(entries, updates));
		await appendLog(layout, "write", `${written.length} page(s) (${mode})`, written.map((rel) => `Written: ${rel}`));
	}
	if (drafted.length > 0) {
		await writeTextAtomic(join(draftDir, "manifest.json"), `${JSON.stringify({ created: stamp, plan: plan.title, pages: drafted }, null, "\t")}\n`);
		await appendLog(layout, "draft", `${drafted.length} page(s)`, drafted.map((rel) => `Draft: ${rel}`));
	}
	return { mode, written, drafted, groups: groups.length, usage };
}

function slugPart(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.split("-")
		.slice(0, 5)
		.join("-");
}
