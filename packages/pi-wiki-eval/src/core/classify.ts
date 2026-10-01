/**
 * Tool taxonomy: what did the agent spend its calls on?
 *
 * The buckets answer one question — codebase discovery versus wiki consultation versus doing the
 * work — so they are deliberately coarse. A call inside a codemode script counts as the call it
 * really was: pi records nested calls with their names and arguments on the invoking tool result.
 *
 * Classification is rule-based and never calls a model: it must be identical for the wiki-on and
 * wiki-off arms, and it must be cheap enough to run over a year of history.
 */
import { nestedCallsOf, type SessionMessage, type ToolCallBlock } from "./sessions.js";

export type Bucket = "explore" | "wiki" | "act" | "verify" | "other";

export interface ClassifyContext {
	/** Absolute wiki roots for the project (conventionally `<project>/docs/wiki`). */
	wikiRoots: string[];
}

export interface Classification {
	bucket: Bucket;
	/** The path or command that decided the bucket, for the report's drill-down. */
	detail?: string;
	/** True when the call came from inside a codemode script rather than the top level. */
	nested?: boolean;
}

export type WikiCallKind = "read" | "write";

/**
 * Consultation versus upkeep. Filing a capture, working the review queue, and syncing claims are
 * wiki *maintenance*: they cost calls and context without answering a question. Counting them as
 * consultation makes a project that files a lot look like a project that reads a lot.
 */
const WIKI_READ_TOOLS = new Set(["wiki_ask", "wiki_toc", "wiki_status", "wiki_doctor"]);

export function isWikiCall(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.startsWith("wiki_") || lower.startsWith("jev_");
}

/** Unknown `wiki_*` tools count as writes: better to under-report consultation than to inflate it. */
export function wikiCallKind(name: string): WikiCallKind {
	return WIKI_READ_TOOLS.has(name.toLowerCase()) ? "read" : "write";
}

const READ_TOOLS = new Set(["read", "ls", "grep", "find", "glob", "search", "cat"]);
const ACT_TOOLS = new Set(["edit", "write", "multiedit", "applypatch", "patch"]);
const COMMAND_TOOLS = new Set(["bash", "powershell", "shell", "exec", "sh"]);

/** Commands that read the repository or its history. */
const EXPLORE_COMMANDS = new Set([
	"rg", "grep", "ag", "ack", "ugrep", "find", "fd", "fzf", "ls", "dir", "tree",
	"cat", "bat", "head", "tail", "less", "more", "sed", "awk", "wc", "file", "stat",
	"du", "strings", "jq", "yq", "diff", "sort", "uniq", "cut", "tr", "type", "which",
]);

/** Commands that check the work rather than explore it. */
const VERIFY_COMMANDS = new Set(["tsc", "eslint", "ruff", "mypy", "pytest", "vitest", "jest", "mocha", "phpunit", "clippy", "golangci-lint"]);

const VERIFY_PATTERNS: RegExp[] = [
	/^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|tests|lint|typecheck|check|verify)\b/,
	/^(cargo|go|dotnet|gradle|mvn|make)\s+\w*(test|check|clippy|vet|verify)/,
	/^python3?\s+-m\s+(pytest|unittest|mypy)/,
];

