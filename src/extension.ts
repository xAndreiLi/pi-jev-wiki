/**
 * jev-wiki — a project mental-model wiki for pi, maintained with Jev decisions.
 *
 * P0 scope: architecture-first wiki layout + TOC, guided ingest (research channel),
 * agent insight capture (work channel), decision ledger, consultation tools.
 * Pages are written by the agent (guided mode); this extension stages, adjudicates,
 * places, and keeps the TOC/log current.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { loadConfig, type LoadedConfig, type JevWikiConfig, type WriterMode } from "./config.ts";
import { git, headCommit, isGitRepo } from "./git.ts";
import { appendLedger, readLedger, summarizeLedger } from "./ledger.ts";
import { lintWiki } from "./lint.ts";
import { readMetrics, recordMetric, summarizeMetrics } from "./metrics.ts";
import { renderDoctor, runDoctor } from "./doctor.ts";
import { withWikiLock } from "./wiki/lock.ts";
import { applyReinforcement, applySupersession, bestCandidatePage } from "./provenance.ts";
import { redact } from "./redact.ts";
import { appendSessionLog, promoteRecurring } from "./sessionlog.ts";
import { renderStructure, scanStructure } from "./structure.ts";
import { buildTriageReport, renderTriage } from "./triage.ts";
import { extractInsights, sessionTextFromEntries } from "./pipeline/capture.ts";
import {
	applyReviewResolution,
	enqueueReview,
	listOpenReviews,
	openReviewCount,
	readReviews,
	resolveReview,
} from "./review.ts";
import { readSyncState, syncWiki } from "./sync.ts";
import { createJevClient, noul, type JevClient } from "./jev.ts";
import { adjudicateClaim, chooseTarget, decideClaim, type CandidateClaim, type CandidatePage } from "./pipeline/adjudicate.ts";
import { resolveWriterMode, writeAcceptedPages, type WriterClaim } from "./pipeline/write.ts";
import { extractClaims, quoteIsPresent } from "./pipeline/extract.ts";
import {
	ensureLayout,
	listMarkdownFiles,
	readPage,
	removeFileIfExists,
	resolveLayout,
	sha256Hex,
	slugify,
	todayISO,
	writePage,
	writeRawSource,
	writeTextAtomic,
	type WikiLayout,
} from "./wiki/layout.ts";
import { extractMarkdownLinks } from "./wiki/links.ts";
import { appendLog, entryFromPage, isWikiMetaFile, parseIndex, readIndex, readRecentLog, renderCompactToc, renderIndex, topicSlug, updateIndex, upsertEntries, writeIndex, type TocEntry } from "./wiki/toc.ts";
import { createSearchEngine, VectorSearchEngine, type SearchResult } from "./wiki/search.ts";
import { forgetWikiIndex, hasWarmIndex, indexExists, indexWiki, vectorStatus } from "./vector/index.ts";
import { MODEL_PRESETS, resolvePreset } from "./vector/embed.ts";
import { modelChoiceSource, writeModelSetting } from "./vector/settings.ts";
import { vectorEnabled, vectorSearch } from "./vector/query.ts";
import { closeVectorDbs, vectorDbFor } from "./vector/db.ts";
import { buildCatalog, renderCatalog } from "./vector/catalog.ts";
import { judgeRetrieval } from "./vector/judgments.ts";
import { discoverWikis, maxScanDepth, scanRoots } from "./vector/discover.ts";
import { vectorDataDir } from "./vector/registry.ts";
import { enabledWikiNames, normalizeRoot, readRegistry, registerWiki, resolveWikiRoot, setWikiEnabled, setWikiRoot, unregisterWiki } from "./vector/registry.ts";

interface Runtime {
	loaded: LoadedConfig;
	layout: WikiLayout;
}

function runtimeFor(ctx: ExtensionContext): Runtime {
	const loaded = loadConfig(ctx.cwd);
	return { loaded, layout: resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot) };
}

async function requireClient(loaded: LoadedConfig, ctx: ExtensionContext): Promise<JevClient> {
	if (loaded.apiKey) return createJevClient(loaded.config, loaded.apiKey);
	if (loaded.config.provider === "openrouter") {
		const key = await ctx.modelRegistry.getApiKeyForProvider("openrouter").catch(() => undefined);
		if (key) return createJevClient(loaded.config, key);
	}
	throw new Error(
		[
			"No Jev API key configured.",
			`- TypeSafe: put TYPESAFE_API_KEY=... (or JEV_TOKEN=...) in ${loaded.envFilePath}`,
			`- OpenRouter: put OPENROUTER_API_KEY=... in ${loaded.envFilePath}, set provider to "openrouter", or sign in with /login openrouter`,
			"- Ask the agent to run wiki_setup action=guide provider=typesafe|openrouter for exact steps, then wiki_setup action=test",
		].join("\n"),
	);
}

/** Optional cross-project vault: resolved against the pi agent dir when relative. */
function globalLayoutFor(loaded: LoadedConfig): WikiLayout | undefined {
	if (!loaded.config.globalWikiRoot) return undefined;
	const root = isAbsolute(loaded.config.globalWikiRoot) ? loaded.config.globalWikiRoot : join(loaded.agentDir, loaded.config.globalWikiRoot);
	return resolveLayout(root, ".", loaded.config.stateRoot);
}

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[... truncated ...]`;
}

/** Build Jev-readable evidence for an insight: file excerpts, commit messages, quotes. */
async function buildInsightEvidence(
	insight: { text: string; evidence?: Array<{ kind: string; ref: string; quote?: string }> },
	cwd: string,
): Promise<{ evidenceText: string; files: string[] }> {
	const files: string[] = [];
	const parts: string[] = [];
	for (const item of insight.evidence ?? []) {
		if (item.kind === "file") {
			files.push(item.ref);
			const absolute = isAbsolute(item.ref) ? item.ref : resolve(cwd, item.ref);
			if (existsSync(absolute)) {
				const content = await readFile(absolute, "utf8");
				parts.push(`file: ${item.ref}\n${excerptAroundTerms(content, insight.text, 3500)}`);
			} else {
				parts.push(`file: ${item.ref} (not found)`);
			}
		} else if (item.kind === "commit") {
			const detail = await git(cwd, ["show", "--no-color", "--stat", "--format=%s%n%b", item.ref, "--"]);
			parts.push(`commit: ${item.ref}\n${truncate(detail.stdout || "(commit not found)", 2000)}`);
		} else if (item.kind === "user") {
			parts.push(`user statement: "${item.quote ?? item.ref}"`);
		} else if (item.kind === "source") {
			parts.push(`source: ${item.ref}${item.quote ? `\nquote: "${item.quote}"` : ""}`);
		} else {
			parts.push(`${item.kind}: ${item.ref}${item.quote ? `\nquote: "${item.quote}"` : ""}`);
		}
	}
	return { evidenceText: redact(parts.join("\n\n") || "(no evidence attached)").text, files };
}

/** Line excerpts around terms from the claim, so Jev sees the relevant code, not the whole file. */
function excerptAroundTerms(content: string, claimText: string, maxChars: number): string {
	const lines = content.split(/\r?\n/);
	const terms = [...new Set(claimText.toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 3))].slice(0, 12);
	if (terms.length === 0 || lines.length <= 60) return truncate(content, maxChars);
	const scored = lines
		.map((line, index) => ({ index, score: terms.reduce((sum, term) => sum + (line.toLowerCase().includes(term) ? 1 : 0), 0) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 10);
	if (scored.length === 0) return truncate(content, maxChars);
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
	return truncate(out.join("\n"), maxChars);
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
	const files = (await listMarkdownFiles(layout.wikiDir)).filter(
		(file) => !isWikiMetaFile(relative(layout.wikiDir, file).split("\\").join("/")),
	);
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
	topicIsNew?: boolean;
	target?: string;
	mergeInto?: string;
	newPage: boolean;
}

/** Best matching existing claim for a reinforcement, used when page placement abstains. */
function bestCandidateClaim(text: string, candidates: CandidateClaim[]): CandidateClaim | undefined {
	const tokens = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3));
	let best: { candidate: CandidateClaim; score: number } | undefined;
	for (const candidate of candidates) {
		const candidateTokens = new Set(candidate.text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3));
		if (tokens.size === 0 || candidateTokens.size === 0) continue;
		let shared = 0;
		for (const token of tokens) if (candidateTokens.has(token)) shared++;
		const score = shared / Math.min(tokens.size, candidateTokens.size);
		if (!best || score > best.score) best = { candidate, score };
	}
	return best && best.score >= 0.3 ? best.candidate : undefined;
}

/** Render TOC entries as compact, budget-capped lines. */
function renderTocLines(entries: TocEntry[], maxChars: number): string {
	const lines: string[] = [];
	let used = 0;
	for (const entry of entries) {
		const line = `- ${entry.type} · **${entry.title}** — ${entry.summary} \`${entry.path}\` (updated ${entry.updated})`;
		if (used + line.length > maxChars) {
			lines.push(`… ${entries.length - lines.length} more entries (narrow with topic/tag/query).`);
			break;
		}
		lines.push(line);
		used += line.length + 1;
	}
	return lines.join("\n");
}

