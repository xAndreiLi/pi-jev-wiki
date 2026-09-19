/**
 * Session log: every captured candidate with its verdict, so recurrence can be
 * counted in code. Recurring rejected candidates are promoted to the review queue.
 */
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import type { WikiLayout } from "./wiki/layout.ts";
import { enqueueReview } from "./review.ts";

export interface SessionLogEntry {
	ts: string;
	text: string;
	kind?: string;
	source: "tool" | "compact" | "settled";
	action: string;
	reason?: string;
	grounded?: number;
	derivable?: number;
	importance?: number;
}

export async function appendSessionLog(layout: WikiLayout, entry: Omit<SessionLogEntry, "ts">): Promise<void> {
	try {
		await appendFile(layout.sessionLogPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, "utf8");
	} catch {
		/* session log is best-effort */
	}
}

export async function readSessionLog(layout: WikiLayout): Promise<SessionLogEntry[]> {
	if (!existsSync(layout.sessionLogPath)) return [];
	const text = await readFile(layout.sessionLogPath, "utf8");
	return text
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as SessionLogEntry;
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is SessionLogEntry => Boolean(entry));
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

/** How many prior log entries describe substantially the same candidate. */
export function countRecurrence(entries: SessionLogEntry[], text: string, threshold = 0.7): number {
	const needle = tokens(text);
	return entries.filter((entry) => similarity(tokens(entry.text), needle) >= threshold).length - 1;
}

/**
 * Promote candidates that keep recurring after rejection. A fact that appears in
 * three sessions but never gets filed is usually evidence of a documentation gap
 * or a claim that needs a stronger artifact.
 */
export async function promoteRecurring(layout: WikiLayout, minimum = 3): Promise<number> {
	const entries = await readSessionLog(layout);
	const groups: Array<{ text: string; entries: SessionLogEntry[] }> = [];
	for (const entry of entries) {
		const group = groups.find((candidate) => similarity(tokens(candidate.text), tokens(entry.text)) >= 0.7);
		if (group) group.entries.push(entry);
		else groups.push({ text: entry.text, entries: [entry] });
	}

	let promoted = 0;
	for (const group of groups) {
		if (group.entries.length < minimum) continue;
		const accepted = group.entries.some((entry) => ["file", "reinforce", "file_user_stated"].includes(entry.action));
		if (accepted) continue;
		const latest = group.entries[group.entries.length - 1];
		const alreadyQueued = group.entries.some((entry) => entry.action === "promoted");
		if (alreadyQueued) continue;
		await enqueueReview(layout, {
			kind: "claim_review",
			claimText: latest.text,
			criticality: 0.5,
			reason: `recurred ${group.entries.length} times without filing; needs a stronger artifact or a decision`,
			verdicts: { recurrences: group.entries.length, lastAction: latest.action },
		});
		await appendSessionLog(layout, {
			text: latest.text,
			kind: latest.kind,
			source: latest.source,
			action: "promoted",
			reason: `recurred ${group.entries.length} times`,
		});
		promoted++;
	}
	return promoted;
}
