/**
 * Cross-wiki catalog: a derived, read-only view over the registry, per-wiki TOC
 * manifests, and index state. Bounded (concurrency + timeout), paged, and
 * failure-isolated — one unreachable wiki never breaks the catalog.
 */
import { existsSync } from "node:fs";
import { mapLimit } from "../jev.ts";
import { resolveLayout } from "../wiki/layout.ts";
import { countPages, newestPageMtime, readManifest } from "../wiki/manifest.ts";
import { readIndex } from "../wiki/toc.ts";
import type { WikiRegistration } from "./registry.ts";

export interface CatalogWikiState {
	chunks: number;
	model: string;
	updatedAt: string;
}

export interface CatalogEntry {
	name: string;
	root: string;
	enabled: boolean;
	pages: number;
	topics: Array<{ slug: string; count: number }>;
	chunks?: number;
	model?: string;
	indexUpdatedAt?: string;
	tocGeneratedAt?: string;
	flags: string[];
}

export interface CatalogOptions {
	registry: WikiRegistration[];
	states: Map<string, CatalogWikiState>;
	stateRoot: string;
	/** Configured embedding preset, used to flag indexes built with another model. */
	model: string;
	limit?: number;
	offset?: number;
	timeoutMs?: number;
}

export interface CatalogResult {
	entries: CatalogEntry[];
	total: number;
	limit: number;
	offset: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 750;

export async function buildCatalog(options: CatalogOptions): Promise<CatalogResult> {
	const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
	const offset = Math.max(0, options.offset ?? 0);
	const entries = await mapLimit(options.registry, 4, (registration) =>
		describeWiki(registration, options).catch(
			(): CatalogEntry => ({
				name: registration.name,
				root: registration.root,
				enabled: registration.enabled,
				pages: 0,
				topics: [],
				flags: ["unreachable"],
			}),
		),
	);
	entries.sort((a, b) => {
		const recencyA = a.indexUpdatedAt ?? a.tocGeneratedAt ?? "";
		const recencyB = b.indexUpdatedAt ?? b.tocGeneratedAt ?? "";
		if (recencyA !== recencyB) return recencyB.localeCompare(recencyA);
		return a.name.localeCompare(b.name);
	});
	return { entries: entries.slice(offset, offset + limit), total: entries.length, limit, offset };
}

async function describeWiki(registration: WikiRegistration, options: CatalogOptions): Promise<CatalogEntry> {
	const root = registration.root;
	const base: CatalogEntry = {
		name: registration.name,
		root,
		enabled: registration.enabled,
		pages: 0,
		topics: [],
		flags: [],
	};
	if (!existsSync(root)) return { ...base, flags: ["root-missing"] };

	const layout = resolveLayout(root, ".", options.stateRoot);
	const work = (async (): Promise<CatalogEntry> => {
		const manifest = await readManifest(layout).catch(() => undefined);
		let pages = manifest?.pages ?? 0;
		let topics = manifest?.topics ?? [];
		if (!manifest) {
			pages = await countPages(layout).catch(() => 0);
			topics = await readIndex(layout)
				.then((entries) => {
					const counts = new Map<string, number>();
					for (const entry of entries) {
						const topic = entry.path.includes("/") ? entry.path.split("/")[0] : "general";
						counts.set(topic, (counts.get(topic) ?? 0) + 1);
					}
					return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([slug, count]) => ({ slug, count }));
				})
				.catch(() => []);
		}
		const state = options.states.get(registration.name);
		const currentNewest = await newestPageMtime(layout).catch(() => undefined);
		const flags: string[] = [];
		if (!manifest) flags.push("manifest-missing");
		if (!registration.enabled) flags.push("disabled");
		if (pages === 0 && !state?.chunks) flags.push("empty");
		if (!state || state.chunks === 0) flags.push("never-indexed");
		if (state && state.model !== options.model) flags.push("model-mismatch");
		if (manifest && currentNewest && manifest.generatedAt < currentNewest) flags.push("toc-stale");
		if (state?.updatedAt && currentNewest && state.updatedAt < currentNewest) flags.push("index-stale");
		return {
			...base,
			pages,
			topics,
			...(state ? { chunks: state.chunks, model: state.model, indexUpdatedAt: state.updatedAt } : {}),
			...(manifest ? { tocGeneratedAt: manifest.generatedAt } : {}),
			flags,
		};
	})();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timeout = new Promise<CatalogEntry>((resolve) => {
		const timer = setTimeout(() => resolve({ ...base, flags: ["unreachable"] } as CatalogEntry), timeoutMs);
		timer.unref?.();
	});
	return Promise.race([work, timeout]);
}

/** Compact, budget-bounded rendering of a catalog page. */
export function renderCatalog(result: CatalogResult, configuredModel: string): string {
	const from = result.total === 0 ? 0 : result.offset + 1;
	const to = result.offset + result.entries.length;
	const lines = [`# Wiki catalog — ${result.total} wiki(s)${result.total > 0 ? ` (showing ${from}–${to})` : ""}`, ""];
	for (const entry of result.entries) {
		const topicText = entry.topics.length > 0
			? ` (${entry.topics.slice(0, 3).map((topic) => `${topic.slug} ${topic.count}`).join(", ")}${entry.topics.length > 3 ? `, +${entry.topics.length - 3}` : ""})`
			: "";
		const index = entry.chunks !== undefined ? `${entry.chunks} chunks · ${entry.model ?? "?"}` : "not indexed";
		const updated = entry.indexUpdatedAt ? ` · updated ${entry.indexUpdatedAt.slice(0, 16).replace("T", " ")}` : "";
		const flags = entry.flags.length > 0 ? ` — ${entry.flags.join(", ")}` : "";
		lines.push(`- **${entry.name}** — ${entry.pages} pages${topicText} · ${index}${updated} — ${entry.root}${flags}`);
	}
	if (result.total > to) {
		lines.push("", `Showing ${to} of ${result.total}. Use offset/page to list more.`);
	}
	if (result.entries.some((entry) => entry.flags.includes("model-mismatch"))) {
		lines.push("", `Some indexes were built with another model; configured preset is \`${configuredModel}\`. Run wiki_index action=rebuild all=true.`);
	}
	return lines.join("\n");
}
