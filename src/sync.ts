/**
 * Change-driven invalidation: diff since the last synced commit, ask Jev which
 * file-linked claims are affected, and update their status (recheck/supersede/dispute).
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedConfig } from "./config.ts";
import { changedFiles, diffForFiles, fileMatches, headCommit, isGitRepo } from "./git.ts";
import { choice, isChoice, isNoul, noul, type JevClient } from "./jev.ts";
import { appendLedger } from "./ledger.ts";
import { enqueueReview } from "./review.ts";
import { listMarkdownFiles, readPage, todayISO, writePage, writeTextAtomic, type WikiLayout } from "./wiki/layout.ts";
import { appendLog } from "./wiki/toc.ts";

export interface SyncState {
	lastSyncCommit?: string;
	lastSyncAt?: string;
}

export interface MappedClaim {
	page: string;
	pagePath: string;
	claimId?: string;
	text: string;
	status: string;
	files: string[];
	claim: Record<string, unknown>;
	pageData: Record<string, unknown>;
}

export interface SyncImpact {
	page: string;
	claimId?: string;
	text: string;
	impact: string;
	confidence: number;
	stillTrue: number;
	changedFiles: string[];
}

export interface SyncReport {
	repo: boolean;
	baseline?: string;
	head?: string;
	baselineInitialized: boolean;
	changedFiles: string[];
	matchedClaims: number;
	impacts: SyncImpact[];
	applied: string[];
	dryRun: boolean;
	usage: { input_tokens: number; output_tokens: number };
}

export interface SyncOptions {
	baseline?: string;
	dryRun?: boolean;
	maxClaims?: number;
	maxDiffChars?: number;
	signal?: AbortSignal;
}

function statePath(layout: WikiLayout): string {
	return join(layout.stateDir, "state.json");
}

export async function readSyncState(layout: WikiLayout): Promise<SyncState> {
	if (!existsSync(statePath(layout))) return {};
	try {
		return JSON.parse(await readFile(statePath(layout), "utf8")) as SyncState;
	} catch {
		return {};
	}
}

export async function writeSyncState(layout: WikiLayout, state: SyncState): Promise<void> {
	await writeTextAtomic(statePath(layout), `${JSON.stringify(state, null, "\t")}\n`);
}

export async function collectMappedClaims(layout: WikiLayout): Promise<MappedClaim[]> {
	const files = (await listMarkdownFiles(layout.wikiDir)).filter(
		(file) => !file.endsWith("index.md") && !file.endsWith("log.md"),
	);
	const mapped: MappedClaim[] = [];
	for (const file of files) {
		try {
			const page = await readPage(file);
			const pageFiles = normalizeFiles(page.data.files);
			const claims = Array.isArray(page.data.claims) ? (page.data.claims as Record<string, unknown>[]) : [];
			const pagePath = join(layout.wikiDir, file);
			const rel = file.split("\\").join("/").replace(`${layout.wikiDir.split("\\").join("/")}/`, "");
			for (const claim of claims) {
				if (typeof claim.text !== "string") continue;
				const claimFiles = normalizeFiles(claim.files);
				const relevant = claimFiles.length > 0 ? claimFiles : pageFiles;
				if (relevant.length === 0) continue;
				mapped.push({
					page: rel,
					pagePath,
					claimId: typeof claim.id === "string" ? claim.id : undefined,
					text: claim.text,
					status: typeof claim.status === "string" ? claim.status : "unknown",
					files: relevant,
					claim,
					pageData: page.data,
				});
			}
		} catch {
			/* skip unreadable */
		}
	}
	return mapped;
}

function normalizeFiles(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === "string" && value) return [value];
	return [];
}

