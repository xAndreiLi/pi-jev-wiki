/**
 * Decision ledger: every agent, Jev, and code decision with thresholds and outcomes.
 * Newline-delimited JSON at `<wikiRoot>/.jev-wiki/decisions.jsonl`.
 */
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WikiLayout } from "./wiki/layout.ts";

export type LedgerActor = "jev" | "agent" | "code";

export interface LedgerEntry {
	ts: string;
	actor: LedgerActor;
	op: string;
	subject?: string;
	verdict?: unknown;
	thresholds?: unknown;
	action?: string;
	reason?: string;
	evidence?: string[];
	outcome?: string;
	usage?: { input_tokens: number; output_tokens: number; cost?: number };
	[key: string]: unknown;
}

export interface LedgerInput {
	actor: LedgerActor;
	op: string;
	ts?: string;
	subject?: string;
	verdict?: unknown;
	thresholds?: unknown;
	action?: string;
	reason?: string;
	evidence?: string[];
	outcome?: string;
	usage?: { input_tokens: number; output_tokens: number; cost?: number };
	[key: string]: unknown;
}

export async function appendLedger(layout: WikiLayout, entry: LedgerInput): Promise<void> {
	await mkdir(dirname(layout.ledgerPath), { recursive: true });
	const record: LedgerEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry };
	await appendFile(layout.ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readLedger(layout: WikiLayout): Promise<LedgerEntry[]> {
	if (!existsSync(layout.ledgerPath)) return [];
	const text = await readFile(layout.ledgerPath, "utf8");
	return text
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as LedgerEntry;
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is LedgerEntry => Boolean(entry));
}

export function summarizeLedger(entries: LedgerEntry[]): {
	total: number;
	byActor: Record<string, number>;
	jevTokensIn: number;
	jevTokensOut: number;
	jevCost: number;
} {
	const byActor: Record<string, number> = {};
	let jevTokensIn = 0;
	let jevTokensOut = 0;
	let jevCost = 0;
	for (const entry of entries) {
		byActor[entry.actor] = (byActor[entry.actor] ?? 0) + 1;
		if (entry.usage) {
			jevTokensIn += entry.usage.input_tokens ?? 0;
			jevTokensOut += entry.usage.output_tokens ?? 0;
			jevCost += entry.usage.cost ?? 0;
		}
	}
	return { total: entries.length, byActor, jevTokensIn, jevTokensOut, jevCost };
}
