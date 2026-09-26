/**
 * Doctor: cheap, deterministic health checks for configuration, state, and
 * environment. No model calls. Intended to be run before trusting a wiki or
 * after moving it to a new machine/project.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LoadedConfig } from "./config.ts";
import { git, headCommit, isGitRepo } from "./git.ts";
import { readLedger } from "./ledger.ts";
import { readReviews } from "./review.ts";
import { readSyncState } from "./sync.ts";
import { MODEL_PRESETS, modelsDir } from "./vector/embed.ts";
import { modelsCacheBytes } from "./vector/index.ts";
import { readRegistry } from "./vector/registry.ts";
import { listMarkdownFiles, readPage, resolveLayout, sha256Hex, type WikiLayout } from "./wiki/layout.ts";
import { isLocked } from "./wiki/lock.ts";

const run = promisify(execFile);

export interface DoctorCheck {
	name: string;
	status: "ok" | "warn" | "fail";
	detail: string;
}

export interface DoctorReport {
	checks: DoctorCheck[];
	summary: { ok: number; warn: number; fail: number };
}

function check(name: string, status: DoctorCheck["status"], detail: string): DoctorCheck {
	return { name, status, detail };
}

export interface RawIntegrityReport {
	total: number;
	missing: string[];
	drifted: string[];
}

/** Re-hash every indexed raw source against the recorded key in `.jev-wiki/raw-index.json`. */
export async function verifyRawSources(layout: WikiLayout): Promise<RawIntegrityReport> {
	const report: RawIntegrityReport = { total: 0, missing: [], drifted: [] };
	const indexPath = join(layout.stateDir, "raw-index.json");
	if (!existsSync(indexPath)) return report;
	let index: Record<string, string>;
	try {
		index = JSON.parse(await readFile(indexPath, "utf8")) as Record<string, string>;
	} catch {
		return report;
	}
	const entries = Object.entries(index);
	report.total = entries.length;
	for (const [hash, rel] of entries) {
		const abs = join(layout.root, String(rel));
		if (!existsSync(abs)) {
			report.missing.push(String(rel));
			continue;
		}
		try {
			const page = await readPage(abs);
			// Reverse the serializer: it inserts one blank line after the frontmatter and trims
			// trailing whitespace before appending a final newline, while the recorded key was taken
			// from the text as read. Accept the exact form and the trailing-trimmed form.
			const raw = page.body.replace(/^\n/, "");
			const exact = await sha256Hex(raw);
			const trimmed = exact === hash ? exact : await sha256Hex(raw.trimEnd());
			if (trimmed !== hash) report.drifted.push(String(rel));
		} catch {
			report.drifted.push(String(rel));
		}
	}
	return report;
}

/** Atomic-write temp files (`*.tmp-<pid>-<ms>`) left behind by an interrupted rename. */
export async function findStaleTempFiles(root: string, olderThanMs = 10 * 60_000): Promise<string[]> {
	const cutoff = Date.now() - olderThanMs;
	const found: string[] = [];
	const skip = new Set([".git", "node_modules", "models"]);
	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > 6 || found.length > 20) return;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (skip.has(entry.name)) continue;
				await walk(join(dir, entry.name), depth + 1);
				continue;
			}
			if (!entry.name.includes(".tmp-")) continue;
			const info = await stat(join(dir, entry.name)).catch(() => undefined);
			if (info && info.mtimeMs < cutoff) found.push(join(dir, entry.name));
		}
	}
	await walk(root, 0);
	return found;
}

function within(value: number, min: number, max: number): boolean {
	return Number.isFinite(value) && value >= min && value <= max;
}