const INSTALL_PATTERNS: RegExp[] = [/^(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b/, /^(pip|pip3|poetry|uv)\s+(install|add|sync)\b/];

const GIT_READ = /^git\s+(diff|status|log|show|blame|grep|ls-files|rev-parse|shortlog|describe|remote|tag|branch|stash\s+list)\b/;
const GIT_WRITE = /^git\s+(add|commit|tag\s+-|push|pull|merge|rebase|checkout|switch|restore|reset|revert|stash|rm|mv|cherry-pick|apply|am|clean)\b/;

/** String values that look like paths, collected from an arbitrary arguments object. */
export function collectPathStrings(args: unknown, depth = 0): string[] {
	if (depth > 3 || args === null || args === undefined) return [];
	if (typeof args === "string") return looksLikePath(args) ? [args] : [];
	if (Array.isArray(args)) return args.flatMap((item) => collectPathStrings(item, depth + 1));
	if (typeof args !== "object") return [];
	const out: string[] = [];
	for (const value of Object.values(args as Record<string, unknown>)) out.push(...collectPathStrings(value, depth + 1));
	return out;
}

function looksLikePath(value: string): boolean {
	if (value.length > 400 || value.includes("\n")) return false;
	return /[\\/]/.test(value) || /\.[a-z0-9]{1,6}$/i.test(value);
}

export function normalizePathish(value: string): string {
	return value.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

/** True when a path or command string names something inside one of the wiki roots. */
export function mentionsWiki(value: string, wikiRoots: string[]): boolean {
	const target = normalizePathish(value).toLowerCase();
	for (const root of wikiRoots) {
		const wanted = normalizePathish(root).toLowerCase();
		if (!wanted) continue;
		if (target.includes(wanted)) return true;
		// Tool arguments are often relative to a subdirectory or to the project, while the root is
		// absolute, so try the root's trailing segments (`proj/docs/wiki` → `docs/wiki`).
		const segments = wanted.split("/").filter(Boolean);
		for (let take = segments.length - 1; take >= 2; take -= 1) {
			const suffix = segments.slice(-take).join("/");
			if (target.startsWith(`${suffix}/`) || target.includes(`/${suffix}/`)) return true;
		}
	}
	return false;
}

/** First token of every command segment (`a && b | c` → a, b, c). */
export function commandHeads(command: string): string[] {
	return command
		.split(/\n|&&|\|\||;|\|/)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

/** Runners that wrap the real command: `npx tsc`, `sudo rg`, `pnpm dlx vitest`. */
const WRAPPERS = new Set(["sudo", "command", "time", "nice", "xargs", "env", "npx", "bunx", "uvx", "corepack", "dlx", "doas"]);

/** The effective command tokens of a segment: env assignments and wrappers removed. */
function effectiveTokens(segment: string): string[] {
	const tokens = segment.split(/\s+/).filter(Boolean).filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
	let index = 0;
	while (index < tokens.length && WRAPPERS.has((tokens[index] ?? "").replace(/^.*[\\/]/, "").toLowerCase())) index += 1;
	return tokens.slice(index);
}

function commandBucket(command: string, ctx: ClassifyContext): Classification {
	if (!command.trim()) return { bucket: "other" };
	if (mentionsWiki(command, ctx.wikiRoots)) return { bucket: "wiki", detail: command.slice(0, 120) };
	for (const segment of commandHeads(command)) {
		const head = effectiveTokens(segment)[0]?.replace(/^.*[\\/]/, "").toLowerCase() ?? "";
		if (!head) continue;
		if (head === "git") {
			if (GIT_WRITE.test(segment)) return { bucket: "act", detail: segment.slice(0, 120) };
			if (GIT_READ.test(segment)) return { bucket: "explore", detail: segment.slice(0, 120) };
			return { bucket: "other", detail: segment.slice(0, 120) };
		}
		if (VERIFY_COMMANDS.has(head) || VERIFY_PATTERNS.some((pattern) => pattern.test(segment))) {
			return { bucket: "verify", detail: segment.slice(0, 120) };
		}
		if (INSTALL_PATTERNS.some((pattern) => pattern.test(segment))) return { bucket: "other", detail: segment.slice(0, 120) };
		if (EXPLORE_COMMANDS.has(head)) return { bucket: "explore", detail: segment.slice(0, 120) };
	}
	return { bucket: "other", detail: command.slice(0, 120) };
}

export function classifyToolCall(name: string, args: unknown, ctx: ClassifyContext): Classification {
	if (isWikiCall(name)) return { bucket: "wiki" };
	const lower = name.toLowerCase();
	const paths = collectPathStrings(args);
	const inWiki = paths.some((path) => mentionsWiki(path, ctx.wikiRoots));
	if (READ_TOOLS.has(lower)) return { bucket: inWiki ? "wiki" : "explore", detail: paths[0] };
	if (ACT_TOOLS.has(lower)) return { bucket: inWiki ? "wiki" : "act", detail: paths[0] };
	if (COMMAND_TOOLS.has(lower)) {
		const command = typeof (args as { command?: unknown } | undefined)?.command === "string" ? (args as { command: string }).command : "";
		return commandBucket(command, ctx);
	}
	return { bucket: "other" };
}

export interface ClassifiedCall extends Classification {
	name: string;
	/** Tool call id, so the caller can attach the matching result's size and error state. */
	id?: string;
}

const SEARCH_COMMAND = /^\s*\(?(?:\w+=\S+\s+)*(rg|grep|ag|ack|find|fd|git\s+(grep|log|show|diff|ls-files))/i;

/**
 * Did this call look something up? Both spellings count: the `grep` tool, and `rg`/`find` driven
 * through a shell. Counting only the built-in tool under-reports badly for a shells-first agent.
 */
export function isSearchCall(name: string, bucket: Bucket, detail?: string): boolean {
	if (bucket !== "explore") return false;
	const lower = name.toLowerCase();
	if (lower === "grep" || lower === "find" || lower === "search" || lower === "glob") return true;
	if (COMMAND_TOOLS.has(lower) && detail) return SEARCH_COMMAND.test(detail);
	return false;
}

/**
 * Every tool call in a message, top level and nested. Nested calls are flattened into the same
 * stream: a `read` inside codemode is a `read`, and counting only the `codemode` call would hide
 * most of a codemode-heavy session's discovery work.
 */
export function classifyMessage(message: SessionMessage | undefined, ctx: ClassifyContext): ClassifiedCall[] {
	const out: ClassifiedCall[] = [];
	const nested = nestedCallsOf(message);
	const claimed = new Set<string>();
	for (const call of topLevelCalls(message)) {
		const name = call.name ?? "unknown";
		out.push({ name, ...classifyToolCall(name, call.arguments, ctx), nested: false, ...(call.id ? { id: call.id } : {}) });
		if (!call.id) continue;
		for (const inner of nested) {
			if (!inner.id || claimed.has(inner.id) || !inner.id.startsWith(`${call.id}/`)) continue;
			claimed.add(inner.id);
			const innerName = inner.name ?? "unknown";
			out.push({ name: innerName, ...classifyToolCall(innerName, inner.arguments, ctx), nested: true, ...(inner.id ? { id: inner.id } : {}) });
		}
	}
	// A nested record whose parent call is no longer on this message still describes real work.
	for (const inner of nested) {
		if (inner.id && claimed.has(inner.id)) continue;
		const innerName = inner.name ?? "unknown";
		out.push({ name: innerName, ...classifyToolCall(innerName, inner.arguments, ctx), nested: true, ...(inner.id ? { id: inner.id } : {}) });
	}
	return out;
}

function topLevelCalls(message: SessionMessage | undefined): ToolCallBlock[] {
	if (!message || !Array.isArray(message.content)) return [];
	const calls: ToolCallBlock[] = [];
	for (const block of message.content) {
		if (block && typeof block === "object" && (block as ToolCallBlock).type === "toolCall") calls.push(block as ToolCallBlock);
	}
	return calls;
}
