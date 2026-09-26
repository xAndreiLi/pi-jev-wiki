/**
 * Chunking: turn wiki pages into embeddable units — one chunk per active claim
 * (with page-title context) plus one per page section, keyed so edits stay stable.
 */
import { createHash } from "node:crypto";

export interface WikiPageInput {
	/** Page path relative to the wiki dir, e.g. "personal/summary-andrei-li.md". */
	path: string;
	title: string;
	body: string;
	claims: Array<{ id?: string; text: string; status?: string }>;
}

export interface Chunk {
	/** Stable within a page: "claim:<id>" or "section:<heading-slug>". */
	key: string;
	kind: "claim" | "page-section";
	claimId?: string;
	status?: string;
	title: string;
	text: string;
	hash: string;
}

export const ACTIVE_CLAIM_STATUSES = new Set(["verified", "user-stated", "needs_recheck"]);

export interface ChunkOptions {
	pageSections?: boolean;
	maxChars?: number;
	overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 4800; // ≈1,200 tokens
const DEFAULT_OVERLAP_CHARS = 640;

export function chunkPage(page: WikiPageInput, options: ChunkOptions = {}): Chunk[] {
	const chunks: Chunk[] = [];
	for (const claim of page.claims) {
		if (claim.status && !ACTIVE_CLAIM_STATUSES.has(claim.status)) continue;
		const text = claim.text.trim();
		if (!text) continue;
		chunks.push({
			key: `claim:${claim.id ?? slugify(text).slice(0, 48)}`,
			kind: "claim",
			...(claim.id ? { claimId: claim.id } : {}),
			...(claim.status ? { status: claim.status } : {}),
			title: page.title,
			text,
			hash: hashChunk(page.title, text),
		});
	}
	if (options.pageSections !== false) {
		const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
		const overlap = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
		for (const section of splitSections(page.body, maxChars, overlap)) {
			if (section.text.length < 80) continue;
			chunks.push({
				key: `section:${section.slug}`,
				kind: "page-section",
				title: page.title,
				text: section.text,
				hash: hashChunk(page.title, section.text),
			});
		}
	}
	return chunks;
}

export function hashChunk(title: string, text: string): string {
	return createHash("sha256").update(`${title}\n${text}`, "utf8").digest("hex");
}

export function slugify(input: string, maxLength = 48): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.slice(0, maxLength).replace(/-+$/g, "") || "section";
}

interface Section {
	slug: string;
	text: string;
}

/** Split markdown into heading-based sections, then window long ones with overlap. */
export function splitSections(body: string, maxChars = DEFAULT_MAX_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS): Section[] {
	const lines = body.split(/\r?\n/);
	const sections: Array<{ heading: string; text: string }> = [];
	let heading = "overview";
	let buffer: string[] = [];
	const flush = () => {
		const text = buffer.join("\n").trim();
		if (text) sections.push({ heading, text });
		buffer = [];
	};
	for (const line of lines) {
		const match = /^(#{1,6})\s+(.*)$/.exec(line);
		if (match) {
			flush();
			heading = match[2].replace(/[*_`]/g, "").trim() || "overview";
			continue;
		}
		buffer.push(stripInline(line));
	}
	flush();

	const seen = new Map<string, number>();
	const out: Section[] = [];
	for (const section of sections) {
		const base = slugify(section.heading);
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		const slug = count === 1 ? base : `${base}-${count}`;
		for (const [index, window] of windowText(section.text, maxChars, overlapChars).entries()) {
			out.push({ slug: index === 0 ? slug : `${slug}-${index + 1}`, text: window });
		}
	}
	return out;
}

function windowText(text: string, maxChars: number, overlapChars: number): string[] {
	if (text.length <= maxChars) return [text];
	const windows: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + maxChars, text.length);
		if (end < text.length) {
			const breakAt = text.lastIndexOf("\n\n", end);
			if (breakAt > start + maxChars * 0.5) end = breakAt;
		}
		windows.push(text.slice(start, end).trim());
		if (end >= text.length) break;
		start = Math.max(end - overlapChars, start + 1);
	}
	return windows.filter(Boolean);
}

function stripInline(line: string): string {
	return line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trimEnd();
}
