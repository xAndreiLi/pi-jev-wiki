/**
 * Embedding-model selection: read which preset is configured, distinguish an
 * explicit choice from the built-in default, and persist the user's choice to
 * the user-level config so every project sees it.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LoadedConfig } from "../config.ts";

export type ModelChoiceSource = "project" | "user" | "default";

export interface ModelChoice {
	model: string;
	source: ModelChoiceSource;
}

export async function configuredModel(configPath: string): Promise<string | undefined> {
	if (!existsSync(configPath)) return undefined;
	try {
		const parsed = JSON.parse(await readFile(configPath, "utf8")) as {
			search?: { vector?: { model?: unknown } };
		};
		const model = parsed.search?.vector?.model;
		return typeof model === "string" && model.trim() ? model.trim() : undefined;
	} catch {
		return undefined;
	}
}

/** Effective model plus where it came from (project > user > built-in default). */
export async function modelChoiceSource(loaded: LoadedConfig): Promise<ModelChoice> {
	const project = await configuredModel(loaded.projectConfigPath);
	if (project) return { model: project, source: "project" };
	const user = await configuredModel(loaded.globalConfigPath);
	if (user) return { model: user, source: "user" };
	return { model: loaded.config.search.vector.model, source: "default" };
}

/** Merge `search.vector.model` into a config file without disturbing other keys. */
export async function writeModelSetting(configPath: string, model: string): Promise<void> {
	let data: Record<string, unknown> = {};
	if (existsSync(configPath)) {
		try {
			data = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
		} catch {
			data = {};
		}
	}
	const search = (typeof data.search === "object" && data.search !== null ? data.search : {}) as Record<string, unknown>;
	const vector = (typeof search.vector === "object" && search.vector !== null ? search.vector : {}) as Record<string, unknown>;
	vector.model = model;
	search.vector = vector;
	data.search = search;
	await mkdir(dirname(configPath), { recursive: true });
	const temp = `${configPath}.tmp`;
	await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	await rename(temp, configPath);
}
