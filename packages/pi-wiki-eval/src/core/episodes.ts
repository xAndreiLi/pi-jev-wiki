/**
 * Segmentation: a task episode runs from one user prompt to the agent settling on it.
 *
 * Pi records no explicit settle marker — no `endTurn` field appears in real sessions — so the
 * boundary is the first assistant message after the prompt whose `stopReason` is anything other
 * than `toolUse`. A second prompt before that boundary closes the previous episode as `steered`,
 * which keeps one long conversation from being reported as a single enormous task.
 *
 * Token and cost accounting comes from the provider's own usage on each assistant message, so an
 * episode's cost is what was actually billed: the system prompt, the accumulating history, the
 * tool results, and any compaction all land in the messages that carry them.
 */
import { classifyMessage, isSearchCall, wikiCallKind, type Bucket, type ClassifyContext } from "./classify.js";
import { contentText, type SessionEntry, type SessionMessage } from "./sessions.js";

export interface EpisodeUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning: number;
	totalTokens: number;
	cost: number;
}

export interface EpisodeToolCall {
	name: string;
	bucket: Bucket;
	detail?: string;
	nested: boolean;
	isError: boolean;
	resultChars: number;
}

export type EndReason = "settled" | "steered" | "interrupted" | "eof";

export interface Episode {
	sessionPath: string;
	index: number;
	openedBy: "user" | "implicit";
	/** Truncated prompt text. Present only when the caller asked for queries. */
	userText?: string;
	userChars: number;
	startedAt?: string;
	endedAt?: string;
	durationMs?: number;
	endReason: EndReason;
	usage: EpisodeUsage;
	requests: number;
	compactions: number;
	toolCalls: EpisodeToolCall[];
	byBucket: Record<Bucket, number>;
	/** Distinct repository files read, in first-read order. */
	readFiles: string[];
	readChars: number;
	searches: number;
	/** Wiki tool calls split by purpose: reading the wiki versus maintaining it. */
	wikiReads: number;
	wikiWrites: number;
	firstActAt?: string;
	errorResults: number;
	/** Non-conversation entries entering context — wiki briefs and other injected messages. */
	injected: { count: number; chars: number };
	/** Provider model identifier → requests, so a mixed-model session is visible. */
	models: Record<string, number>;
}

export interface SegmentOptions {
	/** Include (truncated) prompt text in the result. Off by default: a report should not leak prompts. */
	includeQueries?: boolean;
	queryChars?: number;
}

export function emptyUsage(): EpisodeUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: 0 };
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readUsage(message: SessionMessage | undefined): EpisodeUsage {
	const raw = (message?.usage ?? {}) as Record<string, unknown>;
	const cost = (raw.cost ?? {}) as Record<string, unknown>;
	const usage: EpisodeUsage = {
		input: num(raw.input),
		output: num(raw.output),
		cacheRead: num(raw.cacheRead),
		cacheWrite: num(raw.cacheWrite),
		reasoning: num(raw.reasoning),
		totalTokens: num(raw.totalTokens),
		cost: num(cost.total),
	};
	if (usage.totalTokens === 0) {
		usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	}
	return usage;
}

function addUsage(target: EpisodeUsage, delta: EpisodeUsage): void {
	target.input += delta.input;
	target.output += delta.output;
	target.cacheRead += delta.cacheRead;
	target.cacheWrite += delta.cacheWrite;
	target.reasoning += delta.reasoning;
	target.totalTokens += delta.totalTokens;
	target.cost += delta.cost;
}

function emptyBuckets(): Record<Bucket, number> {
	return { explore: 0, wiki: 0, act: 0, verify: 0, other: 0 };
}