export async function runDoctor(loaded: LoadedConfig): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];
	const { config } = loaded;
	const layout = resolveLayout(loaded.cwd, config.wikiRoot, config.stateRoot);

	// --- configuration --------------------------------------------------------
	const invalid: string[] = [];
	for (const key of ["autoAccept", "minSupport", "minDerivable", "minNovelty"] as const) {
		if (!within(config.thresholds[key], 0, 1)) invalid.push(`thresholds.${key}=${config.thresholds[key]}`);
	}
	if (config.thresholds.minImportance < 0 || config.thresholds.minImportance > 3) invalid.push(`thresholds.minImportance=${config.thresholds.minImportance}`);
	if (!within(config.routing.minFit, 0, 1)) invalid.push(`routing.minFit=${config.routing.minFit}`);
	if (!within(config.routing.newPageConfidence, 0, 1)) invalid.push(`routing.newPageConfidence=${config.routing.newPageConfidence}`);
	if (!within(config.review.escalateCriticality, 0, 1)) invalid.push(`review.escalateCriticality=${config.review.escalateCriticality}`);
	if (!within(config.lint.duplicateSimilarity, 0, 1)) invalid.push(`lint.duplicateSimilarity=${config.lint.duplicateSimilarity}`);
	if (config.routing.shardSize < 10 || config.routing.shardSize > 255) invalid.push(`routing.shardSize=${config.routing.shardSize} (must be 10..255)`);
	if (!["manual", "task", "commit"].includes(config.capture.cadence ?? "manual")) invalid.push(`capture.cadence=${config.capture.cadence}`);
	if (config.capture.route !== undefined && !["session", "subject"].includes(config.capture.route)) invalid.push(`capture.route=${config.capture.route}`);
	if (!["auto", "always", "never"].includes(config.search.jev.rerank)) invalid.push(`search.jev.rerank=${config.search.jev.rerank}`);
	if (!within(config.search.jev.minSufficiency, 0, 1)) invalid.push(`search.jev.minSufficiency=${config.search.jev.minSufficiency}`);
	if (config.search.jev.maxCandidates < 1 || config.search.jev.maxCandidates > 50) invalid.push(`search.jev.maxCandidates=${config.search.jev.maxCandidates} (1..50)`);
	if (!["auto", "index", "bm25", "vector", "hybrid", "qmd"].includes(config.search.engine)) invalid.push(`search.engine=${config.search.engine}`);
	if (!MODEL_PRESETS[config.search.vector.model]) invalid.push(`search.vector.model=${config.search.vector.model} (presets: ${Object.keys(MODEL_PRESETS).join(", ")})`);
	if (config.search.vector.db !== "embedded") invalid.push(`search.vector.db=${config.search.vector.db} (only "embedded" is supported in P1)`);
	if (config.search.vector.dimensions != null) {
		const dimensions = config.search.vector.dimensions;
		const max = MODEL_PRESETS[config.search.vector.model]?.dimensions ?? 0;
		if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > max) invalid.push(`search.vector.dimensions=${dimensions} (1..${max})`);
	}
	checks.push(
		invalid.length === 0
			? check("config values", "ok", `provider ${config.provider}, writer ${config.writer.mode}, shard ${config.routing.shardSize}`)
			: check("config values", "fail", `invalid: ${invalid.join(", ")}`),
	);

	let urlValid = false;
	try {
		const url = new URL(config.baseUrl);
		urlValid = url.protocol === "https:" || url.protocol === "http:";
	} catch {
		urlValid = false;
	}
	checks.push(urlValid ? check("endpoint", "ok", config.baseUrl) : check("endpoint", "fail", `not a valid URL: ${config.baseUrl}`));
	checks.push(
		loaded.apiKey
			? check("api key", "ok", `configured (${loaded.apiKey.slice(0, 5)}…, ${loaded.envFilePath})`)
			: check(
					"api key",
					"fail",
					`missing; run wiki_setup action=guide provider=typesafe|openrouter — or add TYPESAFE_API_KEY / OPENROUTER_API_KEY / JEV_TOKEN to ${loaded.envFilePath}`,
				),
	);
	checks.push(
		existsSync(loaded.envFilePath)
			? check("env file", "ok", loaded.envFilePath)
			: check("env file", "warn", `not found: ${loaded.envFilePath}`),
	);
	if (config.search.vector.enabled) {
		try {
			const registry = await readRegistry(loaded.agentDir);
			const enabled = registry.wikis.filter((entry) => entry.enabled).length;
			const cachedBytes = await modelsCacheBytes(modelsDir(loaded.agentDir));
			checks.push(
				check(
					"vector registry",
					"ok",
					`${registry.wikis.length} registered, ${enabled} enabled; model cache ${cachedBytes > 0 ? `~${Math.round(cachedBytes / 1_000_000)} MB` : "empty"}; run wiki_index status for index counts`,
				),
			);
		} catch (error) {
			checks.push(check("vector registry", "warn", `unreadable: ${(error as Error).message}`));
		}
	} else {
		checks.push(check("vector registry", "ok", "semantic search disabled"));
	}
	if (config.globalWikiRoot) {
		const vaultRoot = isAbsolute(config.globalWikiRoot) ? config.globalWikiRoot : join(loaded.agentDir, config.globalWikiRoot);
		const vault = resolveLayout(vaultRoot, ".", config.stateRoot);
		checks.push(
			existsSync(vault.wikiDir)
				? check("global vault", "ok", `${vault.root} (read-only cross-project search)`)
				: check("global vault", "warn", `globalWikiRoot is set but no pages found at ${vault.wikiDir}`),
		);
	} else {
		checks.push(check("global vault", "ok", "not configured (optional cross-project search)"));
	}

	// --- layout and state -----------------------------------------------------
	checks.push(
		existsSync(layout.root)
			? check("wiki root", "ok", layout.root)
			: check("wiki root", "warn", `does not exist yet (created on first ingest): ${layout.root}`),
	);
	if (existsSync(layout.wikiDir)) {
		const pages = (await listMarkdownFiles(layout.wikiDir)).length;
		checks.push(check("wiki pages", "ok", `${pages} page file(s); index ${existsSync(`${layout.wikiDir}/index.md`) ? "present" : "MISSING"}, toc ${existsSync(`${layout.wikiDir}/toc.md`) ? "present" : "missing"}`));
	}
	const lock = await isLocked(layout);
	if (lock.locked) {
		checks.push(lock.stale ? check("wiki lock", "warn", `stale lock (${Math.round((lock.ageMs ?? 0) / 1000)}s old); next mutation takes it over`) : check("wiki lock", "warn", `held by another session (${Math.round((lock.ageMs ?? 0) / 1000)}s)`));
	} else {
		checks.push(check("wiki lock", "ok", "free"));
	}

	// --- ledger and queue -----------------------------------------------------
	if (existsSync(layout.ledgerPath)) {
		let bad = 0;
		const lines = (await readFile(layout.ledgerPath, "utf8")).split(/\r?\n/).filter(Boolean);
		for (const line of lines) {
			try {
				JSON.parse(line);
			} catch {
				bad++;
			}
		}
		checks.push(bad === 0 ? check("ledger", "ok", `${lines.length} entries, all parse`) : check("ledger", "warn", `${bad} unparsable line(s) of ${lines.length}`));
	} else {
		checks.push(check("ledger", "ok", "no ledger yet"));
	}
	const reviews = await readReviews(layout);
	const open = reviews.filter((item) => item.status === "open");
	if (open.length > 10) {
		const oldest = open.reduce((oldestDate, item) => (item.ts < oldestDate ? item.ts : oldestDate), open[0].ts);
		checks.push(check("review queue", "warn", `${open.length} open items; oldest ${oldest.slice(0, 10)} — consider /wiki:review`));
	} else {
		checks.push(check("review queue", "ok", `${open.length} open item(s)`));
	}

	// --- raw source integrity -------------------------------------------------
	const raw = await verifyRawSources(layout);
	if (raw.total === 0) {
		checks.push(check("raw sources", "ok", "no indexed raw sources yet"));
	} else if (raw.missing.length === 0 && raw.drifted.length === 0) {
		checks.push(check("raw sources", "ok", `${raw.total} indexed; all content hashes match`));
	} else {
		const parts: string[] = [];
		if (raw.missing.length) parts.push(`${raw.missing.length} missing file(s): ${raw.missing.slice(0, 3).join(", ")}`);
		if (raw.drifted.length) parts.push(`${raw.drifted.length} hash mismatch(es): ${raw.drifted.slice(0, 3).join(", ")}`);
		checks.push(check("raw sources", "warn", parts.join("; ")));
	}
	const staleTemps = await findStaleTempFiles(layout.root);
	checks.push(
		staleTemps.length === 0
			? check("write temp files", "ok", "no stale atomic-write files")
			: check("write temp files", "warn", `${staleTemps.length} stale *.tmp-* file(s), e.g. ${staleTemps.slice(0, 2).join(", ")} — safe to delete once no writer is active`),
	);

	// --- git and sync ---------------------------------------------------------
	if (await isGitRepo(loaded.cwd)) {
		const head = await headCommit(loaded.cwd);
		const state = await readSyncState(layout);
		if (!state.lastSyncCommit) {
			checks.push(check("sync baseline", "warn", `not initialized; run wiki_sync to set it at ${head?.slice(0, 7)}`));
		} else if (state.lastSyncCommit === head) {
			checks.push(check("sync baseline", "ok", `current at ${head?.slice(0, 7)}`));
		} else {
			const behind = await git(loaded.cwd, ["rev-list", "--count", `${state.lastSyncCommit}..HEAD`]);
			checks.push(check("sync baseline", "warn", `${behind.stdout.trim() || "?"} commit(s) behind; run /wiki:sync`));
		}
		if (existsSync(loaded.envFilePath)) {
			const rel = relative(loaded.cwd, loaded.envFilePath);
			if (rel.startsWith("..") || isAbsolute(rel)) {
				checks.push(check("env gitignored", "ok", `${loaded.envFilePath} is outside the repository`));
			} else {
				const ignored = await git(loaded.cwd, ["check-ignore", "-q", loaded.envFilePath]);
				checks.push(ignored.code === 0 ? check("env gitignored", "ok", ".env is ignored") : check("env gitignored", "fail", `${loaded.envFilePath} is NOT gitignored — the token could be committed`));
			}
		}
	} else {
		checks.push(check("git", "warn", "not a repository; change-driven sync and commits are unavailable"));
	}

	// --- search ---------------------------------------------------------------
	if (config.search.engine === "qmd") {
		try {
			await run("qmd", ["--version"], { timeout: 5000 });
			checks.push(check("search engine", "ok", "qmd available"));
		} catch {
			checks.push(check("search engine", "warn", "search.engine=qmd but the qmd binary is not available; BM25 fallback will be used"));
		}
	} else {
		checks.push(check("search engine", "ok", config.search.engine));
	}

	const summary = {
		ok: checks.filter((item) => item.status === "ok").length,
		warn: checks.filter((item) => item.status === "warn").length,
		fail: checks.filter((item) => item.status === "fail").length,
	};
	return { checks, summary };
}

export function renderDoctor(report: DoctorReport): string {
	const icon = { ok: "✅", warn: "⚠️", fail: "❌" } as const;
	const lines = [`# Wiki doctor — ${report.summary.ok} ok · ${report.summary.warn} warn · ${report.summary.fail} fail`, ""];
	for (const item of report.checks) lines.push(`${icon[item.status]} **${item.name}** — ${item.detail}`);
	return lines.join("\n");
}
