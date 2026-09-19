/** Consultation metrics: how often the wiki is actually used, and for what. */
import { existsSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WikiLayout } from "./wiki/layout.ts";

export interface MetricEntry {
	ts: string;
	op: "toc" | "ask" | "sync" | "review" | "lint";
	query?: string;
	pages?: string[];
	detail?: unknown;
}

export function metricsPath(layout: WikiLayout): string {
	return join(layout.stateDir, "metrics.jsonl");
}

export async function recordMetric(layout: WikiLayout, entry: Omit<MetricEntry, "ts">): Promise<void> {
	try {
		await appendFile(metricsPath(layout), `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, "utf8");
	} catch {
		/* metrics are best-effort */
	}
}

export async function readMetrics(layout: WikiLayout): Promise<MetricEntry[]> {
	if (!existsSync(metricsPath(layout))) return [];
	const text = await readFile(metricsPath(layout), "utf8");
	return text
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as MetricEntry;
			} catch {
				return undefined;
			}
		})
		.filter((entry): entry is MetricEntry => Boolean(entry));
}

export function summarizeMetrics(entries: MetricEntry[]): {
	consultations: number;
	searches: number;
	pagesReturned: Set<string>;
	recentQueries: string[];
} {
	const pagesReturned = new Set<string>();
	const queries: string[] = [];
	for (const entry of entries) {
		for (const page of entry.pages ?? []) pagesReturned.add(page);
		if (entry.op === "ask" && entry.query) queries.push(entry.query);
	}
	return {
		consultations: entries.filter((entry) => entry.op === "toc" || entry.op === "ask").length,
		searches: entries.filter((entry) => entry.op === "ask").length,
		pagesReturned,
		recentQueries: queries.slice(-5),
	};
}
