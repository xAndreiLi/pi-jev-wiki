/**
 * jev-wiki — a project mental-model wiki for pi, maintained with Jev decisions.
 *
 * P0 scope: architecture-first wiki layout + TOC, guided ingest (research channel),
 * agent insight capture (work channel), decision ledger, consultation tools.
 * Pages are written by the agent (guided mode); this extension stages, adjudicates,
 * places, and keeps the TOC/log current.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { loadConfig, type LoadedConfig, type JevWikiConfig } from "./config.ts";
import { headCommit, isGitRepo } from "./git.ts";
import { appendLedger, readLedger, summarizeLedger } from "./ledger.ts";
import {
	applyReviewResolution,
	enqueueReview,
	listOpenReviews,
	openReviewCount,
	readReviews,
	resolveReview,
} from "./review.ts";
import { readSyncState, syncWiki } from "./sync.ts";
import { createJevClient, type JevClient } from "./jev.ts";
import { adjudicateClaim, chooseTarget, decideClaim, type CandidateClaim, type CandidatePage } from "./pipeline/adjudicate.ts";
import { extractClaims, quoteIsPresent } from "./pipeline/extract.ts";
import {
	ensureLayout,
	listMarkdownFiles,
	readPage,
	resolveLayout,
	sha256Hex,
	slugify,
	todayISO,
	writePage,
	writeRawSource,
	writeTextAtomic,
	type WikiLayout,
} from "./wiki/layout.ts";
import {
	appendLog,
	entryFromPage,
	parseIndex,
	readIndex,
	readRecentLog,
	renderIndex,
	upsertEntries,
	writeIndex,
	type TocEntry,
} from "./wiki/toc.ts";

interface Runtime {
	loaded: LoadedConfig;
	layout: WikiLayout;
}

function runtimeFor(ctx: ExtensionContext): Runtime {
	const loaded = loadConfig(ctx.cwd);
	return { loaded, layout: resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot) };
}

function requireClient(loaded: LoadedConfig): JevClient {
	if (!loaded.apiKey) {
		throw new Error(
			`No Jev API key. Put it in ${loaded.envFilePath} as JEV_TOKEN=... (or set apiKey in ${loaded.projectConfigPath}).`,
		);
	}
	return createJevClient(loaded.config, loaded.apiKey);
}

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[... truncated ...]`;
}

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

async function readRawIndex(layout: WikiLayout): Promise<Record<string, string>> {
	const path = join(layout.stateDir, "raw-index.json");
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(await readFile(path, "utf8")) as Record<string, string>;
	} catch {
		return {};
	}
}

async function writeRawIndex(layout: WikiLayout, index: Record<string, string>): Promise<void> {
	await writeTextAtomic(join(layout.stateDir, "raw-index.json"), `${JSON.stringify(index, null, "\t")}\n`);
}

async function collectCandidatePages(layout: WikiLayout): Promise<CandidatePage[]> {
	const entries = await readIndex(layout);
	return entries.slice(0, 500).map((entry) => ({
		path: entry.path,
		title: entry.title,
		type: entry.type,
		summary: entry.summary,
		tags: entry.tags,
	}));
}

async function collectCandidateClaims(layout: WikiLayout): Promise<CandidateClaim[]> {
	const files = (await listMarkdownFiles(layout.wikiDir)).filter((file) => !file.endsWith("index.md") && !file.endsWith("log.md"));
	const claims: CandidateClaim[] = [];
	for (const file of files.slice(0, 200)) {
		try {
			const page = await readPage(file);
			const pagePath = relative(layout.wikiDir, file).split("\\").join("/");
			const rawClaims = Array.isArray(page.data.claims) ? page.data.claims : [];
			for (const rawClaim of rawClaims) {
				if (rawClaim && typeof rawClaim === "object" && typeof (rawClaim as Record<string, unknown>).text === "string") {
					const record = rawClaim as Record<string, unknown>;
					claims.push({
						id: typeof record.id === "string" ? record.id : undefined,
						text: record.text as string,
						page: pagePath,
						status: typeof record.status === "string" ? record.status : undefined,
					});
				}
			}
		} catch {
			/* skip unreadable pages */
		}
	}
	return claims.slice(0, 400);
}

