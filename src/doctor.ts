/**
 * Doctor: cheap, deterministic health checks for configuration, state, and
 * environment. No model calls. Intended to be run before trusting a wiki or
 * after moving it to a new machine/project.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LoadedConfig } from "./config.ts";
import { git, headCommit, isGitRepo } from "./git.ts";
import { readLedger } from "./ledger.ts";
import { readReviews } from "./review.ts";
import { readSyncState } from "./sync.ts";
import { MODEL_PRESETS } from "./vector/embed.ts";
import { readRegistry } from "./vector/registry.ts";
import { listMarkdownFiles, resolveLayout, type WikiLayout } from "./wiki/layout.ts";
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
			checks.push(check("vector registry", "ok", `${registry.wikis.length} registered, ${enabled} enabled; run wiki_index status for index counts`));
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
			const ignored = await git(loaded.cwd, ["check-ignore", "-q", loaded.envFilePath]);
			checks.push(ignored.code === 0 ? check("env gitignored", "ok", ".env is ignored") : check("env gitignored", "fail", `${loaded.envFilePath} is NOT gitignored — the token could be committed`));
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
