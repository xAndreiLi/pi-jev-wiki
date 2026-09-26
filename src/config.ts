/**
 * Configuration for jev-wiki.
 *
 * Precedence: CLI overrides > process env > project .env > project config > global config > defaults.
 * The API key is resolved from `apiKey` (`$VAR` indirection) with fallbacks to
 * TYPESAFE_API_KEY and JEV_TOKEN.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type WriterMode = "guided" | "draft" | "auto";
export type ReviewMode = "agent" | "human";

export interface ProviderPreset {
	baseUrl: string;
	model: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
	typesafe: { baseUrl: "https://api.typesafe.ai/v1/systemone", model: "jev-latest" },
	openrouter: { baseUrl: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest" },
	aimlapi: { baseUrl: "https://api.aimlapi.com/v1/decisions", model: "typesafe/jev" },
};

export interface JevWikiConfig {
	provider: string;
	baseUrl?: string;
	model?: string;
	apiKey?: string;
	envFile: string;
	wikiRoot: string;
	globalWikiRoot?: string;
	stateRoot: string;
	writer: { mode: WriterMode; model?: string | null };
	routing: { shardSize: number; minFit: number; newPageConfidence: number };
	review: { mode: ReviewMode; autoAcceptUserStated: boolean; escalateCriticality: number; maxPerSession: number };
	sync: { onSessionStart: "off" | "check"; onCommit: boolean; backstopLintDays: number };
	thresholds: {
		autoAccept: number;
		minSupport: number;
		minDerivable: number;
		framingImportance: number;
		minNovelty: number;
		minImportance: number;
	};
	weights: { grounded: number; importance: number; nonDerivable: number; authority: number };
	toc: { maxTokens: number };
	lint: { orphanMinAgeDays: number; duplicateSimilarity: number };
	gitCommit: boolean;
	capture: { onCompact: boolean; onSettle: boolean };
	search: {
		engine: "auto" | "index" | "bm25" | "vector" | "hybrid" | "qmd";
		qmdCollection?: string;
		vector: {
			enabled: boolean;
			db: "embedded";
			url?: string | null;
			model: string;
			dtype?: string | null;
			dimensions?: number | null;
			chunk: { pageSections: boolean; maxTokens: number; overlap: number };
			sync: { onFinalize: boolean };
			fusion: { rrfK: number; candidateMultiplier: number };
			scan: { roots?: string[]; maxDepth: number; wsl: boolean };
		};
	};
}

export interface ResolvedConfig extends Omit<JevWikiConfig, "baseUrl" | "model"> {
	baseUrl: string;
	model: string;
}

export const DEFAULT_CONFIG: JevWikiConfig = {
	provider: "typesafe",
	envFile: ".env",
	wikiRoot: "docs/wiki",
	stateRoot: ".jev-wiki",
	writer: { mode: "guided", model: null },
	routing: { shardSize: 250, minFit: 0.6, newPageConfidence: 0.7 },
	review: { mode: "agent", autoAcceptUserStated: true, escalateCriticality: 0.85, maxPerSession: 10 },
	sync: { onSessionStart: "check", onCommit: false, backstopLintDays: 14 },
	thresholds: { autoAccept: 0.8, minSupport: 0.7, minDerivable: 0.5, framingImportance: 0.6, minNovelty: 0.6, minImportance: 1 },
	weights: { grounded: 0.45, importance: 0.25, nonDerivable: 0.2, authority: 0.1 },
	toc: { maxTokens: 3000 },
	lint: { orphanMinAgeDays: 7, duplicateSimilarity: 0.72 },
	gitCommit: false,
	capture: { onCompact: false, onSettle: false },
	search: {
		engine: "auto",
		vector: {
			enabled: true,
			db: "embedded",
			model: "performance",
			chunk: { pageSections: true, maxTokens: 1200, overlap: 160 },
			sync: { onFinalize: true },
			fusion: { rrfK: 60, candidateMultiplier: 3 },
			scan: { maxDepth: 6, wsl: true },
		},
	},
};

export interface LoadedConfig {
	cwd: string;
	agentDir: string;
	projectConfigPath: string;
	globalConfigPath: string;
	envFilePath: string;
	env: Record<string, string>;
	config: ResolvedConfig;
	apiKey?: string;
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function parseEnvFile(text: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key) env[key] = value;
	}
	return env;
}

function deepMerge<T>(base: T, patch: unknown): T {
	if (patch === undefined || patch === null) return base;
	if (Array.isArray(base) || typeof base !== "object") return patch as T;
	if (typeof patch !== "object" || Array.isArray(patch)) return patch as T;
	const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
		out[key] = deepMerge((base as Record<string, unknown>)[key], value);
	}
	return out as T;
}

function resolveEnvValue(value: string | undefined, env: Record<string, string>): string | undefined {
	if (!value) return undefined;
	if (!value.startsWith("$")) return value;
	const name = value.slice(1);
	return process.env[name] ?? env[name];
}

export function loadConfig(cwd: string, overrides?: Partial<JevWikiConfig>): LoadedConfig {
	const agentDir = getAgentDir();
	const globalConfigPath = join(agentDir, "jev-wiki.json");
	const projectConfigPath = join(cwd, CONFIG_DIR_NAME, "jev-wiki.json");

	const globalFile = readJson(globalConfigPath) ?? {};
	const projectFile = readJson(projectConfigPath) ?? {};

	let merged = deepMerge(DEFAULT_CONFIG, globalFile);
	merged = deepMerge(merged, projectFile);
	if (overrides) merged = deepMerge(merged, overrides);

	const envFilePath = resolve(cwd, merged.envFile);
	const env = existsSync(envFilePath) ? parseEnvFile(readFileSync(envFilePath, "utf8")) : {};

	const preset = PROVIDER_PRESETS[merged.provider] ?? PROVIDER_PRESETS.typesafe;
	const resolved: ResolvedConfig = {
		...merged,
		baseUrl: merged.baseUrl ?? preset.baseUrl,
		model: merged.model ?? preset.model,
	};

	const configured = resolveEnvValue(merged.apiKey, env);
	const providerVars: Record<string, string[]> = {
		typesafe: ["TYPESAFE_API_KEY", "JEV_TOKEN"],
		openrouter: ["OPENROUTER_API_KEY", "JEV_TOKEN", "TYPESAFE_API_KEY"],
		aimlapi: ["AIMLAPI_API_KEY", "JEV_TOKEN"],
	};
	const candidates = providerVars[merged.provider] ?? ["JEV_TOKEN", "TYPESAFE_API_KEY", "OPENROUTER_API_KEY"];
	let apiKey = configured;
	for (const name of candidates) {
		apiKey ??= process.env[name] ?? env[name];
	}
	apiKey ??= env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;

	return { cwd, agentDir, projectConfigPath, globalConfigPath, envFilePath, env, config: resolved, apiKey };
}
