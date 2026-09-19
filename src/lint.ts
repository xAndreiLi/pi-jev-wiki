/**
 * Wiki lint: deterministic health checks (TOC, links, orphans, raw backlog,
 * claims with no accepted ledger entry) plus Jev contradiction checks on
 * code-selected candidate claim pairs.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ResolvedConfig } from "./config.ts";
import { choice, isChoice, noul, type JevClient } from "./jev.ts";
import { appendLedger, readLedger } from "./ledger.ts";
import { enqueueReview } from "./review.ts";
import { extractMarkdownLinks, isExternalLink, linkTarget } from "./wiki/links.ts";
import { listMarkdownFiles, readPage, todayISO, writePage, type WikiLayout } from "./wiki/layout.ts";
import { appendLog, entryFromPage, readIndex, updateIndex, upsertEntries, writeIndex, type TocEntry } from "./wiki/toc.ts";

export interface UnbackedClaim {
	page: string;
	claimId?: string;
	text: string;
}

export interface Contradiction {
	pageA: string;
	textA: string;
	pageB: string;
	textB: string;
	relation: string;
	confidence: number;
}

export interface DuplicateCandidate {
	pageA: string;
	textA: string;
	pageB: string;
	textB: string;
	similarity: number;
	same: number;
}

export interface LintReport {
	pages: number;
	toc: { added: string[]; missingFiles: string[]; updatedFixed: string[] };
	brokenLinks: string[];
	orphans: string[];
	rawBacklog: string[];
	unbackedClaims: UnbackedClaim[];
	contradictions: Contradiction[];
	duplicates: DuplicateCandidate[];
	fixed: string[];
	usage: { input_tokens: number; output_tokens: number };
}

export interface LintOptions {
	autoFix?: boolean;
	checkContradictions?: boolean;
	maxContradictionPairs?: number;
	signal?: AbortSignal;
}

interface PageRecord {
	rel: string;
	abs: string;
	data: Record<string, unknown>;
	body: string;
	text: string;
}

function normalize(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenSet(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter((token) => token.length > 3),
	);
}

function isActiveClaim(claim: Record<string, unknown>): boolean {
	const status = String(claim.status ?? "verified");
	return status !== "superseded" && status !== "rejected";
}

export async function lintWiki(
	layout: WikiLayout,
	client: JevClient,
	config: ResolvedConfig,
	options?: LintOptions,
): Promise<LintReport> {
	const autoFix = options?.autoFix ?? true;
	const usage = { input_tokens: 0, output_tokens: 0 };
	const report: LintReport = {
		pages: 0,
		toc: { added: [], missingFiles: [], updatedFixed: [] },
		brokenLinks: [],
		orphans: [],
		rawBacklog: [],
		unbackedClaims: [],
		contradictions: [],
		duplicates: [],
		fixed: [],
		usage,
	};

	const files = await listMarkdownFiles(layout.wikiDir);
	const pages: PageRecord[] = [];
	for (const abs of files) {
		const rel = relative(layout.wikiDir, abs).split("\\").join("/");
		if (rel === "index.md" || rel === "log.md") continue;
		try {
			const page = await readPage(abs);
			const text = await readFile(abs, "utf8");
			pages.push({ rel, abs, data: page.data, body: page.body, text });
		} catch {
			/* skip unreadable */
		}
	}
	report.pages = pages.length;

	// --- TOC reconciliation ---------------------------------------------------
	const entries = await readIndex(layout);
	const byPath = new Map(entries.map((entry) => [entry.path, entry]));
	const updates: TocEntry[] = [];
	for (const page of pages) {
		const entry = byPath.get(page.rel);
		const fresh = entryFromPage(page.rel, page.data);
		if (!entry) {
			report.toc.added.push(page.rel);
			updates.push(fresh);
		} else if (entry.updated !== fresh.updated || entry.summary !== fresh.summary) {
			report.toc.updatedFixed.push(page.rel);
			updates.push(fresh);
		}
	}
	for (const entry of entries) {
		if (!pages.some((page) => page.rel === entry.path)) report.toc.missingFiles.push(entry.path);
	}
	if (autoFix && updates.length > 0) {
		await updateIndex(layout, (current) => upsertEntries(current, updates));
		report.fixed.push(`toc: ${updates.length} entries`);
	}

	// --- Links and orphans ----------------------------------------------------
	const inbound = new Map<string, number>();
	for (const page of pages) {
		for (const link of extractMarkdownLinks(page.text)) {
			if (isExternalLink(link)) continue;
			const target = resolve(dirname(page.abs), linkTarget(link));
			if (!existsSync(target)) {
				report.brokenLinks.push(`${page.rel} → ${link}`);
				continue;
			}
			const targetRel = relative(layout.wikiDir, target).split("\\").join("/");
			inbound.set(targetRel, (inbound.get(targetRel) ?? 0) + 1);
		}
	}
	for (const page of pages) {
		if ((inbound.get(page.rel) ?? 0) === 0) {
			const updated = String(page.data.updated ?? "");
			const cutoff = new Date(Date.now() - config.lint.orphanMinAgeDays * 86_400_000).toISOString().slice(0, 10);
			if (updated && updated >= cutoff) continue; // young pages are expected to be unlinked
			report.orphans.push(page.rel);
		}
	}

	// --- Raw backlog ----------------------------------------------------------
	const rawFiles = existsSync(layout.rawDir) ? await listMarkdownFiles(layout.rawDir) : [];
	for (const raw of rawFiles) {
		const rel = relative(layout.root, raw).split("\\").join("/");
		if (rel.startsWith("raw/sessions/")) continue; // session journals are records, not pending sources
		const name = raw.split(/[\\/]/).pop() ?? raw;
		if (!pages.some((page) => page.text.includes(name))) report.rawBacklog.push(rel);
	}

	// --- Unbacked claims (no accepted ledger entry) ----------------------------
	const ledger = await readLedger(layout);
	const accepted = ledger
		.filter(
			(entry) =>
				entry.actor === "code" &&
				["file", "reinforce", "file_user_stated"].includes(String(entry.action)) &&
				entry.subject,
		)
		.map((entry) => ({ subject: normalize(String(entry.subject)), tokens: tokenSet(String(entry.subject)) }));
	const referenced = new Set<string>();
	for (const entry of ledger) {
		for (const value of [entry.subject, entry.outcome, entry.reason]) {
			if (typeof value === "string") referenced.add(normalize(value));
		}
	}
	for (const page of pages) {
		const claims = Array.isArray(page.data.claims) ? (page.data.claims as Record<string, unknown>[]) : [];
		for (const claim of claims) {
			if (typeof claim.text !== "string" || !isActiveClaim(claim)) continue;
			const needle = normalize(claim.text);
			const claimTokens = tokenSet(claim.text);
			const backed = accepted.some(({ subject, tokens }) => {
				const head = needle.slice(0, 100);
				if (subject === head || subject.startsWith(head) || head.startsWith(subject)) return true;
				if (tokens.size === 0 || claimTokens.size === 0) return false;
				let shared = 0;
				for (const token of tokens) if (claimTokens.has(token)) shared++;
				return shared / Math.min(tokens.size, claimTokens.size) >= 0.5;
			});
			const reviewed = [...referenced].some((value) => {
				if (!value.includes(normalize(page.rel))) return false;
				return !claim.id || value.includes(String(claim.id)) || value.includes(needle.slice(0, 60));
			});
			if (!backed && !reviewed) {
				report.unbackedClaims.push({
					page: page.rel,
					claimId: typeof claim.id === "string" ? claim.id : undefined,
					text: claim.text,
				});
				if (autoFix) {
					await enqueueReview(layout, {
						kind: "claim_review",
						claimText: claim.text,
						page: page.rel,
						claimId: typeof claim.id === "string" ? claim.id : undefined,
						criticality: 0.45,
						reason: "lint: no accepted ledger entry backs this claim",
					});
				}
			}
		}
	}

	// --- Contradiction checks --------------------------------------------------
	if (options?.checkContradictions !== false) {
		const claims: Array<{ page: string; pageRef: PageRecord; claim: Record<string, unknown>; files: string[] }> = [];
		for (const page of pages) {
			const pageFiles = Array.isArray(page.data.files) ? page.data.files.map(String) : [];
			const rawClaims = Array.isArray(page.data.claims) ? (page.data.claims as Record<string, unknown>[]) : [];
			for (const claim of rawClaims) {
				if (typeof claim.text !== "string" || !isActiveClaim(claim)) continue;
				const claimFiles = Array.isArray(claim.files) ? claim.files.map(String) : pageFiles;
				claims.push({ page: page.rel, pageRef: page, claim, files: claimFiles });
			}
		}

		const pairs: Array<{ a: (typeof claims)[number]; b: (typeof claims)[number] }> = [];
		for (let i = 0; i < claims.length; i++) {
			for (let j = i + 1; j < claims.length; j++) {
				if (claims[i].page === claims[j].page) continue;
				const shared = claims[i].files.some((file) => claims[j].files.includes(file));
				if (shared) pairs.push({ a: claims[i], b: claims[j] });
			}
		}

		const limit = options?.maxContradictionPairs ?? 8;
		const markedPages = new Set<string>();
		for (const pair of pairs.slice(0, limit)) {
			const response = await client.systemOne(
				{
					claim_a: { page: pair.a.page, text: pair.a.claim.text },
					claim_b: { page: pair.b.page, text: pair.b.claim.text },
				},
				{
					relation: choice("How do these two wiki claims relate?", {
						consistent: "They agree and can both be true",
						contradicts: "They cannot both be true",
						supersedes_a: "Claim A replaces claim B with newer or better information",
						supersedes_b: "Claim B replaces claim A with newer or better information",
						independent: "They are about different things",
					}),
				},
				{ signal: options?.signal },
			);
			usage.input_tokens += response.usage.input_tokens;
			usage.output_tokens += response.usage.output_tokens;
			const answer = response.answers.relation;
			const relation = isChoice(answer) ? answer.choice : "independent";
			const confidence = isChoice(answer) ? answer.confidence : 0;
			const contradicts = relation === "contradicts";
			report.contradictions.push({
				pageA: pair.a.page,
				textA: String(pair.a.claim.text),
				pageB: pair.b.page,
				textB: String(pair.b.claim.text),
				relation,
				confidence,
			});
			await appendLedger(layout, {
				actor: "jev",
				op: "lint.contradiction",
				subject: `${pair.a.page} vs ${pair.b.page}`,
				verdict: { relation, confidence },
				action: contradicts && confidence >= config.thresholds.autoAccept ? "dispute" : "report",
				usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
			});
			if (contradicts && confidence >= config.thresholds.autoAccept && autoFix) {
				for (const side of [pair.a, pair.b]) {
					const claimsList = Array.isArray(side.pageRef.data.claims)
						? (side.pageRef.data.claims as Record<string, unknown>[])
						: [];
					const index = claimsList.findIndex((claim) => claim.text === side.claim.text);
					if (index >= 0) {
						claimsList[index].status = "disputed";
						side.pageRef.data.claims = claimsList;
						side.pageRef.data.updated = todayISO();
						markedPages.add(side.pageRef.abs);
					}
					await enqueueReview(layout, {
						kind: "dispute",
						claimText: String(side.claim.text),
						page: side.page,
						claimId: typeof side.claim.id === "string" ? side.claim.id : undefined,
						criticality: Math.max(0.7, confidence),
						reason: `lint: contradicts ${side === pair.a ? pair.b.page : pair.a.page}`,
						verdicts: { relation, confidence },
					});
				}
			}
		}
		for (const abs of markedPages) {
			const page = await readPage(abs);
			await writePage(abs, page.data, page.body);
		}
		if (markedPages.size > 0) report.fixed.push(`disputes: ${markedPages.size} page(s)`);

		// --- Duplicate consolidation candidates ---------------------------------
		const duplicatePairs: Array<{ a: (typeof claims)[number]; b: (typeof claims)[number]; similarity: number }> = [];
		for (let i = 0; i < claims.length; i++) {
			for (let j = i + 1; j < claims.length; j++) {
				if (claims[i].page === claims[j].page) continue;
				const left = tokenSet(String(claims[i].claim.text));
				const right = tokenSet(String(claims[j].claim.text));
				if (left.size === 0 || right.size === 0) continue;
				let shared = 0;
				for (const token of left) if (right.has(token)) shared++;
				const similarity = shared / Math.min(left.size, right.size);
				if (similarity >= config.lint.duplicateSimilarity) duplicatePairs.push({ a: claims[i], b: claims[j], similarity });
			}
		}
		for (const pair of duplicatePairs.slice(0, 6)) {
			const response = await client.systemOne(
				{
					claim_a: { page: pair.a.page, text: pair.a.claim.text },
					claim_b: { page: pair.b.page, text: pair.b.claim.text },
				},
				{
					merge: noul("These two wiki claims state the same knowledge and should be consolidated into one.", {
						true: "Same knowledge; consolidating loses nothing",
						false: "Different enough that both should stay",
					}),
				},
				{ signal: options?.signal },
			);
			usage.input_tokens += response.usage.input_tokens;
			usage.output_tokens += response.usage.output_tokens;
			const same = response.answers.merge && response.answers.merge.type === "noul" ? response.answers.merge.noul : 0;
			report.duplicates.push({
				pageA: pair.a.page,
				textA: String(pair.a.claim.text),
				pageB: pair.b.page,
				textB: String(pair.b.claim.text),
				similarity: Number(pair.similarity.toFixed(2)),
				same,
			});
			await appendLedger(layout, {
				actor: "jev",
				op: "lint.duplicate",
				subject: `${pair.a.page} vs ${pair.b.page}`,
				verdict: { similarity: pair.similarity, same },
				action: same >= 0.8 ? "consolidate" : "keep",
				usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
			});
			if (same >= 0.8 && autoFix) {
				await enqueueReview(layout, {
					kind: "claim_review",
					claimText: String(pair.a.claim.text),
					page: pair.a.page,
					claimId: typeof pair.a.claim.id === "string" ? pair.a.claim.id : undefined,
					criticality: 0.5,
					reason: `possible duplicate of ${pair.b.page} (${same.toFixed(2)}): ${String(pair.b.claim.text).slice(0, 80)}`,
					verdicts: { similarity: pair.similarity, same },
				});
			}
		}
	}

	await appendLog(layout, "lint", `${report.toc.added.length} added, ${report.brokenLinks.length} broken links, ${report.unbackedClaims.length} unbacked claims`, [
		`Pages: ${report.pages}`,
		`TOC updated: ${report.toc.updatedFixed.length} · missing files: ${report.toc.missingFiles.length}`,
		`Orphans: ${report.orphans.length} · raw backlog: ${report.rawBacklog.length}`,
		`Contradiction checks: ${report.contradictions.length} · duplicate candidates: ${report.duplicates.length}`,
	]);
	await appendLedger(layout, {
		actor: "code",
		op: "wiki.lint",
		action: "report",
		verdict: {
			tocAdded: report.toc.added.length,
			brokenLinks: report.brokenLinks.length,
			orphans: report.orphans.length,
			rawBacklog: report.rawBacklog.length,
			unbackedClaims: report.unbackedClaims.length,
			contradictions: report.contradictions.filter((entry) => entry.relation === "contradicts").length,
			duplicates: report.duplicates.filter((entry) => entry.same >= 0.8).length,
		},
	});
	return report;
}
