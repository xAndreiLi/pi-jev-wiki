/**
 * Claim provenance: corroboration counting and supersession.
 * These are the compounding mechanics — repeated insight strengthens a claim,
 * newer knowledge retires it with a link instead of deleting it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readPage, todayISO, writePage, type WikiLayout } from "./wiki/layout.ts";

export interface ReinforcementResult {
	page: string;
	claimId?: string;
	corroborations: number;
	support: number;
}

export interface SupersessionResult {
	page: string;
	claimId?: string;
	supersededText: string;
}

function tokens(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter((token) => token.length > 3),
	);
}

function similarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const token of a) if (b.has(token)) shared++;
	return shared / Math.min(a.size, b.size);
}

function findClaim(claims: Record<string, unknown>[], text: string, minimum = 0.5): number {
	const needle = tokens(text);
	let bestIndex = -1;
	let bestScore = 0;
	claims.forEach((claim, index) => {
		if (typeof claim.text !== "string") return;
		const status = String(claim.status ?? "verified");
		if (status === "rejected" || status === "superseded") return;
		const score = similarity(tokens(claim.text), needle);
		if (score > bestScore) {
			bestScore = score;
			bestIndex = index;
		}
	});
	return bestScore >= minimum ? bestIndex : -1;
}

/** Increment corroboration for the best-matching claim on a page. */
export async function applyReinforcement(
	layout: WikiLayout,
	pageRel: string,
	text: string,
	options?: { evidence?: string[] },
): Promise<ReinforcementResult | undefined> {
	const pagePath = join(layout.wikiDir, pageRel);
	if (!existsSync(pagePath)) return undefined;
	const page = await readPage(pagePath);
	const claims = Array.isArray(page.data.claims) ? (page.data.claims as Record<string, unknown>[]) : [];
	const index = findClaim(claims, text);
	if (index === -1) return undefined;
	const claim = claims[index];
	const corroborations = Number(claim.corroborations ?? 1) + 1;
	claim.corroborations = corroborations;
	claim.last_confirmed = todayISO();
	claim.support = Math.min(0.99, Math.max(Number(claim.support ?? 0.8), 0.85 + 0.02 * corroborations));
	if (options?.evidence?.length) {
		const evidence = Array.isArray(claim.evidence) ? claim.evidence.map(String) : [];
		for (const item of options.evidence) if (!evidence.includes(item)) evidence.push(item);
		claim.evidence = evidence;
	}
	claims[index] = claim;
	page.data.claims = claims;
	page.data.updated = todayISO();
	await writePage(pagePath, page.data, page.body);
	return {
		page: pageRel,
		claimId: typeof claim.id === "string" ? claim.id : undefined,
		corroborations,
		support: Number(claim.support),
	};
}

/** Mark the best-matching claim on a page as superseded by newer knowledge. */
export async function applySupersession(
	layout: WikiLayout,
	pageRel: string,
	byText: string,
): Promise<SupersessionResult | undefined> {
	const pagePath = join(layout.wikiDir, pageRel);
	if (!existsSync(pagePath)) return undefined;
	const page = await readPage(pagePath);
	const claims = Array.isArray(page.data.claims) ? (page.data.claims as Record<string, unknown>[]) : [];
	// find the claim that the new text supersedes: highest overlap with the new text
	const index = findClaim(claims, byText, 0.35);
	if (index === -1) return undefined;
	const claim = claims[index];
	const supersededText = String(claim.text ?? "");
	claim.status = "superseded";
	claim.superseded_by = byText.slice(0, 100);
	claim.superseded_at = todayISO();
	claims[index] = claim;
	page.data.claims = claims;
	page.data.updated = todayISO();
	await writePage(pagePath, page.data, page.body);
	return {
		page: pageRel,
		claimId: typeof claim.id === "string" ? claim.id : undefined,
		supersededText,
	};
}

/** Best-matching candidate claim page for a relation verdict. */
export function bestCandidatePage(
	candidates: Array<{ text: string; page?: string }>,
	text: string,
	minimum = 0.4,
): string | undefined {
	let best: string | undefined;
	let bestScore = 0;
	for (const candidate of candidates) {
		if (!candidate.page) continue;
		const score = similarity(tokens(candidate.text), tokens(text));
		if (score > bestScore) {
			bestScore = score;
			best = candidate.page;
		}
	}
	return bestScore >= minimum ? best : undefined;
}