async function existingTopics(layout: WikiLayout): Promise<string[]> {
	const files = await listMarkdownFiles(layout.wikiDir);
	const topics = new Set<string>();
	for (const file of files) {
		const rel = relative(layout.wikiDir, file).split("\\").join("/");
		const topic = rel.split("/")[0];
		if (topic && topic !== rel) topics.add(topic);
	}
	return [...topics].sort();
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

interface ClaimReport {
	text: string;
	quoteVerified: boolean;
	action: string;
	score: number;
	reasons: string[];
	grounded: number;
	derivable: number;
	importanceNorm: number;
	criticalityNorm: number;
	trustTier?: string;
	files: string[];
	pageType?: string;
	topic?: string;
	target?: string;
	newPage: boolean;
}

function renderBrief(title: string, reports: ClaimReport[], extras: string[] = []): string {
	const filed = reports.filter((report) => report.action === "file" || report.action === "file_user_stated");
	const reinforced = reports.filter((report) => report.action === "reinforce");
	const review = reports.filter((report) => report.action === "review");
	const rejected = reports.filter((report) => report.action.startsWith("reject"));

	const lines: string[] = [`## Wiki ingest brief — ${title}`, ""];
	lines.push(
		`Claims: ${reports.length} · file ${filed.length} · reinforce ${reinforced.length} · review ${review.length} · rejected ${rejected.length}`,
		"",
	);
	if (filed.length > 0) {
		lines.push("### File into wiki");
		for (const report of filed) {
			const where = report.target
				? `merge → \`${report.target}\``
				: `new page (${report.pageType ?? "concept"}${report.topic ? `, topic \`${report.topic}\`` : ""})`;
			const trust = report.action === "file_user_stated" ? " [user-stated: use `status: user-stated`]" : "";
			const files = report.files.length > 0 ? ` (files: ${report.files.map((file) => `\`${file}\``).join(", ")})` : "";
			lines.push(`- ${where} — ${report.text}${trust}${files}`);
			lines.push(
				`  grounded ${report.grounded.toFixed(2)} · derivable ${report.derivable.toFixed(2)} · importance ${report.importanceNorm.toFixed(2)} · criticality ${report.criticalityNorm.toFixed(2)}`,
			);
		}
		lines.push("");
	}
	if (reinforced.length > 0) {
		lines.push("### Reinforce existing knowledge");
		for (const report of reinforced) {
			lines.push(`- ${report.target ? `\`${report.target}\`` : "existing page"} — ${report.text}`);
		}
		lines.push("");
	}
	if (review.length > 0) {
		lines.push("### Needs review (below threshold)");
		for (const report of review) {
			lines.push(`- ${report.text} — ${report.reasons.join("; ")}`);
		}
		lines.push("");
	}
	if (rejected.length > 0) {
		lines.push("### Not filed");
		for (const report of rejected) {
			lines.push(`- [${report.action.replace("reject_", "")}] ${report.text} — ${report.reasons.join("; ")}`);
		}
		lines.push("");
	}
	if (extras.length > 0) lines.push(...extras, "");
	lines.push(
		"### Next steps (guided mode)",
		"1. Write or merge pages per the llm-wiki skill, citing the raw source.",
		"2. Include YAML frontmatter (title, type, topic, summary, tags, updated, claims with status/support/evidence).",
		"3. Set page-level `files: [...]` (or per-claim `files`) for claims about code, so `wiki_sync` can detect when the code changes.",
		"4. Call `wiki_finalize` with the touched page paths.",
	);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

async function ingestSource(
	runtime: Runtime,
	ctx: ExtensionContext,
	input: { text: string; title: string; topic: string; source?: string },
): Promise<{ brief: string; details: Record<string, unknown>; rawPath: string; duplicateOf?: string }> {
	const { loaded, layout } = runtime;
	const client = requireClient(loaded);
	const config = loaded.config;

	await ensureLayout(layout);
	const hash = await sha256Hex(input.text);
	const rawIndex = await readRawIndex(layout);
	if (rawIndex[hash]) {
		return {
			brief: `Source already ingested (sha256 ${hash.slice(0, 12)}…): \`${rawIndex[hash]}\`. Nothing to do.`,
			details: { duplicateOf: rawIndex[hash], hash },
			rawPath: rawIndex[hash],
			duplicateOf: rawIndex[hash],
		};
	}

	const rawPath = await writeRawSource(
		layout,
		input.topic,
		input.title,
		{
			title: input.title,
			type: "raw-source",
			source: input.source ?? null,
			collected: todayISO(),
			sha256: hash,
		},
		input.text,
	);
	rawIndex[hash] = relative(layout.root, rawPath).split("\\").join("/");
	await writeRawIndex(layout, rawIndex);

	const { result: extraction, sourceTruncated } = await extractClaims(ctx, input.text, { title: input.title });
	const candidates = await collectCandidatePages(layout);
	const candidateClaims = await collectCandidateClaims(layout);
	const topics = await existingTopics(layout);

	const perClaim = await mapLimitLocal(extraction.claims, 4, async (claim) => {
		const evidenceText = claim.quote ?? input.text.slice(0, 6000);
		const adjudication = await adjudicateClaim(
			client,
			{ text: claim.text, kind: claim.kind, quote: claim.quote, files: claim.files, evidenceText },
			config,
			{ candidateClaims, existingTopics: topics, signal: ctx.signal, evidenceText },
		);
		const decision = decideClaim(adjudication.verdicts, config);
		let placement: Awaited<ReturnType<typeof chooseTarget>> | undefined;
		if (decision.action === "file" || decision.action === "reinforce") {
			placement = await chooseTarget(client, { text: claim.text, kind: claim.kind, quote: claim.quote, files: claim.files, evidenceText }, candidates, config, {
				signal: ctx.signal,
				evidenceText,
			});
		}
		const verdicts = { ...adjudication.verdicts, ...(placement?.verdicts ?? {}) };
		const totalUsage = {
			input_tokens: adjudication.usage.input_tokens + (placement?.usage.input_tokens ?? 0),
			output_tokens: adjudication.usage.output_tokens + (placement?.usage.output_tokens ?? 0),
		};
		if (decision.action === "review") {
			await enqueueReview(layout, {
				kind: "claim_review",
				claimText: claim.text,
				page: verdicts.target,
				claimId: undefined,
				criticality: Math.max(0.3, 1 - verdicts.grounded),
				reason: decision.reasons.join("; "),
				verdicts,
			});
		}
		if (verdicts.relation === "contradicts") {
			await enqueueReview(layout, {
				kind: "dispute",
				claimText: claim.text,
				page: verdicts.target,
				criticality: 0.8,
				reason: "contradicts existing wiki knowledge",
				verdicts,
			});
		}
		await appendLedger(layout, {
			actor: "jev",
			op: "ingest.adjudicate",
			subject: claim.text.slice(0, 120),
			verdict: verdicts,
			thresholds: config.thresholds,
			action: decision.action,
			reason: decision.reasons.join("; "),
			usage: totalUsage,
		});
		await appendLedger(layout, {
			actor: "code",
			op: "ingest.decide",
			subject: claim.text.slice(0, 120),
			action: decision.action,
			reason: decision.reasons.join("; "),
			verdict: { score: decision.score, target: verdicts.target ?? null, newPage: verdicts.newPage },
		});
		return { claim, verdicts, decision, usage: adjudication.usage };
	});

	const reports: ClaimReport[] = perClaim.map(({ claim, verdicts, decision }) => ({
		text: claim.text,
		quoteVerified: Boolean(claim.quoteVerified),
		action: decision.action,
		score: decision.score,
		reasons: decision.reasons,
		grounded: verdicts.grounded,
		derivable: verdicts.derivable,
		importanceNorm: verdicts.importanceNorm,
		criticalityNorm: verdicts.criticalityNorm,
		trustTier: verdicts.trustTier,
		files: claim.files ?? [],
		pageType: verdicts.pageType,
		topic: verdicts.topic,
		target: verdicts.target,
		newPage: verdicts.newPage,
	}));

	await appendLog(layout, "ingest", input.title, [
		`Raw: ${relative(layout.root, rawPath).split("\\").join("/")}`,
		`Claims: ${reports.length} (filed ${reports.filter((r) => r.action === "file").length}, reinforced ${reports.filter((r) => r.action === "reinforce").length})`,
	]);

	const brief = renderBrief(input.title, reports, [
		`Raw source: \`${relative(layout.root, rawPath).split("\\").join("/")}\`${sourceTruncated ? " (truncated during extraction)" : ""}`,
		`Full text kept at the raw path for citation.`,
	]);
	return {
		brief,
		details: {
			hash,
			rawPath,
			claims: reports,
			claimsTotal: reports.length,
			extraction: { topics: extraction.topics, entities: extraction.entities, summary: extraction.summary },
			usage: client.totals,
		},
		rawPath,
	};
}