/** Resolve a wiki by registered name, or auto-register the current wiki root. */
async function resolveTargetWiki(agentDir: string, currentRoot: string, name?: string): Promise<{ name: string; root: string }> {
	if (name) {
		const registry = await readRegistry(agentDir);
		const entry = registry.wikis.find((candidate) => candidate.name === name);
		if (!entry) throw new Error(`Wiki "${name}" is not registered. Run wiki_index action=status to list wikis.`);
		return { name: entry.name, root: entry.root };
	}
	const { registration } = await registerWiki(agentDir, currentRoot);
	return { name: registration.name, root: registration.root };
}

function renderBrief(title: string, reports: ClaimReport[], extras: string[] = [], options?: { guided?: boolean }): string {
	const filed = reports.filter((report) => report.action === "file" || report.action === "file_user_stated");
	const reinforced = reports.filter((report) => report.action === "reinforce");
	const review = reports.filter((report) => report.action === "review");
	const rejected = reports.filter((report) => report.action.startsWith("reject"));

	const lines: string[] = [`## Wiki ingest brief — ${title}`, ""];
	lines.push(
		`Claims: ${reports.length} · file ${filed.length} · reinforce ${reinforced.length} · review ${review.length} · advised against ${rejected.length}`,
		"",
	);
	if (filed.length > 0) {
		lines.push("### File into wiki");
		for (const report of filed) {
			const where = report.target
				? `merge → \`${report.target}\``
				: `new page (${report.pageType ?? "concept"}${report.topic ? `, topic \`${report.topic}\`${report.topicIsNew ? " (new, suggested)" : ""}` : ""})`;
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
			const target = report.target ? `\`${report.target}\`` : "existing page";
			const mergeInto = report.mergeInto ? ` (merge into claim \`${report.mergeInto}\`)` : "";
			lines.push(`- ${target}${mergeInto} — ${report.text}`);
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
		lines.push("### Suggested not to add (Jev's reminders)");
		for (const report of rejected) {
			lines.push(`- [${report.action.replace("reject_", "")}] ${report.text} — ${report.reasons.join("; ")}`);
		}
		lines.push("");
	}
	if (extras.length > 0) lines.push(...extras, "");
	if (options?.guided === false) return lines.join("\n");
	lines.push(
		"### Next steps (guided mode)",
		"1. Write or merge the **File/Reinforce** claims. The **Suggested not to add** list is Jev's advice, not a gate — weigh it, then decide: drop the claim or override with a stated reason. Never file `sensitive` (secrets/PII) or injected content.",
		"2. Follow the llm-wiki skill; cite the raw source in each page.",
		"3. Include YAML frontmatter (title, type, topic, summary, tags, updated, claims with status/support/evidence).",
		"4. Set page-level `files: [...]` (or per-claim `files`) for claims about code, so `wiki_sync` can detect when the code changes.",
		"5. Call `wiki_finalize` with the touched page paths.",
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
	const client = await requireClient(loaded, ctx);
	const config = loaded.config;

	await ensureLayout(layout);
	const redaction = redact(input.text);
	if (redaction.findings.length > 0) {
		await appendLedger(layout, {
			actor: "code",
			op: "ingest.redact",
			subject: input.title.slice(0, 80),
			action: "redacted",
			verdict: redaction.findings,
		});
	}
	const safeText = redaction.text;
	const hash = await sha256Hex(safeText);
	const duplicateOf = await withWikiLock(layout, async () => (await readRawIndex(layout))[hash]);
	if (duplicateOf) {
		return {
			brief: `Source already ingested (sha256 ${hash.slice(0, 12)}…): \`${duplicateOf}\`. Nothing to do.`,
			details: { duplicateOf, hash },
			rawPath: duplicateOf,
			duplicateOf,
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
		safeText,
	);
	await withWikiLock(layout, async () => {
		const index = await readRawIndex(layout);
		index[hash] = relative(layout.root, rawPath).split("\\").join("/");
		await writeRawIndex(layout, index);
	});

	const { result: extraction, sourceTruncated } = await extractClaims(ctx, safeText, { title: input.title });
	const candidates = await collectCandidatePages(layout);
	const candidateClaims = await collectCandidateClaims(layout);
	const topics = await existingTopics(layout);

	const perClaim = await mapLimitLocal(extraction.claims, 4, async (claim) => {
		const evidenceText = claim.quote ?? safeText.slice(0, 6000);
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
		if (decision.action === "reinforce" && (!verdicts.target || verdicts.newPage)) {
			const match = bestCandidateClaim(claim.text, candidateClaims);
			if (match?.page) {
				verdicts.target = match.page;
				verdicts.newPage = false;
				if (match.id) verdicts.mergeInto = match.id;
			}
		}
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
		topicIsNew: verdicts.topicIsNew,
		target: verdicts.target,
		mergeInto: verdicts.mergeInto,
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
// Insight processing (shared by the tool and auto-capture hooks)
// ---------------------------------------------------------------------------

interface ProcessInsightsOptions {
	source: "tool" | "compact" | "settled";
	mode?: WriterMode;
}

interface ProcessInsightsResult {
	brief: string;
	details: Record<string, unknown>;
	accepted: number;
	rawPath: string;
}

async function processInsights(
	runtime: Runtime,
	ctx: ExtensionContext,
	client: JevClient,
	insights: Array<{ text: string; kind?: string; evidence?: Array<{ kind: string; ref: string; quote?: string }>; confidence?: number }>,
	options: ProcessInsightsOptions,
): Promise<ProcessInsightsResult> {
	const { loaded, layout } = runtime;
	const config = loaded.config;
	const candidates = await collectCandidatePages(layout);
	const candidateClaims = await collectCandidateClaims(layout);
	const topics = await existingTopics(layout);
	const stamp = new Date();
	const slug = `session-${todayISO(stamp)}-${String(stamp.getHours()).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}`;

	const perInsight = await mapLimitLocal(insights, 4, async (insight) => {
		const { evidenceText, files } = await buildInsightEvidence(insight, ctx.cwd);
		const evidenceLines = evidenceText.split("\n\n").slice(0, 8);
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
		if (decision.action === "reinforce" && (!verdicts.target || verdicts.newPage)) {
			const match = bestCandidateClaim(insight.text, candidateClaims);
			if (match?.page) {
				verdicts.target = match.page;
				verdicts.newPage = false;
				if (match.id) verdicts.mergeInto = match.id;
			}
		}
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

		let reinforcement: Awaited<ReturnType<typeof applyReinforcement>>;
		if ((decision.action === "file" || decision.action === "reinforce") && verdicts.target) {
			reinforcement = await applyReinforcement(layout, verdicts.target, insight.text, { evidence: files });
			if (reinforcement) {
				decision.reasons.push(
					`corroborated ${verdicts.target}${reinforcement.claimId ? `#${reinforcement.claimId}` : ""} (${reinforcement.corroborations}×)`,
				);
			}
		}
		let supersession: Awaited<ReturnType<typeof applySupersession>>;
		if (verdicts.relation === "supersedes") {
			const supersededPage = bestCandidatePage(candidateClaims, insight.text);
			if (supersededPage) supersession = await applySupersession(layout, supersededPage, insight.text);
		}

		await appendLedger(layout, {
			actor: "agent",
			op: "insight.proposed",
			subject: insight.text.slice(0, 120),
			evidence: evidenceLines,
			action: "submitted",
			source: options.source,
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
			verdict: {
				score: decision.score,
				target: verdicts.target ?? null,
				newPage: verdicts.newPage,
				trustTier: verdicts.trustTier ?? null,
				reinforcement: reinforcement ? { page: reinforcement.page, claimId: reinforcement.claimId, corroborations: reinforcement.corroborations } : null,
				supersession: supersession ? { page: supersession.page, claimId: supersession.claimId } : null,
			},
		});
		await appendSessionLog(layout, {
			text: insight.text,
			kind: insight.kind,
			source: options.source,
			action: decision.action,
			reason: decision.reasons.join("; "),
			grounded: verdicts.grounded,
			derivable: verdicts.derivable,
			importance: verdicts.importanceNorm,
		});
		return { insight, verdicts, decision, files, reinforcement, supersession };
	});

	const promoted = await promoteRecurring(layout);
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
		topicIsNew: verdicts.topicIsNew,
		target: verdicts.target,
		mergeInto: verdicts.mergeInto,
		newPage: verdicts.newPage,
	}));
	const reinforcements = perInsight
		.filter((entry) => entry.reinforcement)
		.map(
			(entry) =>
				`${entry.reinforcement!.page}${entry.reinforcement!.claimId ? `#${entry.reinforcement!.claimId}` : ""} (${entry.reinforcement!.corroborations}×)`,
		);

	const rawBody = perInsight
		.map(({ insight, verdicts, decision, reinforcement, supersession }) => {
			const evidence = (insight.evidence ?? []).map((item) => `- ${item.kind}: ${item.ref}${item.quote ? ` — "${item.quote}"` : ""}`).join("\n");
			return [
				`### ${insight.text}`,
				insight.kind ? `Kind: ${insight.kind}` : "",
				evidence ? `Evidence:\n${evidence}` : "",
				`Verdict: ${decision.action} (grounded ${verdicts.grounded.toFixed(2)}, derivable ${verdicts.derivable.toFixed(2)}, importance ${verdicts.importanceNorm.toFixed(2)}, criticality ${verdicts.criticalityNorm.toFixed(2)})`,
				verdicts.target ? `Target: ${verdicts.target}` : "",
				reinforcement ? `Reinforced: ${reinforcement.page}${reinforcement.claimId ? `#${reinforcement.claimId}` : ""} (${reinforcement.corroborations}×)` : "",
				supersession ? `Superseded: ${supersession.page}${supersession.claimId ? `#${supersession.claimId}` : ""}` : "",
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
			title: `Session capture ${todayISO(stamp)} (${options.source})`,
			type: "raw-source",
			source: "session",
			collected: todayISO(stamp),
			sha256: await sha256Hex(redact(rawBody).text),
		},
		redact(rawBody).text,
	);
	const rawPathRel = relative(layout.root, rawPath).split("\\").join("/");

	const writerClaims: WriterClaim[] = reports
		.filter((report) => report.action === "file" || report.action === "file_user_stated")
		.map((report) => {
			const entry = perInsight.find((candidate) => candidate.insight.text === report.text);
			return {
				text: report.text,
				kind: entry?.insight.kind,
				pageType: report.pageType,
				topic: report.topic,
				target: report.target,
				trustTier: report.trustTier,
				files: report.files,
				evidence: [rawPathRel, ...(entry?.insight.evidence ?? []).map((item) => item.ref)],
				grounded: report.grounded,
				criticality: report.criticalityNorm,
			};
		});
	const writeResult = await writeAcceptedPages(
		ctx,
		layout,
		config,
		{
			title: `Session capture ${todayISO(stamp)}`,
			topic: topics[0] ?? "general",
			sourcePath: rawPathRel,
			claims: writerClaims,
		},
		options.mode ?? config.writer.mode,
	);
	for (const item of writeResult.flagged) {
		await enqueueReview(layout, {
			kind: "claim_review",
			claimText: `Auto-written page ${item.page} contains literals not present in evidence: ${item.missing.join(", ")}`,
			page: item.page,
			criticality: 0.6,
			reason: "writer grounding check failed",
			verdicts: { missing: item.missing },
		});
	}

	await appendLog(layout, "capture", `${reports.length} insights (${options.source})`, [
		`Raw: ${rawPathRel}`,
		`Filed ${reports.filter((r) => r.action === "file" || r.action === "file_user_stated").length} · reinforced ${reports.filter((r) => r.action === "reinforce").length} · review ${reports.filter((r) => r.action === "review").length} · rejected ${reports.filter((r) => r.action.startsWith("reject")).length}`,
		...((promoted ?? 0) > 0 ? [`Promoted ${promoted} recurring candidate(s) to review`] : []),
		...(writeResult.written.length > 0 ? [`Auto-written: ${writeResult.written.join(", ")}`] : []),
		...(writeResult.drafted.length > 0 ? [`Drafts: ${writeResult.drafted.join(", ")}`] : []),
	]);

	const brief = renderBrief(
		`session ${todayISO(stamp)}`,
		reports,
		[
			`Raw session record: \`${rawPathRel}\``,
			...(reinforcements.length > 0 ? [`Reinforced: ${reinforcements.join(", ")}`] : []),
			...(writeResult.written.length > 0 ? [`Written automatically (${writeResult.mode}): ${writeResult.written.join(", ")}`] : []),
			...(writeResult.drafted.length > 0 ? [`Drafts written (${writeResult.mode}): ${writeResult.drafted.join(", ")}`] : []),
		],
		{ guided: writeResult.mode === "guided" },
	);
	const accepted = reports.filter((report) => ["file", "file_user_stated", "reinforce"].includes(report.action)).length;
	return {
		brief,
		details: {
			rawPath,
			insights: reports,
			reinforcements,
			supersessions: perInsight.filter((entry) => entry.supersession).map((entry) => entry.supersession),
			promoted,
			source: options.source,
			accepted,
			writer: writeResult,
			usage: client.totals,
		},
		accepted,
		rawPath,
	};
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
			const metrics = summarizeMetrics(await readMetrics(layout));
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
				`- Consultations: ${metrics.consultations} (${metrics.searches} searches, ${metrics.pagesReturned.size} pages surfaced)`,
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
		description:
			"Read a wiki table of contents: the local wiki (filterable by topic/tag/query), another registered wiki by name, or the cross-wiki catalog with index health (scope=all).",
		promptSnippet: "Read the wiki table of contents or the cross-wiki catalog",
		promptGuidelines: [
			"Use wiki_toc before architectural or unfamiliar changes, when planning work, or when a project term is unclear.",
			"Use wiki_toc scope=all to list every registered wiki with page counts, topics, and index health; use wiki: <name> to read another wiki's entries.",
		],
		parameters: Type.Object({
			topic: Type.Optional(Type.String({ description: "Filter to one topic directory" })),
			tag: Type.Optional(Type.String({ description: "Filter to entries carrying this tag" })),
			query: Type.Optional(Type.String({ description: "Substring match on title or summary" })),
			wiki: Type.Optional(Type.String({ description: "Read another registered wiki's TOC by name" })),
			scope: Type.Optional(StringEnum(["local", "all"] as const, { description: "local (default) or all: the cross-wiki catalog" })),
			limit: Type.Optional(Type.Number({ description: "scope=all: max wikis to list (default 25)" })),
			offset: Type.Optional(Type.Number({ description: "scope=all: skip this many wikis (paging)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			if (params.scope === "all") {
				const registry = await readRegistry(loaded.agentDir);
				const states = new Map<string, { chunks: number; model: string; updatedAt: string }>();
				try {
					const db = vectorDbFor(vectorDataDir(loaded.agentDir));
					await db.init();
					for (const entry of registry.wikis) {
						const state = await db.state(entry.name);
						if (state) states.set(entry.name, { chunks: state.chunks, model: state.model, updatedAt: state.updatedAt });
					}
				} catch {
					// The catalog still reports TOC metadata when the index is unavailable.
				}
				const result = await buildCatalog({
					registry: registry.wikis,
					states,
					stateRoot: loaded.config.stateRoot,
					model: loaded.config.search.vector.model,
					...(params.limit !== undefined ? { limit: params.limit } : {}),
					...(params.offset !== undefined ? { offset: params.offset } : {}),
				});
				await recordMetric(layout, { op: "catalog", detail: { total: result.total, limit: result.limit, offset: result.offset } });
				return { content: [{ type: "text", text: renderCatalog(result, loaded.config.search.vector.model) }], details: result };
			}
			if (params.wiki) {
				const registry = await readRegistry(loaded.agentDir);
				const entry = registry.wikis.find((item) => item.name === params.wiki);
				if (!entry) throw new Error(`Wiki "${params.wiki}" is not registered — run wiki_toc scope=all to list wikis.`);
				const target = resolveLayout(entry.root, ".", loaded.config.stateRoot);
				const targetEntries = await readIndex(target);
				let filteredTarget = targetEntries;
				if (params.topic) filteredTarget = filteredTarget.filter((item) => item.path.startsWith(`${params.topic}/`));
				if (params.tag) filteredTarget = filteredTarget.filter((item) => item.tags.includes(params.tag!));
				if (params.query) {
					const needle = params.query.toLowerCase();
					filteredTarget = filteredTarget.filter(
						(item) => item.title.toLowerCase().includes(needle) || item.summary.toLowerCase().includes(needle),
					);
				}
				if (filteredTarget.length === 0) {
					return {
						content: [{ type: "text", text: `Wiki \`${entry.name}\` has no matching TOC entries (${targetEntries.length} total).` }],
						details: { wiki: entry.name, entries: targetEntries.length, filtered: 0 },
					};
				}
				const body = renderTocLines(filteredTarget, loaded.config.toc.maxTokens * 4);
				return {
					content: [{ type: "text", text: [`# ${entry.name} — ${entry.root}`, "", body].join("\n") }],
					details: { wiki: entry.name, root: entry.root, entries: targetEntries.length, filtered: filteredTarget.length },
				};
			}
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
			await recordMetric(layout, {
				op: "toc",
				detail: { topic: params.topic, tag: params.tag, query: params.query, filtered: filtered.length },
			});
			if (params.topic && !params.tag && !params.query) {
				const topicPath = join(layout.wikiDir, "toc", `${topicSlug(params.topic)}.md`);
				if (existsSync(topicPath)) {
					return {
						content: [{ type: "text", text: truncate(await readFile(topicPath, "utf8"), maxChars) }],
						details: { entries: entries.length, filtered: filtered.length, topic: params.topic },
					};
				}
			}
			const compact = filtered.length > 60 && !params.tag && !params.query;
			const body = compact ? renderCompactToc(filtered) : renderIndex(filtered);
			return {
				content: [{ type: "text", text: truncate(body, maxChars) }],
				details: { entries: entries.length, filtered: filtered.length, compact },
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
			scope: Type.Optional(StringEnum(["local", "all"] as const, { description: "Semantic scope: current wiki (default) or all registered wikis" })),
			wikis: Type.Optional(Type.Array(Type.String({ description: "Explicit registered wiki names to search (semantic mode)" }))),
			search: Type.Optional(StringEnum(["auto", "keyword", "semantic", "hybrid"] as const, { description: "Retrieval mode; defaults to the configured search.engine" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			const limit = Math.max(1, Math.min(params.limit ?? 5, 10));
			const notes: string[] = [];
			const registry = await readRegistry(loaded.agentDir);
			const globalLayout = globalLayoutFor(loaded);
			const currentRoot = normalizeRoot(layout.root);
			let currentWiki = registry.wikis.find((entry) => normalizeRoot(entry.root) === currentRoot)?.name;
			const globalWiki = globalLayout
				? registry.wikis.find((entry) => normalizeRoot(entry.root) === normalizeRoot(globalLayout.root))?.name
				: undefined;
			let scopeWikis: string[] | undefined;
			let vectorEngine: VectorSearchEngine | undefined;
			if (vectorEnabled(loaded.config) && params.search !== "keyword") {
				try {
					const { registration } = await registerWiki(loaded.agentDir, layout.root);
					currentWiki = registration.name;
					const currentRegistry = await readRegistry(loaded.agentDir);
					const wikis = params.wikis && params.wikis.length > 0
						? params.wikis
						: params.scope === "all"
							? enabledWikiNames(currentRegistry)
							: [registration.name];
					scopeWikis = wikis;
					vectorEngine = new VectorSearchEngine((query, count) =>
						vectorSearch(loaded.agentDir, loaded.config, query, { limit: count, wikis }),
					);
				} catch (error) {
					notes.push(`Semantic search unavailable: ${(error as Error).message}`);
				}
			}
			const mode = params.search;
			const engineName = mode === "keyword" ? "index" : mode === "semantic" ? "vector" : mode === "hybrid" ? "hybrid" : loaded.config.search.engine;
			const names = { wiki: currentWiki, globalWiki };
			const engine = createSearchEngine(
				{ ...loaded.config, search: { ...loaded.config.search, engine: engineName } },
				layout,
				globalLayout,
				vectorEngine,
				names,
			);
			let results: SearchResult[];
			try {
				results = await engine.search({ query: params.query, limit });
			} catch (error) {
				notes.push(`Semantic search failed (${(error as Error).message}); used keyword search instead.`);
				const fallback = createSearchEngine(
					{ ...loaded.config, search: { ...loaded.config.search, engine: "index" } },
					layout,
					globalLayout,
					undefined,
					names,
				);
				results = await fallback.search({ query: params.query, limit });
			}
			if (mode === "semantic" && !vectorEngine) {
				notes.push("Semantic mode requested but no vector engine is available; results are keyword-based. Run wiki_index status.");
			}
			if (results.length === 0) {
				const hints = [...notes];
				if (vectorEnabled(loaded.config) && scopeWikis && scopeWikis.length > 0) {
					try {
						const counts = await vectorDbFor(vectorDataDir(loaded.agentDir)).counts();
						const empty = scopeWikis.filter((name) => !counts.some((entry) => entry.wiki === name && entry.chunks > 0));
						if (empty.length > 0) {
							hints.push(`No indexed content yet for: ${empty.join(", ")} — ingest pages, then run wiki_index action=rebuild wiki=<name>.`);
						}
					} catch {
						// Index unavailable; the empty result stands on its own.
					}
				}
				return {
					content: [{ type: "text", text: [`No wiki pages match (engine: ${engine.name}). The wiki may not cover this yet.`, ...hints].join("\n") }],
					details: { matches: 0, engine: engine.name, ...(scopeWikis ? { wikis: scopeWikis } : {}) },
				};
			}
			const jevConfig = loaded.config.search.jev;
			const wantsRerank = jevConfig.rerank === "always" || (jevConfig.rerank === "auto" && engine.name.includes("vector"));
			if (jevConfig.sufficiency || wantsRerank) {
				try {
					const client = await requireClient(loaded, ctx);
					const judgment = await judgeRetrieval({
						client,
						query: params.query,
						results,
						maxCandidates: jevConfig.maxCandidates,
						minSufficiency: jevConfig.minSufficiency,
						signal: ctx.signal,
					});
					if (wantsRerank) results = judgment.results;
					notes.push(...judgment.notes);
					await appendLedger(layout, {
						actor: "jev",
						op: "ask.judge",
						subject: params.query.slice(0, 120),
						action: wantsRerank ? "reranked" : "scored",
						verdict: { sufficiency: judgment.sufficiency ?? null, candidates: judgment.candidateScores },
						usage: judgment.usage,
					});
				} catch (error) {
					notes.push(`Jev retrieval judgment skipped: ${(error as Error).message}`);
				}
			}
			const text = results
				.map((result) => {
					const scope = result.source === "global" ? " [global vault]" : result.wiki ? ` [${result.wiki}]` : "";
					const anchor = result.anchor ? `#${result.anchor}` : "";
					const meta = [result.kind, result.status].filter(Boolean).join(" · ");
					return [`### ${result.path}${anchor}${scope} (score ${result.score.toFixed(3)}${meta ? ` · ${meta}` : ""})`, result.excerpt].join("\n");
				})
				.join("\n\n");
			const pages = results.map((result) => (result.wiki ? `${result.wiki}/${result.path}` : result.path));
			await recordMetric(layout, { op: "ask", query: params.query, pages, detail: { engine: engine.name } });
			const output = notes.length > 0 ? `${text}\n\nNotes: ${notes.join(" ")}` : text;
			return { content: [{ type: "text", text: output }], details: { matches: results.length, pages, engine: engine.name } };
		},
	});

	pi.registerTool({
		name: "wiki_ingest",
		label: "Ingest into Wiki",
		description:
			"Ingest a document into the project wiki: stores the immutable raw source, extracts claims, has Jev verify groundedness/derivability/durability and choose placement, and returns a brief. Write or merge only the accepted claims (guided mode), then finalize with wiki_finalize.",
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
			mode: Type.Optional(StringEnum(["guided", "draft", "auto"] as const, { description: "Writer mode override; critical claims downgrade automatically" })),
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
			if (text.length > 2_000_000) throw new Error("Source is larger than the 2MB ingest cap; split it or trim it first.");
			title = title ?? "Untitled source";
			const topic = params.topic ?? slugify(title.split(/\s+/).slice(0, 3).join("-"), 30);
			onUpdate?.({ content: [{ type: "text", text: `Staging "${title}"…` }], details: {} });
			const result = await ingestSource(runtime, ctx, { text, title, topic, source: params.source });
			const requestedMode = params.mode ?? runtime.loaded.config.writer.mode;
			let brief = result.brief;
			if (requestedMode !== "guided") {
				const reports = (result.details.claims ?? []) as ClaimReport[];
				const rawPathRel = relative(runtime.layout.root, result.rawPath).split("\\").join("/");
				const writerClaims: WriterClaim[] = reports
					.filter((report) => report.action === "file" || report.action === "file_user_stated")
					.map((report) => ({
						text: report.text,
						pageType: report.pageType,
						topic: report.topic ?? topic,
						target: report.target,
						trustTier: report.trustTier,
						files: report.files,
						evidence: [rawPathRel],
						grounded: report.grounded,
						criticality: report.criticalityNorm,
					}));
				const writeResult = await writeAcceptedPages(
					ctx,
					runtime.layout,
					runtime.loaded.config,
					{ title, topic, sourcePath: rawPathRel, claims: writerClaims },
					requestedMode,
				);
				for (const item of writeResult.flagged) {
					await enqueueReview(runtime.layout, {
						kind: "claim_review",
						claimText: `Auto-written page ${item.page} contains literals not present in evidence: ${item.missing.join(", ")}`,
						page: item.page,
						criticality: 0.6,
						reason: "writer grounding check failed",
						verdicts: { missing: item.missing },
					});
				}
				if (writeResult.written.length > 0) brief += `\n\nWritten automatically (${writeResult.mode}): ${writeResult.written.join(", ")}`;
				if (writeResult.drafted.length > 0) brief += `\n\nDrafts written (${writeResult.mode}): ${writeResult.drafted.join(", ")}`;
				(result.details as Record<string, unknown>).writer = writeResult;
			}
			return { content: [{ type: "text", text: brief }], details: result.details };
		},
	});

	pi.registerTool({
		name: "wiki_insights",
		label: "Capture Agent Insights",
		description:
			"Submit a list of key insights from the current work session. Jev filters them (derivable/durable/sensitive), relates them to existing knowledge, and chooses placement into existing pages or new ones. Returns a brief; write or merge only the accepted claims, then call wiki_finalize.",
		promptSnippet: "Capture durable project insights from this session into the wiki",
		promptGuidelines: [
			"Use wiki_insights at the end of substantive work to capture durable, non-derivable knowledge (decisions, invariants, architecture, gotchas) with evidence pointers.",
			"Before submitting, apply the pre-submission checklist in the llm-wiki skill (How claims are judged): the evidence must state the claim; attach the introducing commit for decisions and the user's own words for policy.",
			"Do not capture transient task state, code snippets, or anything derivable by reading the repo.",
			"After wiki_insights, write or merge the accepted pages, then call wiki_finalize. Jev's rejections are reminders: weigh them, override with a stated reason when you disagree, or use wiki_triage to diagnose and fix the claim.",
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
			mode: Type.Optional(StringEnum(["guided", "draft", "auto"] as const, { description: "Writer mode override; critical claims downgrade automatically" })),
		}),
		async execute(_id, params, _signal, onUpdate, ctx) {
			const runtime = runtimeFor(ctx);
			const { loaded, layout } = runtime;
			const client = await requireClient(loaded, ctx);
			await ensureLayout(layout);
			if (params.insights.length === 0) {
				return { content: [{ type: "text", text: "No insights submitted." }], details: { count: 0 } };
			}

			onUpdate?.({ content: [{ type: "text", text: `Adjudicating ${params.insights.length} insights…` }], details: {} });
			const result = await processInsights(runtime, ctx, client, params.insights, { source: "tool", mode: params.mode });
			return { content: [{ type: "text", text: result.brief }], details: result.details };
		},
	});

	pi.registerTool({
		name: "wiki_finalize",
		label: "Finalize Wiki Pages",
		description: "Update the wiki table of contents and log for pages you wrote or edited, and report broken internal links.",
		promptSnippet: "Update wiki TOC/log after writing pages and check links",
		promptGuidelines: [
			"Call wiki_finalize with every page you created or edited in the wiki, before ending the turn.",
			"If you filed a claim against Jev's advice, record it with `overrides` (claim text, reason, advised action).",
		],
		parameters: Type.Object({
			pages: Type.Array(Type.String({ description: "Page paths (relative to the project or the wiki root)" })),
			note: Type.Optional(Type.String({ description: "Short note for the log" })),
			overrides: Type.Optional(
				Type.Array(
					Type.Object({
						text: Type.String({ description: "Claim text you filed against Jev's advice" }),
						reason: Type.String({ description: "Why you overrode the advice" }),
						advised: Type.Optional(Type.String({ description: "Jev's advised action (e.g. reject_derivable)" })),
					}),
				),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			const updates: TocEntry[] = [];
			const broken: string[] = [];
			for (const page of params.pages) {
				const absolute = await resolvePagePath(layout, ctx.cwd, page);
				if (!absolute) {
					broken.push(`${page} (missing)`);
					continue;
				}
				const rel = relative(layout.wikiDir, absolute).split("\\").join("/");
				if (rel.startsWith("..")) {
					broken.push(`${page} (outside the wiki)`);
					continue;
				}
				const parsed = await readPage(absolute);
				updates.push(entryFromPage(rel, parsed.data));
				for (const link of extractMarkdownLinks(parsed.body)) {
					if (/^[a-z]+:/i.test(link) || link.startsWith("#")) continue;
					const target = resolve(dirname(absolute), link.split("#")[0]);
					if (!existsSync(target)) broken.push(`${rel} → ${link}`);
				}
			}
			await updateIndex(layout, (current) => upsertEntries(current, updates));
			await appendLog(layout, "finalize", params.note ?? `${updates.length} page(s)`, updates.map((entry) => `Updated: ${entry.path}`));
			await removeFileIfExists(join(layout.stateDir, "pending-capture.md"));
			await appendLedger(layout, {
				actor: "agent",
				op: "wiki.finalize",
				action: "updated",
				subject: updates.map((entry) => entry.path).join(", ").slice(0, 200),
				outcome: broken.length ? `broken links: ${broken.length}` : "ok",
			});
			const overrides = params.overrides ?? [];
			for (const override of overrides) {
				await appendLedger(layout, {
					actor: "agent",
					op: "wiki.override",
					action: "override",
					subject: override.text.slice(0, 120),
					reason: override.reason,
					verdict: { advised: override.advised ?? null },
					outcome: "filed against Jev's advice",
				});
			}
			const lines = [
				`Updated TOC for ${updates.length} page(s): ${updates.map((entry) => `\`${entry.path}\``).join(", ") || "(none)"}`,
				broken.length ? `Broken links:\n${broken.map((item) => `- ${item}`).join("\n")}` : "No broken links found.",
			];
			let reindexNote: string | undefined;
			const vector = loaded.config.search.vector;
			if (vector.enabled && vector.sync.onFinalize && updates.length > 0) {
				try {
					const { registration } = await registerWiki(loaded.agentDir, layout.root);
					if (await hasWarmIndex(loaded.agentDir, registration.name, vector.model)) {
						const report = await indexWiki({
							agentDir: loaded.agentDir,
							wiki: registration.name,
							root: layout.root,
							model: vector.model,
							...(vector.dimensions ? { dimensions: vector.dimensions } : {}),
							paths: updates.map((entry) => entry.path),
						});
						reindexNote = `Reindexed ${report.embedded} chunk(s), ${report.skipped} unchanged (${report.total} total).`;
					} else {
						const downloadMb = Math.round(resolvePreset(vector.model).expectedBytes / 1_000_000);
						reindexNote = `Semantic index for \`${registration.name}\` is not built yet — run wiki_index action=rebuild (one-time ~${downloadMb} MB model download).`;
					}
				} catch (error) {
					reindexNote = `Semantic reindex skipped: ${(error as Error).message}`;
				}
			}
			if (overrides.length > 0) lines.push(`Recorded ${overrides.length} override(s) against Jev's advice.`);
			if (reindexNote) lines.push(reindexNote);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { updated: updates.map((entry) => entry.path), broken, overrides: overrides.map((override) => override.text.slice(0, 120)) },
			};
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
			const client = await requireClient(loaded, ctx);
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
			ids: Type.Optional(Type.Array(Type.String({ description: "Review item ids to resolve in one call (bulk resolve)" }))),
			resolution: Type.Optional(StringEnum(["accept", "reject", "supersede", "defer"] as const)),
			note: Type.Optional(Type.String({ description: "Reasoning or evidence for the resolution (applies to every resolved id)" })),
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

			const ids = params.ids && params.ids.length > 0 ? params.ids : params.id ? [params.id] : [];
			if (ids.length === 0 || !params.resolution) throw new Error("wiki_review resolve needs `id`/`ids` and `resolution`.");
			const all = await readReviews(layout);
			const results: Array<{ id: string; resolution: string; applied?: string; deferred?: boolean; error?: string }> = [];
			for (const id of ids) {
				const item = all.find((candidate) => candidate.id === id);
				if (!item) {
					results.push({ id, resolution: params.resolution, error: "review item not found" });
					continue;
				}
				const critical = item.criticality >= loaded.config.review.escalateCriticality;
				if (critical && params.resolution !== "defer") {
					if (!ctx.hasUI) {
						await resolveReview(layout, item.id, "defer", "critical item requires user confirmation");
						results.push({ id, resolution: "defer", deferred: true });
						continue;
					}
					const approved = await ctx.ui.confirm(
						"Critical wiki claim",
						`${item.claimText}\n\nResolve as "${params.resolution}"?`,
					);
					if (!approved) {
						await resolveReview(layout, item.id, "defer", "user declined at escalation");
						results.push({ id, resolution: "defer", deferred: true });
						continue;
					}
				}

				const applied = await applyReviewResolution(layout, item, params.resolution);
				await resolveReview(layout, item.id, params.resolution, params.note);
				if (params.resolution === "accept") {
					await appendLedger(layout, {
						actor: "code",
						op: "wiki.review.accept",
						action: "file",
						subject: item.claimText.slice(0, 120),
						reason: params.note ?? `reviewed as ${item.kind}`,
						verdict: { reviewId: item.id, page: item.page ?? null, criticality: item.criticality },
					});
				}
				await appendLedger(layout, {
					actor: "agent",
					op: "wiki.review",
					subject: item.id,
					action: params.resolution,
					reason: params.note ?? item.reason,
					outcome: applied,
					verdict: { kind: item.kind, criticality: item.criticality, escalated: critical },
				});
				results.push({ id, resolution: params.resolution, applied });
			}
			const lines = results.map((entry) =>
				entry.error
					? `- \`${entry.id}\` — error: ${entry.error}`
					: entry.deferred
						? `- \`${entry.id}\` — deferred (critical; needs user confirmation)`
						: `- \`${entry.id}\` — resolved as ${entry.resolution}. ${entry.applied ?? ""}`,
			);
			return { content: [{ type: "text", text: lines.join("\n") }], details: { resolved: results } };
		},
	});

	pi.registerTool({
		name: "wiki_lint",
		label: "Lint the Wiki",
		description:
			"Health-check the wiki: TOC reconciliation, broken links, orphans, raw backlog, claims with no accepted ledger entry, and Jev contradiction checks on code-selected claim pairs. Safe issues are auto-fixed; judgment issues are reported and queued.",
		promptSnippet: "Health-check the wiki and auto-fix safe issues",
		promptGuidelines: [
			"Run wiki_lint periodically or when the user asks about wiki health; then work reported judgment issues with wiki_review.",
		],
		parameters: Type.Object({
			autoFix: Type.Optional(Type.Boolean({ description: "Apply safe fixes (TOC entries, dispute marking); default true" })),
			contradictions: Type.Optional(Type.Boolean({ description: "Run Jev contradiction checks; default true" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			const client = await requireClient(loaded, ctx);
			onUpdate?.({ content: [{ type: "text", text: "Linting the wiki…" }], details: {} });
			const report = await lintWiki(layout, client, loaded.config, {
				autoFix: params.autoFix,
				checkContradictions: params.contradictions,
				signal: ctx.signal,
			});
			const contradicting = report.contradictions.filter((entry) => entry.relation === "contradicts").length;
			const lines = [
				`## Wiki lint — ${report.pages} page(s)`,
				"",
				`- TOC: ${report.toc.added.length} added · ${report.toc.updatedFixed.length} refreshed · ${report.toc.missingFiles.length} entries point to missing files`,
				`- Broken links: ${report.brokenLinks.length}`,
				`- Orphans: ${report.orphans.length}${report.orphans.length ? ` (${report.orphans.slice(0, 5).join(", ")}${report.orphans.length > 5 ? "…" : ""})` : ""}`,
				`- Raw backlog: ${report.rawBacklog.length}`,
				`- Unbacked claims (not in the accepted ledger): ${report.unbackedClaims.length}`,
				`- Contradictions: ${contradicting} of ${report.contradictions.length} checked pairs`,
			];
			if (report.unbackedClaims.length > 0) {
				lines.push(
					"",
					"### Unbacked claims",
					...report.unbackedClaims.slice(0, 10).map((claim) => `- \`${claim.page}\`${claim.claimId ? `#${claim.claimId}` : ""}: ${claim.text.slice(0, 100)}`),
				);
			}
			if (report.brokenLinks.length > 0) {
				lines.push("", "### Broken links", ...report.brokenLinks.slice(0, 10).map((link) => `- ${link}`));
			}
			if (report.fixed.length > 0) lines.push("", `Auto-fixed: ${report.fixed.join("; ")}`);
			lines.push("", "Judgment items were queued for wiki_review where applicable.");
			return { content: [{ type: "text", text: lines.join("\n") }], details: report };
		},
	});

	pi.registerTool({
		name: "wiki_remove",
		label: "Remove Wiki Pages",
		description:
			"Remove pages from the wiki and their TOC entries. Use for pages that violate the quality bar (derivable/duplicate) or are obsolete. Raw sources are never removed.",
		promptSnippet: "Remove obsolete or invalid wiki pages",
		promptGuidelines: [
			"Use wiki_remove to delete pages that lint flags as derivable, duplicate, or obsolete; never remove raw sources.",
		],
		parameters: Type.Object({
			pages: Type.Array(Type.String({ description: "Page paths relative to the project or wiki root" })),
			reason: Type.String({ description: "Why these pages are being removed" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { layout } = runtimeFor(ctx);
			const removed: string[] = [];
			const refused: string[] = [];
			for (const page of params.pages) {
				const absolute = await resolvePagePath(layout, ctx.cwd, page);
				if (!absolute) {
					refused.push(`${page} (missing)`);
					continue;
				}
				const rel = relative(layout.wikiDir, absolute).split("\\").join("/");
				if (rel.startsWith("..")) {
					refused.push(`${page} (outside the wiki)`);
					continue;
				}
				await removeFileIfExists(absolute);
				removed.push(rel);
			}
			await updateIndex(layout, (entries) => entries.filter((entry) => !removed.includes(entry.path)));
			await appendLog(layout, "remove", `${removed.length} page(s)`, [
				`Reason: ${params.reason}`,
				...removed.map((page) => `Removed: ${page}`),
			]);
			await appendLedger(layout, {
				actor: "agent",
				op: "wiki.remove",
				action: "removed",
				subject: removed.join(", ").slice(0, 200),
				reason: params.reason,
			});
			const lines = [`Removed ${removed.length} page(s): ${removed.join(", ") || "(none)"}`];
			if (refused.length > 0) lines.push(`Refused: ${refused.join(", ")}`);
			return { content: [{ type: "text", text: lines.join("\n") }], details: { removed, refused } };
		},
	});

	pi.registerTool({
		name: "wiki_structure",
		label: "Scan Repository Structure",
		description:
			"Deterministic module and dependency map: manifests, entry points, module import edges, test surface, and which modules lack an architecture page. No model calls.",
		promptSnippet: "Scan repository structure and wiki architecture coverage",
		promptGuidelines: [
			"Use wiki_structure before large refactors or when architecture pages may be stale, then capture or update architecture knowledge via wiki_insights.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const { layout } = runtimeFor(ctx);
			const report = await scanStructure(ctx.cwd, layout);
			return { content: [{ type: "text", text: renderStructure(report) }], details: report };
		},
	});

	pi.registerTool({
		name: "wiki_index",
		label: "Manage the Semantic Index",
		description:
			"Manage the cross-wiki semantic search index (PGlite + pgvector): status, discover existing wikis, choose the embedding model, rebuild, add/remove registered wikis, or enable/disable indexing.",
		promptSnippet: "Manage the cross-wiki semantic index",
		promptGuidelines: [
			"Use wiki_index status to check index health; rebuild after changing search.vector.model or when doctor reports a stale index.",
			"Before the first index build, ask the user which embedding preset to use (performance vs quality) and set it with wiki_index action=model — ingestion must not start until the choice is made.",
			"Use wiki_index discover to find existing wikis on the machine, then register=true and rebuild all=true to adopt and index them.",
			"The semantic index is a derived cache — a model change re-embeds the whole wiki.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "model", "discover", "rebuild", "add", "remove", "enable", "disable"] as const),
			wiki: Type.Optional(Type.String({ description: "Registered wiki name (defaults to the current wiki)" })),
			path: Type.Optional(Type.String({ description: "Wiki root path for action=add (defaults to the current wiki root)" })),
			paths: Type.Optional(Type.Array(Type.String({ description: "Scan root paths for action=discover (defaults to configured roots, then home)" }))),
			model: Type.Optional(StringEnum(["performance", "quality"] as const, { description: "action=model: embedding preset to persist for this user" })),
			register: Type.Optional(Type.Boolean({ description: "action=discover: register every unregistered wiki found" })),
			all: Type.Optional(Type.Boolean({ description: "action=rebuild: reindex every enabled registered wiki" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { loaded, layout } = runtimeFor(ctx);
			const vector = loaded.config.search.vector;
			if (params.action === "status") {
				const status = await vectorStatus(loaded.agentDir, vector.model, vector.dimensions ?? undefined);
				const downloadMb = Math.round(status.downloadBytes / 1_000_000);
				const cachedMb = Math.round(status.modelsBytes / 1_000_000);
				const cacheLabel =
					status.modelsBytes === 0
						? `not downloaded yet (first rebuild downloads ~${downloadMb} MB)`
						: status.modelsBytes >= status.downloadBytes * 0.5
							? `cached (~${cachedMb} MB)`
							: `partial (~${cachedMb} MB of ~${downloadMb} MB)`;
				const lines = [
					"# Semantic index",
					`- preset: ${vector.model} (${status.repo}), ${status.dimensions}d — ${cacheLabel}`,
					`- models dir: ${status.modelsDir}`,
					`- database: ${status.dbAvailable ? "ok" : `unavailable — ${status.error}`}`,
					"",
					`Registered wikis (${status.registry.wikis.length}):`,
					...status.registry.wikis.map((entry) => {
						const state = status.states.find((candidate) => candidate.name === entry.name);
						const detail = state ? `${state.chunks} chunks, ${state.model} ${state.dim}d, updated ${state.updatedAt}` : "not indexed yet";
						return `- ${entry.name}${entry.enabled ? "" : " (disabled)"} — ${entry.root} — ${detail}`;
					}),
				];
				return { content: [{ type: "text", text: lines.join("\n") }], details: status };
			}
			if (params.action === "discover") {
				const registry = await readRegistry(loaded.agentDir);
				const scan = vector.scan ?? { maxDepth: 6, wsl: true };
				const roots = scanRoots(params.paths && params.paths.length > 0 ? params.paths.map((entry) => resolve(ctx.cwd, entry)) : scan.roots);
				const states = new Map<string, { chunks: number; model: string; updatedAt: string }>();
				try {
					const db = vectorDbFor(vectorDataDir(loaded.agentDir));
					await db.init();
					for (const entry of registry.wikis) {
						const state = await db.state(entry.name);
						if (state) states.set(entry.name, { chunks: state.chunks, model: state.model, updatedAt: state.updatedAt });
					}
				} catch {
					// Discovery still works when the index database is unavailable.
				}
				const discovered = await discoverWikis({
					roots,
					maxDepth: maxScanDepth(scan.maxDepth),
					wsl: scan.wsl,
					registry: registry.wikis,
					states,
				});
				const adopted: Array<{ name: string; root: string }> = [];
				if (params.register) {
					for (const entry of discovered.filter((item) => !item.registered && !item.missing)) {
						const { registration, created } = await registerWiki(loaded.agentDir, entry.root, { name: entry.name });
						if (created) adopted.push({ name: registration.name, root: registration.root });
					}
				}
				const lines = [
					"# Wiki discovery",
					`Scanned ${roots.length} root(s): ${roots.join(", ")}${scan.wsl ? " (plus WSL distros)" : ""}`,
					`Found ${discovered.length} wiki(s).`,
					"",
				];
				const groups: Array<[string, typeof discovered]> = [
					["Unregistered", discovered.filter((entry) => !entry.registered && !entry.missing)],
					["Registered but missing on disk", discovered.filter((entry) => entry.registered && entry.missing)],
					["Registered", discovered.filter((entry) => entry.registered && !entry.missing)],
				];
				for (const [title, group] of groups) {
					if (group.length === 0) continue;
					lines.push(`## ${title} (${group.length})`);
					for (const entry of group) {
						const index = entry.chunks !== undefined ? `${entry.chunks} chunks, ${entry.model}` : "not indexed";
						const flags = [entry.marker, entry.enabled === false ? "disabled" : undefined].filter(Boolean).join(", ");
						lines.push(`- **${entry.name}** — ${entry.root} — ${entry.pages} pages, ${entry.rawSources} raw — index: ${index} — ${flags}`);
					}
					lines.push("");
				}
				if (adopted.length > 0) {
					lines.push(`Adopted ${adopted.length} wiki(s): ${adopted.map((entry) => `\`${entry.name}\``).join(", ")}. Rebuild with all=true to index them.`);
				} else if (!params.register && discovered.some((entry) => !entry.registered && !entry.missing)) {
					lines.push("Re-run with register=true to adopt the unregistered wikis, then rebuild with all=true to index them.");
				}
				return { content: [{ type: "text", text: lines.join("\n") }], details: { roots, discovered, adopted } };
			}
			if (params.action === "model") {
				const current = await modelChoiceSource(loaded);
				if (!params.model) {
					const lines = [
						"# Embedding model",
						`- effective: **${current.model}** (${current.source === "default" ? "built-in default — not chosen yet" : `set in ${current.source} config`})`,
						"",
						...Object.entries(MODEL_PRESETS).map(
							([key, preset]) =>
								`- **${key}** — ${preset.id}, ${preset.dimensions}d, ~${Math.round(preset.expectedBytes / 1_000_000)} MB download, ${preset.repo}`,
						),
						"",
						"Set with `wiki_index action=model model=performance|quality`, then `wiki_index action=rebuild all=true`.",
					];
					return { content: [{ type: "text", text: lines.join("\n") }], details: current };
				}
				await writeModelSetting(loaded.globalConfigPath, params.model);
				const registry = await readRegistry(loaded.agentDir);
				const db = vectorDbFor(vectorDataDir(loaded.agentDir));
				const stale: string[] = [];
				await db.init();
				for (const entry of registry.wikis) {
					const state = await db.state(entry.name);
					if (!state || state.model !== params.model) stale.push(entry.name);
				}
				return {
					content: [
						{
							type: "text",
							text: `Set search.vector.model = **${params.model}** in ${loaded.globalConfigPath}.\nStale indexes needing a rebuild: ${stale.length > 0 ? stale.map((name) => `\`${name}\``).join(", ") : "(none)"}. Run \`wiki_index action=rebuild all=true\` to re-embed.`,
						},
					],
					details: { model: params.model, stale },
				};
			}
			if (params.action === "rebuild") {
				const choice = await modelChoiceSource(loaded);
				if (choice.source === "default" && !(await indexExists(loaded.agentDir))) {
					const lines = [
						"## Embedding model not chosen yet",
						"No semantic index exists on this machine yet, so ask the user which embedding preset to use before indexing:",
						"",
						...Object.entries(MODEL_PRESETS).map(
							([key, preset]) =>
								`- **${key}** — ${preset.id}, ${preset.dimensions}d, ~${Math.round(preset.expectedBytes / 1_000_000)} MB download (${preset.repo})`,
						),
						"",
						"Then run `wiki_index action=model model=<performance|quality>` and rebuild again.",
					];
					return { content: [{ type: "text", text: lines.join("\n") }], details: { needsModelChoice: true } };
				}
				if (params.all) {
					const registry = await readRegistry(loaded.agentDir);
					const reports: string[] = [];
					for (const entry of registry.wikis.filter((item) => item.enabled)) {
						try {
							const root = await resolveWikiRoot(entry.root).catch(() => entry.root);
							if (root !== entry.root) await setWikiRoot(loaded.agentDir, entry.name, root);
							const report = await indexWiki({
								agentDir: loaded.agentDir,
								wiki: entry.name,
								root,
								model: vector.model,
								...(vector.dimensions ? { dimensions: vector.dimensions } : {}),
							});
							reports.push(`- ${entry.name}: ${report.embedded} embedded, ${report.skipped} unchanged, ${report.removed} removed, ${report.total} chunks (${report.milliseconds}ms)`);
						} catch (error) {
							reports.push(`- ${entry.name}: failed — ${(error as Error).message}`);
						}
					}
					return { content: [{ type: "text", text: [`# Indexed ${reports.length} wiki(s)`, ...reports].join("\n") }], details: { reports } };
				}
				const target = await resolveTargetWiki(loaded.agentDir, layout.root, params.wiki);
				const root = await resolveWikiRoot(target.root).catch(() => target.root);
				if (root !== target.root) await setWikiRoot(loaded.agentDir, target.name, root);
				const report = await indexWiki({
					agentDir: loaded.agentDir,
					wiki: target.name,
					root,
					model: vector.model,
					...(vector.dimensions ? { dimensions: vector.dimensions } : {}),
				});
				return {
					content: [{ type: "text", text: `Indexed \`${target.name}\`: ${report.embedded} embedded, ${report.skipped} unchanged, ${report.removed} removed, ${report.total} chunks in ${report.milliseconds}ms.` }],
					details: report,
				};
			}
			if (params.action === "add") {
				const root = params.path ? await resolveWikiRoot(resolve(ctx.cwd, params.path)) : layout.root;
				const { registration, created } = await registerWiki(loaded.agentDir, root, { name: params.wiki });
				return {
					content: [{ type: "text", text: `${created ? "Registered" : "Already registered"} wiki \`${registration.name}\` → ${registration.root}` }],
					details: registration,
				};
			}
			if (params.action === "remove") {
				const target = await resolveTargetWiki(loaded.agentDir, layout.root, params.wiki);
				await forgetWikiIndex(loaded.agentDir, target.name);
				await unregisterWiki(loaded.agentDir, target.name);
				return { content: [{ type: "text", text: `Removed \`${target.name}\` from the index and registry.` }], details: target };
			}
			const target = await resolveTargetWiki(loaded.agentDir, layout.root, params.wiki);
			const updated = await setWikiEnabled(loaded.agentDir, target.name, params.action === "enable");
			return { content: [{ type: "text", text: `${updated?.enabled ? "Enabled" : "Disabled"} \`${target.name}\`.` }], details: updated };
		},
	});

	pi.registerTool({
		name: "wiki_doctor",
		label: "Wiki Doctor",
		description:
			"Cheap deterministic health checks: config values, endpoint, API key, .env gitignore, layout, lock, ledger, review queue, git/sync state, and search engine availability. No model calls.",
		promptSnippet: "Run wiki health checks",
		promptGuidelines: [
			"Use wiki_doctor when the wiki behaves unexpectedly, before maintenance, or when starting in a new project.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const loaded = loadConfig(ctx.cwd);
			const report = await runDoctor(loaded);
			return { content: [{ type: "text", text: renderDoctor(report) }], details: report };
		},
	});

	pi.registerTool({
		name: "wiki_setup",
		label: "Configure Jev API Key",
		description:
			"Check or configure the Jev API key: status, guide (exact steps for TypeSafe or OpenRouter), test (one tiny live call), or write-env (write the key into the project .env after verifying it is gitignored). The key value is never echoed.",
		promptSnippet: "Check or configure the Jev API key (TypeSafe or OpenRouter)",
		promptGuidelines: [
			"Use wiki_setup when no Jev key is configured, when the user asks how to connect TypeSafe or OpenRouter, or when Jev calls fail with authentication errors.",
			"Never echo the key value back to the user; wiki_setup reports only where the key came from.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "guide", "test", "write-env"] as const),
			provider: Type.Optional(StringEnum(["typesafe", "openrouter", "aimlapi"] as const, { description: "Defaults to the configured provider" })),
			apiKey: Type.Optional(Type.String({ description: "Only used by write-env; never echoed" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const loaded = loadConfig(ctx.cwd);
			const provider = params.provider ?? loaded.config.provider;

			if (params.action === "status") {
				const piKey =
					!loaded.apiKey && provider === "openrouter"
						? await ctx.modelRegistry.getApiKeyForProvider("openrouter").catch(() => undefined)
						: undefined;
				const source = loaded.apiKey
					? `found via environment/.env (${loaded.envFilePath})`
					: piKey
						? "found via pi's OpenRouter login"
						: "missing";
				const text = [
					"# Jev key status",
					`- provider: ${loaded.config.provider}`,
					`- endpoint: ${loaded.config.baseUrl}`,
					`- model: ${loaded.config.model}`,
					`- key: ${source}`,
					`- env file: ${loaded.envFilePath}${existsSync(loaded.envFilePath) ? " (present)" : " (missing)"}`,
					loaded.apiKey || piKey ? "" : "- next: wiki_setup action=guide provider=typesafe|openrouter",
				]
					.filter(Boolean)
					.join("\n");
				return { content: [{ type: "text", text }], details: { provider: loaded.config.provider, keySource: source } };
			}

			if (params.action === "guide") {
				const guide =
					provider === "openrouter"
						? [
							"## OpenRouter (Decisions API)",
							"1. Create a key at https://openrouter.ai/keys.",
							`2. Add it to the project .env (gitignored): OPENROUTER_API_KEY=...`,
							'3. Set { "provider": "openrouter", "model": "~typesafe/jev-latest" } in .pi/jev-wiki.json or ~/.pi/agent/jev-wiki.json. The endpoint preset is https://openrouter.ai/api/alpha/decisions.',
							"4. Alternative: sign in with /login openrouter; the plugin uses pi's credential when provider is openrouter.",
							"5. Run wiki_setup action=test.",
							"Notes: 32k advertised context; pin with model typesafe/jev-1.13 if needed.",
						].join("\n")
						: [
							"## TypeSafe (official API, recommended)",
							"1. Get a token from https://typesafe.ai (early access).",
							`2. Add it to the project .env (gitignored): TYPESAFE_API_KEY=... (JEV_TOKEN also works).`,
							'3. Or write { "provider": "typesafe", "apiKey": "$TYPESAFE_API_KEY" } to .pi/jev-wiki.json or ~/.pi/agent/jev-wiki.json.',
							"4. Run wiki_setup action=test.",
							"Notes: 64k context (32k state + longest question), $0.042/Mtok input, output free.",
						].join("\n");
				return { content: [{ type: "text", text: guide }], details: { provider } };
			}

			if (params.action === "write-env") {
				if (!params.apiKey) throw new Error("wiki_setup write-env needs `apiKey`.");
				const varName = provider === "openrouter" ? "OPENROUTER_API_KEY" : provider === "aimlapi" ? "AIMLAPI_API_KEY" : "TYPESAFE_API_KEY";
				if (await isGitRepo(ctx.cwd)) {
					const ignored = await git(ctx.cwd, ["check-ignore", "-q", loaded.envFilePath]);
					if (ignored.code !== 0) {
						throw new Error(`${loaded.envFilePath} is not gitignored. Add it to .gitignore before writing a key.`);
					}
				}
				const existing = existsSync(loaded.envFilePath) ? await readFile(loaded.envFilePath, "utf8") : "";
				const pattern = new RegExp(`^\\s*${varName}\\s*=`);
				const lines = existing.split(/\r?\n/).filter((line) => line.trim() && !pattern.test(line));
				lines.push(`${varName}=${params.apiKey}`);
				await writeTextAtomic(loaded.envFilePath, `${lines.join("\n")}\n`);
				return {
					content: [{ type: "text", text: `Wrote ${varName} to ${loaded.envFilePath} (value not echoed). Run wiki_setup action=test to verify.` }],
					details: { varName, path: loaded.envFilePath },
				};
			}

			const started = Date.now();
			try {
				const client = await requireClient(loaded, ctx);
				const response = await client.systemOne(
					{ probe: "connectivity test" },
					{ ok: noul("This is a connectivity test. The correct answer is yes.") },
					{ signal: ctx.signal, timeoutMs: 20_000 },
				);
				return {
					content: [
						{
							type: "text",
							text: `Jev reachable in ${Date.now() - started}ms · model ${response.model} · tokens ${response.usage.input_tokens}/${response.usage.output_tokens}`,
						},
					],
					details: { model: response.model, usage: response.usage },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Jev test failed: ${(error as Error).message}\n\nRun wiki_setup action=guide provider=${provider} for setup steps.`,
						},
					],
					details: { error: String((error as Error).message) },
				};
			}
		},
	});

	pi.registerTool({
		name: "wiki_triage",
		label: "Triage Rejected Insights",
		description:
			"Explain rejected wiki claims: why each was rejected, its Jev scores, whether the problem is evidence or policy, how to fix it, and whether the derivability threshold is calibrated for this project. No model calls.",
		promptSnippet: "Triage rejected insights and how to fix them",
		promptGuidelines: [
			"Use wiki_triage when an agent or user disagrees with rejected insights, and before re-submitting a rejection.",
			"After wiki_triage, re-submit fixable claims with wiki_insights using commit messages or quotes as evidence.",
		],
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "Max rejections to list (default 20)" })),
			sinceDays: Type.Optional(Type.Number({ description: "Only consider rejections from the last N days" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { layout } = runtimeFor(ctx);
			const ledger = await readLedger(layout);
			const report = buildTriageReport(ledger, { limit: params.limit ?? 20, sinceDays: params.sinceDays });
			return { content: [{ type: "text", text: renderTriage(report) }], details: report };
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

	pi.registerCommand("wiki:lint", {
		description: "Health-check the wiki and auto-fix safe issues",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			pi.sendUserMessage(
				"Lint the project wiki: call wiki_lint, report the findings, then work any queued judgment items with wiki_review (read the referenced pages first).",
			);
		},
	});

	pi.on("session_shutdown", async () => {
		await closeVectorDbs().catch(() => undefined);
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
			if (existsSync(join(layout.stateDir, "pending-capture.md"))) {
				ctx.ui.notify("jev-wiki: accepted insights are waiting to be written — run /wiki:review or ask to file pending captures", "info");
			}
		} catch {
			/* sync check is best-effort */
		}
	});

	// --- automatic capture ------------------------------------------------------

	let autoCaptureInFlight = false;
	let lastAutoCaptureAt = 0;
	let lastAutoCaptureMessageCount = 0;

	async function autoCapture(
		ctx: ExtensionContext,
		source: "compact" | "settled",
		entries?: unknown[],
	): Promise<{ accepted: number; brief: string } | undefined> {
		const loaded = loadConfig(ctx.cwd);
		if (!loaded.apiKey) return undefined;
		const branch = entries ?? ctx.sessionManager.getBranch();
		const messageCount = branch.filter((entry) => {
			const candidate = entry as { type?: string; message?: { role?: string } };
			return candidate?.type === "message" && (candidate.message?.role === "user" || candidate.message?.role === "assistant");
		}).length;
		if (messageCount < 3 || messageCount === lastAutoCaptureMessageCount) return undefined;
		if (Date.now() - lastAutoCaptureAt < 10 * 60_000) return undefined;
		if (autoCaptureInFlight) return undefined;
		autoCaptureInFlight = true;
		try {
			const transcript = sessionTextFromEntries(branch);
			const runtime: Runtime = {
				loaded,
				layout: resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot),
			};
			await ensureLayout(runtime.layout);
			const client = await requireClient(loaded, ctx);

			// Cheap Jev pre-screen: only pay for extraction when the session likely holds durable knowledge.
			const screen = await client.systemOne(
				{ session_excerpt: transcript.slice(-6000) },
				{
					worth_capturing: noul(
						"This session contains a durable decision, invariant, architecture insight, or user-stated policy worth capturing in the project wiki.",
						{ true: "Contains durable, non-derivable knowledge", false: "Only transient work, implementation detail, or nothing durable" },
					),
				},
				{ signal: ctx.signal },
			);
			const worth = screen.answers.worth_capturing?.type === "noul" ? screen.answers.worth_capturing.noul : 0;
			await appendLedger(runtime.layout, {
				actor: "jev",
				op: "capture.screen",
				subject: source,
				verdict: { worth_capturing: worth },
				action: worth >= 0.6 ? "extract" : "skip",
				usage: { input_tokens: screen.usage.input_tokens, output_tokens: screen.usage.output_tokens },
			});
			if (worth < 0.6) {
				lastAutoCaptureAt = Date.now();
				lastAutoCaptureMessageCount = messageCount;
				return { accepted: 0, brief: `Pre-screen skipped extraction (worth capturing ${worth.toFixed(2)}).` };
			}

			const insights = await extractInsights(ctx, transcript);
			if (insights.length === 0) {
				lastAutoCaptureAt = Date.now();
				lastAutoCaptureMessageCount = messageCount;
				return { accepted: 0, brief: "No durable insights found." };
			}
			const result = await processInsights(runtime, ctx, client, insights, { source, mode: loaded.config.writer.mode });
			lastAutoCaptureAt = Date.now();
			lastAutoCaptureMessageCount = messageCount;
			return { accepted: result.accepted, brief: result.brief };
		} catch {
			return undefined;
		} finally {
			autoCaptureInFlight = false;
		}
	}

	pi.on("agent_settled", async (_event, ctx) => {
		try {
			const loaded = loadConfig(ctx.cwd);
			if (!loaded.config.capture.onSettle) return;
			const result = await autoCapture(ctx, "settled");
			if (!result || result.accepted === 0) return;
			const layout = resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot);
			await writeTextAtomic(join(layout.stateDir, "pending-capture.md"), `# Pending capture\n\n${result.brief}\n\nWrite or merge the accepted pages following the llm-wiki skill, then call wiki_finalize.\n`);
			if (ctx.hasUI) {
				pi.sendMessage(
					{
						customType: "jev-wiki",
						content: `${result.brief}\n\nWrite or merge the accepted pages following the llm-wiki skill, then call wiki_finalize.`,
						display: true,
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			}
		} catch {
			/* auto-capture is best-effort and must never break the session */
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const loaded = loadConfig(ctx.cwd);
			if (!loaded.config.capture.onCompact) return;
			const preparation = (event as { preparation?: { messagesToSummarize?: unknown[] } }).preparation;
			const result = await autoCapture(ctx, "compact", preparation?.messagesToSummarize);
			if (!result || result.accepted === 0) return;
			const layout = resolveLayout(ctx.cwd, loaded.config.wikiRoot, loaded.config.stateRoot);
			await writeTextAtomic(join(layout.stateDir, "pending-capture.md"), `# Pending capture (pre-compaction)\n\n${result.brief}\n\nWrite or merge the accepted pages following the llm-wiki skill, then call wiki_finalize.\n`);
			if (ctx.hasUI) {
				pi.sendMessage(
					{
						customType: "jev-wiki",
						content: `Captured before compaction:\n\n${result.brief}\n\nWrite or merge the accepted pages following the llm-wiki skill, then call wiki_finalize.`,
						display: true,
					},
					{ deliverAs: "nextTurn" },
				);
			}
		} catch {
			/* auto-capture is best-effort and must never break the session */
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
