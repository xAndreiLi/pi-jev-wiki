/**
 * Review queue: items that need a decision (low confidence, needs recheck, disputes).
 * The agent works the queue via the wiki_review tool; the user is escalated only for
 * critical items. Code applies resolutions to page frontmatter.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readPage, todayISO, writePage, writeTextAtomic, type WikiLayout } from "./wiki/layout.ts";

export type ReviewKind = "claim_review" | "needs_recheck" | "dispute";
export type ReviewStatus = "open" | "resolved" | "deferred";
export type ReviewResolution = "accept" | "reject" | "supersede" | "defer";

export interface ReviewItem {
	id: string;
	ts: string;
	kind: ReviewKind;
	status: ReviewStatus;
	claimText: string;
	page?: string;
	claimId?: string;
	criticality: number;
	reason?: string;
	verdicts?: unknown;
	resolution?: ReviewResolution;
	note?: string;
	resolvedAt?: string;
}

function newId(): string {
	return `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export async function readReviews(layout: WikiLayout): Promise<ReviewItem[]> {
	if (!existsSync(layout.reviewQueuePath)) return [];
	const text = await readFile(layout.reviewQueuePath, "utf8");
	return text
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as ReviewItem;
			} catch {
				return undefined;
			}
		})
		.filter((item): item is ReviewItem => Boolean(item));
}

export async function writeReviews(layout: WikiLayout, items: ReviewItem[]): Promise<void> {
	const body = items.map((item) => JSON.stringify(item)).join("\n");
	await writeTextAtomic(layout.reviewQueuePath, body ? `${body}\n` : "");
}

export async function openReviewCount(layout: WikiLayout): Promise<number> {
	return (await readReviews(layout)).filter((item) => item.status === "open").length;
}

export async function enqueueReview(
	layout: WikiLayout,
	item: Omit<ReviewItem, "id" | "ts" | "status">,
): Promise<ReviewItem | undefined> {
	const items = await readReviews(layout);
	const duplicate = items.find(
		(existing) =>
			existing.status === "open" &&
			existing.kind === item.kind &&
			existing.page === item.page &&
			existing.claimText === item.claimText,
	);
	if (duplicate) return undefined;
	const record: ReviewItem = { id: newId(), ts: new Date().toISOString(), status: "open", ...item };
	items.push(record);
	await writeReviews(layout, items);
	return record;
}

export async function listOpenReviews(layout: WikiLayout, limit = 20): Promise<ReviewItem[]> {
	const items = await readReviews(layout);
	const order: Record<ReviewKind, number> = { dispute: 0, needs_recheck: 1, claim_review: 2 };
	return items
		.filter((item) => item.status === "open")
		.sort((a, b) => order[a.kind] - order[b.kind] || b.criticality - a.criticality)
		.slice(0, limit);
}

export async function resolveReview(
	layout: WikiLayout,
	id: string,
	resolution: ReviewResolution,
	note?: string,
): Promise<ReviewItem | undefined> {
	const items = await readReviews(layout);
	const item = items.find((candidate) => candidate.id === id);
	if (!item) return undefined;
	item.status = resolution === "defer" ? "deferred" : "resolved";
	item.resolution = resolution;
	item.note = note;
	item.resolvedAt = new Date().toISOString();
	await writeReviews(layout, items);
	return item;
}

/**
 * Apply a resolution to the claim in its page frontmatter.
 * Returns a status message; a missing page/claim is not fatal (the agent may handle it).
 */
export async function applyReviewResolution(
	layout: WikiLayout,
	item: ReviewItem,
	resolution: ReviewResolution,
): Promise<string> {
	if (!item.page) return "no page attached; resolution recorded only";
	const pagePath = join(layout.wikiDir, item.page);
	if (!existsSync(pagePath)) return `page not found: ${item.page}`;
	const page = await readPage(pagePath);
	const claims = Array.isArray(page.data.claims) ? (page.data.claims as Record<string, unknown>[]) : [];
	const index = claims.findIndex(
		(claim) => (item.claimId && claim.id === item.claimId) || claim.text === item.claimText,
	);
	if (index === -1) return `claim not found on ${item.page}`;
	const claim = claims[index];
	if (resolution === "accept") {
		if (claim.status !== "user-stated") {
			claim.status = "verified";
			claim.support = Math.max(Number(claim.support ?? 0), 0.8);
		}
	} else if (resolution === "reject") {
		claim.status = "rejected";
	} else if (resolution === "supersede") {
		claim.status = "superseded";
	}
	claim.reviewed = todayISO();
	claims[index] = claim;
	page.data.claims = claims;
	page.data.updated = todayISO();
	await writePage(pagePath, page.data, page.body);
	return `${resolution} applied to ${item.page}${item.claimId ? `#${item.claimId}` : ""}`;
}