async function mapLimitLocal<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await fn(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "wiki_status",
		label: "Wiki Status",
		description: "Show project wiki status: paths, page/raw counts, TOC size, review queue, recent log, and Jev usage.",
		promptSnippet: "Show project wiki status and Jev usage",
		promptGuidelines: ["Use wiki_status when the user asks about the wiki itself or before maintenance work."],
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const runtime = runtimeFor(ctx);
			const { loaded, layout } = runtime;
			const pages = existsSync(layout.wikiDir) ? await listMarkdownFiles(layout.wikiDir) : [];
			const raws = existsSync(layout.rawDir) ? await listMarkdownFiles(layout.rawDir) : [];
			const entries = await readIndex(layout);
			const ledger = await readLedger(layout);
			const summary = summarizeLedger(ledger);
			const recent = await readRecentLog(layout, 5);
			const text = [
				`# jev-wiki status`,
				"",
				`- Wiki root: \`${layout.root}\``,
				`- Pages: ${pages.length} (TOC entries: ${entries.length})`,
				`- Raw sources: ${raws.length}`,
				`- Provider/model: ${loaded.config.provider} · ${loaded.config.model}`,
				`- API key: ${loaded.apiKey ? "configured" : `MISSING (${loaded.envFilePath})`}`,
				`- Writer mode: ${loaded.config.writer.mode} · review: ${loaded.config.review.mode}`,
				`- Review queue: ${await openReviewCount(layout)} open`,
				`- Ledger: ${summary.total} decisions (${JSON.stringify(summary.byActor)})`,
				`- Jev tokens: ${summary.jevTokensIn} in / ${summary.jevTokensOut} out${summary.jevCost ? ` · $${summary.jevCost.toFixed(6)}` : ""}`,
				"",
				recent.length ? `Recent log:\n${recent.map((line) => `- ${line}`).join("\n")}` : "Recent log: (empty)",
			].join("\n");
			return { content: [{ type: "text", text }], details: { layout, pages: pages.length, raws: raws.length, entries: entries.length, ledger: summary } };
		},
	});

	pi.registerTool({
		name: "wiki_toc",
		label: "Wiki Table of Contents",
		description: "Read the project wiki table of contents (optionally filtered by topic, tag, or query).",
		promptSnippet: "Read the wiki table of contents",
		promptGuidelines: [
			"Use wiki_toc before architectural or unfamiliar changes, when planning work, or when a project term is unclear.",
			"Consult the wiki proactively: it holds the project's structure, invariants, decisions, and gotchas.",
		],
		parameters: Type.Object({
			topic: Type.Optional(Type.String({ description: "Filter to one topic directory" })),
			tag: Type.Optional(Type.String({ description: "Filter to entries carrying this tag" })),
			query: Type.Optional(Type.String({ description: "Substring match on title or summary" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			const entries = await readIndex(layout);
			let filtered = entries;
			if (params.topic) filtered = filtered.filter((entry) => entry.path.startsWith(`${params.topic}/`));
			if (params.tag) filtered = filtered.filter((entry) => entry.tags.includes(params.tag!));
			if (params.query) {
				const needle = params.query.toLowerCase();
				filtered = filtered.filter(
					(entry) => entry.title.toLowerCase().includes(needle) || entry.summary.toLowerCase().includes(needle),
				);
			}
			if (filtered.length === 0) {
				return {
					content: [{ type: "text", text: entries.length === 0 ? "The wiki is empty. Ingest a source or capture session insights first." : "No TOC entries match." }],
					details: { entries: entries.length, filtered: 0 },
				};
			}
			const maxChars = loaded.config.toc.maxTokens * 4;
			return {
				content: [{ type: "text", text: truncate(renderIndex(filtered), maxChars) }],
				details: { entries: entries.length, filtered: filtered.length },
			};
		},
	});

	pi.registerTool({
		name: "wiki_ask",
		label: "Ask the Wiki",
		description: "Search the project wiki for pages relevant to a question and return matched excerpts with page paths.",
		promptSnippet: "Search the project wiki for relevant pages and excerpts",
		promptGuidelines: [
			"Use wiki_ask before designing or changing cross-cutting behavior; then read the returned pages with the read tool.",
			"Prefer wiki knowledge over guessing; cite the page paths you used.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "What you need to know" }),
			limit: Type.Optional(Type.Number({ description: "Max pages to return (default 5)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { layout } = runtimeFor(ctx);
			const files = await listMarkdownFiles(layout.wikiDir);
			const tokens = params.query
				.toLowerCase()
				.split(/[^a-z0-9_]+/)
				.filter((token) => token.length > 2);
			const scored: Array<{ file: string; score: number; hits: string[] }> = [];
			for (const file of files) {
				if (file.endsWith("index.md") || file.endsWith("log.md")) continue;
				const text = await readFile(file, "utf8");
				const lower = text.toLowerCase();
				let score = 0;
				for (const token of tokens) {
					const matches = lower.split(token).length - 1;
					score += Math.min(matches, 8);
				}
				if (score === 0) continue;
				const hits = text
					.split(/\r?\n/)
					.filter((line) => tokens.some((token) => line.toLowerCase().includes(token)))
					.slice(0, 4);
				scored.push({ file, score, hits });
			}
			scored.sort((a, b) => b.score - a.score);
			const top = scored.slice(0, Math.max(1, Math.min(params.limit ?? 5, 10)));
			if (top.length === 0) {
				return { content: [{ type: "text", text: "No wiki pages match. The wiki may not cover this yet." }], details: { matches: 0 } };
			}
			const text = top
				.map(({ file, score, hits }) => {
					const rel = relative(layout.wikiDir, file).split("\\").join("/");
					return [`### ${rel} (score ${score})`, ...hits.map((line) => `> ${line.trim().slice(0, 300)}`)].join("\n");
				})
				.join("\n\n");
			return { content: [{ type: "text", text }], details: { matches: top.length, pages: top.map(({ file }) => relative(layout.wikiDir, file).split("\\").join("/")) } };
		},
	});

	pi.registerTool({
		name: "wiki_ingest",
		label: "Ingest into Wiki",
		description:
			"Ingest a document into the project wiki: stores the immutable raw source, extracts claims, has Jev verify groundedness/derivability/durability and choose placement, and returns a brief. Pages are written by you (guided mode) and finalized with wiki_finalize.",
		promptSnippet: "Ingest a document into the project wiki (Jev-verified brief)",
		promptGuidelines: [
			"Use wiki_ingest when the user asks to add a document, URL content, or notes to the wiki.",
			"After wiki_ingest, write or merge the pages it recommends, then call wiki_finalize.",
		],
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Path to a source file (relative to the project)" })),
			text: Type.Optional(Type.String({ description: "Raw source text, when no file is available" })),
			title: Type.Optional(Type.String({ description: "Title override" })),
			topic: Type.Optional(Type.String({ description: "Topic directory override" })),
			source: Type.Optional(Type.String({ description: "Origin URL or description" })),
		}),
		async execute(_id, params, _signal, onUpdate, ctx) {
			const runtime = runtimeFor(ctx);
			let text = params.text ?? "";
			let title = params.title;
			if (params.path) {
				const abs = isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
				text = await readFile(abs, "utf8");
				if (!title) {
					const heading = text.match(/^#\s+(.+)$/m);
					title = heading ? heading[1].trim() : basename(abs).replace(/\.(md|txt|markdown)$/i, "");
				}
			}
			if (!text.trim()) throw new Error("wiki_ingest needs `path` or `text`.");
			title = title ?? "Untitled source";
			const topic = params.topic ?? slugify(title.split(/\s+/).slice(0, 3).join("-"), 30);
			onUpdate?.({ content: [{ type: "text", text: `Staging "${title}"…` }], details: {} });
			const result = await ingestSource(runtime, ctx, { text, title, topic, source: params.source });
			return { content: [{ type: "text", text: result.brief }], details: result.details };
		},
	});

	pi.registerTool({
		name: "wiki_insights",
		label: "Capture Agent Insights",
		description:
			"Submit a list of key insights from the current work session. Jev filters them (derivable/durable/sensitive), relates them to existing knowledge, and chooses placement into existing pages or new ones. Returns a brief; you then write/merge pages and call wiki_finalize.",
		promptSnippet: "Capture durable project insights from this session into the wiki",
		promptGuidelines: [
			"Use wiki_insights at the end of substantive work to capture durable, non-derivable knowledge (decisions, invariants, architecture, gotchas) with evidence pointers.",
			"Do not capture transient task state, code snippets, or anything derivable by reading the repo.",
			"After wiki_insights, write or merge the recommended pages, then call wiki_finalize.",
		],
		parameters: Type.Object({
			insights: Type.Array(
				Type.Object({
					text: Type.String({ description: "One atomic, self-contained insight" }),
					kind: Type.Optional(
						Type.String({ description: "decision | invariant | architecture | gotcha | pattern | procedure | fact | preference" }),
					),
					evidence: Type.Optional(
						Type.Array(
							Type.Object({
								kind: Type.String({ description: "file | commit | test | command | user | source" }),
								ref: Type.String({ description: "Path, commit hash, command, or quote" }),
								quote: Type.Optional(Type.String()),
							}),
						),
					),
					confidence: Type.Optional(Type.Number()),
				}),
			),
		}),
		async execute(_id, params, _signal, onUpdate, ctx) {
			const runtime = runtimeFor(ctx);
			const { loaded, layout } = runtime;
			const client = requireClient(loaded);
			const config = loaded.config;
			await ensureLayout(layout);
			if (params.insights.length === 0) {
				return { content: [{ type: "text", text: "No insights submitted." }], details: { count: 0 } };
			}

			const candidates = await collectCandidatePages(layout);
			const candidateClaims = await collectCandidateClaims(layout);
			const topics = await existingTopics(layout);
			const stamp = new Date();
			const slug = `session-${todayISO(stamp)}-${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}`;

			onUpdate?.({ content: [{ type: "text", text: `Adjudicating ${params.insights.length} insights…` }], details: {} });

			const perInsight = await mapLimitLocal(params.insights, 4, async (insight) => {
				const evidenceLines: string[] = [];
				const files: string[] = [];
				for (const evidence of insight.evidence ?? []) {
					evidenceLines.push(`${evidence.kind}: ${evidence.ref}${evidence.quote ? `\nquote: "${evidence.quote}"` : ""}`);
					if (evidence.kind === "file") files.push(evidence.ref);
				}
				const evidenceText = evidenceLines.join("\n") || "(no evidence attached)";
				const adjudication = await adjudicateClaim(
					client,
					{ text: insight.text, kind: insight.kind ?? "fact", files, evidenceText },
					config,
					{ candidateClaims, existingTopics: topics, signal: ctx.signal, evidenceText },
				);
				const decision = decideClaim(adjudication.verdicts, config);
				let placement: Awaited<ReturnType<typeof chooseTarget>> | undefined;
				if (decision.action === "file" || decision.action === "reinforce") {
					placement = await chooseTarget(client, { text: insight.text, kind: insight.kind ?? "fact", files, evidenceText }, candidates, config, {
						signal: ctx.signal,
						evidenceText,
					});
				}
				const verdicts = { ...adjudication.verdicts, ...(placement?.verdicts ?? {}) };
				const totalUsage = {
					input_tokens: adjudication.usage.input_tokens + (placement?.usage.input_tokens ?? 0),
					output_tokens: adjudication.usage.output_tokens + (placement?.usage.output_tokens ?? 0),
				};
				if (decision.action === "review") {
					await enqueueReview(layout, {
						kind: "claim_review",
						claimText: insight.text,
						page: verdicts.target,
						criticality: Math.max(0.3, 1 - verdicts.grounded),
						reason: decision.reasons.join("; "),
						verdicts,
					});
				}
				if (verdicts.relation === "contradicts") {
					await enqueueReview(layout, {
						kind: "dispute",
						claimText: insight.text,
						page: verdicts.target,
						criticality: 0.8,
						reason: "contradicts existing wiki knowledge",
						verdicts,
					});
				}
				await appendLedger(layout, {
					actor: "agent",
					op: "insight.proposed",
					subject: insight.text.slice(0, 120),
					evidence: evidenceLines,
					action: "submitted",
				});
				await appendLedger(layout, {
					actor: "jev",
					op: "insight.adjudicate",
					subject: insight.text.slice(0, 120),
					verdict: verdicts,
					thresholds: config.thresholds,
					action: decision.action,
					reason: decision.reasons.join("; "),
					usage: totalUsage,
				});
				await appendLedger(layout, {
					actor: "code",
					op: "insight.decide",
					subject: insight.text.slice(0, 120),
					action: decision.action,
					reason: decision.reasons.join("; "),
					verdict: { score: decision.score, target: verdicts.target ?? null, newPage: verdicts.newPage, trustTier: verdicts.trustTier ?? null },
				});
				return { insight, verdicts, decision, files };
			});

			const reports: ClaimReport[] = perInsight.map(({ insight, verdicts, decision, files }) => ({
				text: insight.text,
				quoteVerified: false,
				action: decision.action,
				score: decision.score,
				reasons: decision.reasons,
				grounded: verdicts.grounded,
				derivable: verdicts.derivable,
				importanceNorm: verdicts.importanceNorm,
				criticalityNorm: verdicts.criticalityNorm,
				trustTier: verdicts.trustTier,
				files,
				pageType: verdicts.pageType,
				topic: verdicts.topic,
				target: verdicts.target,
				newPage: verdicts.newPage,
			}));

			const rawBody = perInsight
				.map(({ insight, verdicts, decision }) => {
					const evidence = (insight.evidence ?? []).map((item) => `- ${item.kind}: ${item.ref}${item.quote ? ` — "${item.quote}"` : ""}`).join("\n");
					return [
						`### ${insight.text}`,
						insight.kind ? `Kind: ${insight.kind}` : "",
						evidence ? `Evidence:\n${evidence}` : "",
						`Verdict: ${decision.action} (grounded ${verdicts.grounded.toFixed(2)}, derivable ${verdicts.derivable.toFixed(2)}, importance ${verdicts.importanceNorm.toFixed(2)}, criticality ${verdicts.criticalityNorm.toFixed(2)})`,
						verdicts.target ? `Target: ${verdicts.target}` : "",
					]
						.filter(Boolean)
						.join("\n");
				})
				.join("\n\n");

			const rawPath = await writeRawSource(
				layout,
				"sessions",
				slug,
				{
					title: `Session capture ${todayISO(stamp)}`,
					type: "raw-source",
					source: "session",
					collected: todayISO(stamp),
					sha256: await sha256Hex(rawBody),
				},
				rawBody,
			);

			await appendLog(layout, "capture", `${reports.length} insights`, [
				`Raw: ${relative(layout.root, rawPath).split("\\").join("/")}`,
				`Filed ${reports.filter((r) => r.action === "file").length} · reinforced ${reports.filter((r) => r.action === "reinforce").length} · review ${reports.filter((r) => r.action === "review").length} · rejected ${reports.filter((r) => r.action.startsWith("reject")).length}`,
			]);

			const brief = renderBrief(`session ${todayISO(stamp)}`, reports, [
				`Raw session record: \`${relative(layout.root, rawPath).split("\\").join("/")}\``,
			]);
			return { content: [{ type: "text", text: brief }], details: { rawPath, insights: reports, usage: client.totals } };
		},
	});

	pi.registerTool({
		name: "wiki_finalize",
		label: "Finalize Wiki Pages",
		description: "Update the wiki table of contents and log for pages you wrote or edited, and report broken internal links.",
		promptSnippet: "Update wiki TOC/log after writing pages and check links",
		promptGuidelines: ["Call wiki_finalize with every page you created or edited in the wiki, before ending the turn."],
		parameters: Type.Object({
			pages: Type.Array(Type.String({ description: "Page paths (relative to the project or the wiki root)" })),
			note: Type.Optional(Type.String({ description: "Short note for the log" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { layout } = runtimeFor(ctx);
			const entries = await readIndex(layout);
			const updates: TocEntry[] = [];
			const broken: string[] = [];
			for (const page of params.pages) {
				const absolute = await resolvePagePath(layout, ctx.cwd, page);
				if (!absolute) {
					broken.push(`${page} (missing)`);
					continue;
				}
				const parsed = await readPage(absolute);
				const rel = relative(layout.wikiDir, absolute).split("\\").join("/");
				updates.push(entryFromPage(rel, parsed.data));
				for (const link of extractMarkdownLinks(parsed.body)) {
					if (/^[a-z]+:/i.test(link) || link.startsWith("#")) continue;
					const target = resolve(dirname(absolute), link.split("#")[0]);
					if (!existsSync(target)) broken.push(`${rel} → ${link}`);
				}
			}
			await writeIndex(layout, upsertEntries(entries, updates));
			await appendLog(layout, "finalize", params.note ?? `${updates.length} page(s)`, updates.map((entry) => `Updated: ${entry.path}`));
			await appendLedger(layout, {
				actor: "agent",
				op: "wiki.finalize",
				action: "updated",
				subject: updates.map((entry) => entry.path).join(", ").slice(0, 200),
				outcome: broken.length ? `broken links: ${broken.length}` : "ok",
			});
			const lines = [
				`Updated TOC for ${updates.length} page(s): ${updates.map((entry) => `\`${entry.path}\``).join(", ") || "(none)"}`,
				broken.length ? `Broken links:\n${broken.map((item) => `- ${item}`).join("\n")}` : "No broken links found.",
			];
			return { content: [{ type: "text", text: lines.join("\n") }], details: { updated: updates.map((entry) => entry.path), broken } };
		},
	});

	pi.registerTool({
		name: "wiki_sync",
		label: "Sync Wiki with Code",
		description:
			"Diff the repository since the last synced commit, ask Jev which file-linked claims are affected, and update them (no_impact / needs_recheck / supersede / dispute). Affected claims are queued for wiki_review. The first run initializes the sync baseline.",
		promptSnippet: "Re-verify the wiki after code changes (diff since last sync)",
		promptGuidelines: [
			"Run wiki_sync after pulling, rebasing, or before relying on wiki claims about recently changed files.",
			"The first wiki_sync initializes the baseline; later runs check all commits since then.",
		],
		parameters: Type.Object({
			baseline: Type.Optional(Type.String({ description: "Git ref to diff from (default: last synced commit)" })),
			dryRun: Type.Optional(Type.Boolean({ description: "Report impacts without changing pages or the baseline" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			const client = requireClient(loaded);
			onUpdate?.({ content: [{ type: "text", text: "Checking code changes since the last wiki sync…" }], details: {} });
			const report = await syncWiki(layout, client, loaded.config, ctx.cwd, {
				baseline: params.baseline,
				dryRun: params.dryRun,
				signal: ctx.signal,
			});
			if (!report.repo) {
				return { content: [{ type: "text", text: "Not a git repository; change-driven sync is unavailable." }], details: report };
			}
			if (report.baselineInitialized) {
				return {
					content: [{ type: "text", text: `Sync baseline initialized at ${report.head?.slice(0, 7)}. Future runs will check commits after this point.` }],
					details: report,
				};
			}
			const lines = [
				`## Wiki sync — ${report.baseline?.slice(0, 7)} → ${report.head?.slice(0, 7)}${report.dryRun ? " (dry run)" : ""}`,
				"",
				`Changed files: ${report.changedFiles.length} · file-linked claims matched: ${report.matchedClaims}`,
			];
			if (report.impacts.length === 0) {
				lines.push("", "No file-linked claims were affected. The wiki is current for this diff.");
			} else {
				lines.push("", "| Page | Claim | Impact | Still true |", "|------|-------|--------|------------|");
				for (const impact of report.impacts) {
					lines.push(
						`| \`${impact.page}\` | ${impact.text.slice(0, 70)} | ${impact.impact} (${impact.confidence.toFixed(2)}) | ${impact.stillTrue.toFixed(2)} |`,
					);
				}
				if (report.applied.length > 0) lines.push("", "Applied:", ...report.applied.map((line) => `- ${line}`));
				lines.push("", "Run `wiki_review` to resolve any queued needs-recheck or dispute items.");
			}
			return { content: [{ type: "text", text: lines.join("\n") }], details: report };
		},
	});

	pi.registerTool({
		name: "wiki_review",
		label: "Work the Wiki Review Queue",
		description:
			"List open wiki review items (disputes, needs-recheck claims, low-confidence claims) or resolve one. Critical items require user confirmation before they are applied.",
		promptSnippet: "List or resolve wiki review items",
		promptGuidelines: [
			"When the user asks to review the wiki, call wiki_review with action=list, read the referenced pages to gather evidence, then resolve each item.",
			"Resolve items with accept (claim confirmed), reject (claim wrong), supersede (newer knowledge exists), or defer (leave open).",
		],
		parameters: Type.Object({
			action: StringEnum(["list", "resolve"] as const),
			id: Type.Optional(Type.String({ description: "Review item id (for resolve)" })),
			resolution: Type.Optional(StringEnum(["accept", "reject", "supersede", "defer"] as const)),
			note: Type.Optional(Type.String({ description: "Reasoning or evidence for the resolution" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			if (params.action === "list") {
				const open = await listOpenReviews(layout, loaded.config.review.maxPerSession);
				if (open.length === 0) {
					return { content: [{ type: "text", text: "Review queue is empty." }], details: { items: [] } };
				}
				const lines = [`## Wiki review queue (${open.length} open)`, ""];
				for (const item of open) {
					lines.push(
						`- \`${item.id}\` · **${item.kind}** · criticality ${item.criticality.toFixed(2)}`,
						`  claim: ${item.claimText}`,
						item.page ? `  page: \`${item.page}\`${item.claimId ? ` (${item.claimId})` : ""}` : "  page: (not attached)",
						item.reason ? `  reason: ${item.reason}` : "",
					);
				}
				lines.push("", "Read the referenced pages, then resolve each with action=resolve, id=<id>, resolution=accept|reject|supersede|defer.");
				return { content: [{ type: "text", text: lines.filter(Boolean).join("\n") }], details: { items: open } };
			}

			if (!params.id || !params.resolution) throw new Error("wiki_review resolve needs `id` and `resolution`.");
			const all = await readReviews(layout);
			const item = all.find((candidate) => candidate.id === params.id);
			if (!item) throw new Error(`Review item not found: ${params.id}`);

			const critical = item.criticality >= loaded.config.review.escalateCriticality;
			if (critical && params.resolution !== "defer") {
				if (!ctx.hasUI) {
					await resolveReview(layout, item.id, "defer", "critical item requires user confirmation");
					return {
						content: [{ type: "text", text: `Item \`${item.id}\` is critical (${item.criticality.toFixed(2)}); deferred for user confirmation.` }],
						details: { deferred: true, item },
					};
				}
				const approved = await ctx.ui.confirm(
					"Critical wiki claim",
					`${item.claimText}\n\nResolve as "${params.resolution}"?`,
				);
				if (!approved) {
					await resolveReview(layout, item.id, "defer", "user declined at escalation");
					return { content: [{ type: "text", text: `User declined; item \`${item.id}\` deferred.` }], details: { deferred: true, item } };
				}
			}

			const applied = await applyReviewResolution(layout, item, params.resolution);
			await resolveReview(layout, item.id, params.resolution, params.note);
			await appendLedger(layout, {
				actor: "agent",
				op: "wiki.review",
				subject: item.id,
				action: params.resolution,
				reason: params.note ?? item.reason,
				outcome: applied,
				verdict: { kind: item.kind, criticality: item.criticality, escalated: critical },
			});
			return {
				content: [{ type: "text", text: `Resolved \`${item.id}\` as ${params.resolution}. ${applied}` }],
				details: { id: item.id, resolution: params.resolution, applied },
			};
		},
	});

	// Commands -----------------------------------------------------------------

	pi.registerCommand("wiki:status", {
		description: "Show project wiki status",
		handler: async (_args, ctx) => {
			const runtime = runtimeFor(ctx);
			const pages = existsSync(runtime.layout.wikiDir) ? (await listMarkdownFiles(runtime.layout.wikiDir)).length : 0;
			const entries = await readIndex(runtime.layout);
			ctx.ui.notify(`jev-wiki: ${pages} pages · ${entries.length} TOC entries · root ${runtime.layout.root}`, "info");
		},
	});

	pi.registerCommand("wiki:capture", {
		description: "Compose key insights from this session and capture them into the wiki",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			pi.sendUserMessage(
				"Capture this session's durable knowledge into the project wiki: compose a list of atomic key insights (decisions, invariants, architecture, gotchas, patterns) with evidence pointers to files/commits/tests, then call wiki_insights. Follow the llm-wiki skill to write or merge the recommended pages, then call wiki_finalize.",
			);
		},
	});

	pi.registerCommand("wiki:ingest", {
		description: "Ingest a document into the wiki (usage: /wiki:ingest <path>)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const path = args.trim();
			if (!path) {
				ctx.ui.notify("Usage: /wiki:ingest <path>", "warning");
				return;
			}
			pi.sendUserMessage(
				`Ingest \`${path}\` into the project wiki: call wiki_ingest with that path, then follow the llm-wiki skill to write or merge the recommended pages, then call wiki_finalize.`,
			);
		},
	});

	pi.registerCommand("wiki:sync", {
		description: "Re-verify the wiki against commits since the last sync",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			pi.sendUserMessage(
				"Sync the project wiki with the code: call wiki_sync, then use wiki_review to resolve any affected claims (read the referenced pages first).",
			);
		},
	});

	pi.registerCommand("wiki:review", {
		description: "Work the wiki review queue (disputes, needs-recheck, low-confidence claims)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			pi.sendUserMessage(
				"Review the project wiki: call wiki_review with action=list, read the referenced pages for evidence, then resolve each item with wiki_review action=resolve. Defer anything you cannot decide; critical items will be escalated to the user.",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const loaded = loadConfig(ctx.cwd);
		if (!loaded.apiKey) {
			ctx.ui.notify(`jev-wiki: no Jev token found (expected JEV_TOKEN in ${loaded.envFilePath})`, "warning");
		}
		try {
			if (loaded.config.sync.onSessionStart !== "check") return;
			const layout = resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot);
			if (!existsSync(layout.stateDir) || !(await isGitRepo(ctx.cwd))) return;
			const state = await readSyncState(layout);
			const head = await headCommit(ctx.cwd);
			if (state.lastSyncCommit && head && state.lastSyncCommit !== head) {
				ctx.ui.notify("jev-wiki: the wiki may be out of date with code changes — run /wiki:sync", "warning");
			}
		} catch {
			/* sync check is best-effort */
		}
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolvePagePath(layout: WikiLayout, cwd: string, page: string): Promise<string | undefined> {
	const candidates = [
		isAbsolute(page) ? page : resolve(cwd, page),
		resolve(layout.wikiDir, page),
		resolve(layout.root, page),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function extractMarkdownLinks(markdown: string): string[] {
	const links: string[] = [];
	for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
		links.push(match[1].trim());
	}
	return links;
}