export async function syncWiki(
	layout: WikiLayout,
	client: JevClient,
	config: ResolvedConfig,
	cwd: string,
	options?: SyncOptions,
): Promise<SyncReport> {
	const usage = { input_tokens: 0, output_tokens: 0 };
	const empty: SyncReport = {
		repo: false,
		baselineInitialized: false,
		changedFiles: [],
		matchedClaims: 0,
		impacts: [],
		applied: [],
		dryRun: Boolean(options?.dryRun),
		usage,
	};

	if (!(await isGitRepo(cwd))) return empty;
	const head = await headCommit(cwd);
	if (!head) return { ...empty, repo: true };

	const state = await readSyncState(layout);
	const baseline = options?.baseline ?? state.lastSyncCommit;
	if (!baseline) {
		if (!options?.dryRun) await writeSyncState(layout, { lastSyncCommit: head, lastSyncAt: new Date().toISOString() });
		return { ...empty, repo: true, head, baselineInitialized: true };
	}

	const changed = await changedFiles(cwd, baseline, "HEAD");
	if (changed.length === 0) {
		if (!options?.dryRun) await writeSyncState(layout, { lastSyncCommit: head, lastSyncAt: new Date().toISOString() });
		return { ...empty, repo: true, baseline, head, baselineInitialized: false };
	}

	const mapped = await collectMappedClaims(layout);
	const affected = mapped
		.filter((claim) => claim.files.some((pattern) => changed.some((path) => fileMatches(path, pattern))))
		.slice(0, options?.maxClaims ?? 40);

	const impacts: SyncImpact[] = [];
	const applied: string[] = [];
	const touchedPages = new Map<string, Record<string, unknown>>();

	for (const claim of affected) {
		const relevantChanges = changed.filter((path) => claim.files.some((pattern) => fileMatches(path, pattern)));
		const diff = await diffForFiles(cwd, baseline, "HEAD", relevantChanges, options?.maxDiffChars ?? 6000);
		const response = await client.systemOne(
			{
				page: { title: claim.pageData.title ?? claim.page, summary: claim.pageData.summary ?? null },
				claim: { id: claim.claimId ?? null, text: claim.text, status: claim.status, files: claim.files },
				code_change: { files: relevantChanges, diff },
			},
			{
				impact: choice("Given this code change, how should the wiki claim be updated?", {
					no_impact: "The change does not affect what the claim says",
					needs_recheck: "The change may invalidate the claim; it should be re-verified against current code",
					supersede: "The claim is now outdated and should be marked superseded",
					contradict: "The change directly contradicts the claim",
				}),
				still_true: noul("The claim is still true of the current code after this change."),
			},
			{ signal: options?.signal },
		);
		usage.input_tokens += response.usage.input_tokens;
		usage.output_tokens += response.usage.output_tokens;

		const impactAnswer = response.answers.impact;
		const impact = isChoice(impactAnswer) ? impactAnswer.choice : "needs_recheck";
		const confidence = isChoice(impactAnswer) ? impactAnswer.confidence : 0;
		const stillTrue = isNoul(response.answers.still_true) ? response.answers.still_true.noul : 0.5;
		const record: SyncImpact = {
			page: claim.page,
			claimId: claim.claimId,
			text: claim.text,
			impact,
			confidence,
			stillTrue,
			changedFiles: relevantChanges,
		};
		impacts.push(record);

		await appendLedger(layout, {
			actor: "jev",
			op: "sync.impact",
			subject: `${claim.page}#${claim.claimId ?? claim.text.slice(0, 40)}`,
			verdict: { impact, confidence, stillTrue },
			action: impact,
			usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
		});

		if (options?.dryRun || impact === "no_impact") {
			if (!options?.dryRun) {
				claim.claim.last_checked = todayISO();
				touchedPages.set(claim.pagePath, claim.pageData);
			}
			continue;
		}

		const criticality = impact === "contradict" ? Math.max(0.85, 1 - stillTrue) : Math.max(0.4, 1 - stillTrue);
		if (impact === "needs_recheck") {
			claim.claim.status = "needs_recheck";
			await enqueueReview(layout, {
				kind: "needs_recheck",
				claimText: claim.text,
				page: claim.page,
				claimId: claim.claimId,
				criticality,
				reason: `code changed: ${relevantChanges.slice(0, 4).join(", ")}`,
				verdicts: { impact, confidence, stillTrue },
			});
		} else if (impact === "supersede") {
			claim.claim.status = "superseded";
			claim.claim.superseded_by = `commit ${head.slice(0, 7)}`;
			await enqueueReview(layout, {
				kind: "needs_recheck",
				claimText: claim.text,
				page: claim.page,
				claimId: claim.claimId,
				criticality,
				reason: `diff supersedes claim: ${relevantChanges.slice(0, 4).join(", ")}`,
				verdicts: { impact, confidence, stillTrue },
			});
		} else if (impact === "contradict") {
			claim.claim.status = "disputed";
			await enqueueReview(layout, {
				kind: "dispute",
				claimText: claim.text,
				page: claim.page,
				claimId: claim.claimId,
				criticality,
				reason: `diff contradicts claim: ${relevantChanges.slice(0, 4).join(", ")}`,
				verdicts: { impact, confidence, stillTrue },
			});
		}
		claim.claim.last_checked = todayISO();
		claim.pageData.updated = todayISO();
		touchedPages.set(claim.pagePath, claim.pageData);
		applied.push(`${claim.page}#${claim.claimId ?? "?"} → ${impact}`);
		await appendLedger(layout, {
			actor: "code",
			op: "sync.apply",
			subject: `${claim.page}#${claim.claimId ?? claim.text.slice(0, 40)}`,
			action: impact,
			verdict: { status: claim.claim.status ?? null, changedFiles: relevantChanges },
		});
	}

	if (!options?.dryRun) {
		for (const [pagePath, data] of touchedPages) {
			const page = await readPage(pagePath);
			await writePage(pagePath, data, page.body);
		}
		await writeSyncState(layout, { lastSyncCommit: head, lastSyncAt: new Date().toISOString() });
		await appendLog(layout, "sync", `${impacts.length} claim(s) checked`, [
			`Baseline: ${baseline.slice(0, 7)} → ${head.slice(0, 7)}`,
			`Changed files: ${changed.length}`,
			...applied.map((line) => `Applied: ${line}`),
		]);
	}

	return {
		repo: true,
		baseline,
		head,
		baselineInitialized: false,
		changedFiles: changed,
		matchedClaims: affected.length,
		impacts,
		applied,
		dryRun: Boolean(options?.dryRun),
		usage,
	};
}