export function segmentEpisodes(
	sessionPath: string,
	entries: SessionEntry[],
	ctx: ClassifyContext,
	options: SegmentOptions = {},
): Episode[] {
	const results = new Map<string, { chars: number; isError: boolean }>();
	for (const entry of entries) {
		const message = entry.message;
		if (entry.type !== "message" || message?.role !== "toolResult") continue;
		const id = message.toolCallId;
		if (!id) continue;
		results.set(id, { chars: contentText(message.content).length, isError: message.isError === true });
	}

	const episodes: Episode[] = [];
	let current: Episode | undefined;

	const open = (openedBy: Episode["openedBy"], entry: SessionEntry, message?: SessionMessage): Episode => {
		const episode: Episode = {
			sessionPath,
			index: episodes.length,
			openedBy,
			userChars: message ? contentText(message.content).length : 0,
			startedAt: entry.timestamp,
			endReason: "eof",
			usage: emptyUsage(),
			requests: 0,
			compactions: 0,
			toolCalls: [],
			byBucket: emptyBuckets(),
			readFiles: [],
			readChars: 0,
			searches: 0,
			wikiReads: 0,
			wikiWrites: 0,
			errorResults: 0,
			injected: { count: 0, chars: 0 },
			models: {},
		};
		if (options.includeQueries && message) {
			const text = contentText(message.content);
			episode.userText = text.length > (options.queryChars ?? 160) ? `${text.slice(0, options.queryChars ?? 160)}…` : text;
		}
		episodes.push(episode);
		return episode;
	};

	const close = (reason: EndReason, at?: string): void => {
		if (!current) return;
		if (current.endReason === "eof") {
			current.endReason = reason;
			if (at) {
				current.endedAt = at;
				if (current.startedAt) {
					const elapsed = Date.parse(at) - Date.parse(current.startedAt);
					if (Number.isFinite(elapsed) && elapsed >= 0) current.durationMs = elapsed;
				}
			}
		}
		current = undefined;
	};

	for (const entry of entries) {
		if (entry.type === "message") {
			const message = entry.message;
			const role = message?.role;
			if (role === "user") {
				close("steered", entry.timestamp);
				current = open("user", entry, message);
				continue;
			}
			if (role === "assistant") {
				if (!current) current = open("implicit", entry);
				addUsage(current.usage, readUsage(message));
				current.requests += 1;
				if (typeof message?.model === "string") current.models[message.model] = (current.models[message.model] ?? 0) + 1;
				for (const call of classifyMessage(message, ctx)) {
					const result = call.id ? results.get(call.id) : undefined;
					const record: EpisodeToolCall = {
						name: call.name,
						bucket: call.bucket,
						nested: call.nested === true,
						isError: result?.isError ?? false,
						resultChars: result?.chars ?? 0,
					};
					if (call.detail) record.detail = call.detail;
					current.toolCalls.push(record);
					current.byBucket[call.bucket] += 1;
					if (call.bucket === "wiki") {
						if (wikiCallKind(call.name) === "read") current.wikiReads += 1;
						else current.wikiWrites += 1;
					}
					if (result?.isError) current.errorResults += 1;
					if (call.bucket === "explore" && call.name.toLowerCase() === "read" && call.detail) {
						if (!current.readFiles.includes(call.detail)) current.readFiles.push(call.detail);
						current.readChars += result?.chars ?? 0;
					}
					if (isSearchCall(call.name, call.bucket, call.detail)) current.searches += 1;
					if (call.bucket === "act" && !current.firstActAt) current.firstActAt = entry.timestamp;
				}
				const stop = typeof message?.stopReason === "string" ? message.stopReason : "stop";
				if (stop !== "toolUse" && stop !== "pending") close(stop === "stop" ? "settled" : "interrupted", entry.timestamp);
				continue;
			}
			continue;
		}
		if (entry.type === "compaction" && current) {
			current.compactions += 1;
			continue;
		}
		if (entry.type === "custom_message" && current) {
			const text = typeof entry.content === "string" ? entry.content : contentText(entry.content);
			current.injected.count += 1;
			current.injected.chars += text.length;
		}
	}
	close("eof");
	return episodes;
}
