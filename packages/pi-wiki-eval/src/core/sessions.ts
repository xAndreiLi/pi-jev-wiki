/**
 * Locate and parse pi session transcripts.
 *
 * Read-only by design: the evaluator never writes a session file, and it never imports
 * pi-jev-wiki, so the same code path measures a wiki-enabled session and a wiki-less one.
 * Everything here comes from files pi already writes.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** First line of a session file. Metadata only; not part of the entry tree. */
export interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

/** A nested tool call made through codemode. Results are never recorded, names and arguments are. */
export interface NestedCall {
	id?: string;
	name?: string;
	status?: string;
	arguments?: unknown;
	durationMs?: number;
}

export interface ToolCallBlock {
	type: "toolCall";
	id?: string;
	name?: string;
	arguments?: unknown;
}

export interface SessionMessage {
	role?: string;
	content?: unknown;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	stopReason?: string;
	usage?: unknown;
	timestamp?: number;
	nestedCalls?: { calls?: NestedCall[] } | NestedCall[];
	[key: string]: unknown;
}

/** One JSONL entry. Only the tree fields are typed; `message` is validated at use. */
export interface SessionEntry {
	type: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: SessionMessage;
	customType?: string;
	content?: unknown;
	[key: string]: unknown;
}

export interface SessionTranscript {
	path: string;
	header?: SessionHeader;
	entries: SessionEntry[];
	bytes: number;
	warnings: string[];
}

export interface AgentPaths {
	agentDir: string;
	sessionsRoot: string;
}

export function resolveAgentPaths(env: NodeJS.ProcessEnv = process.env): AgentPaths {
	const agentDir = env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return {
		agentDir,
		sessionsRoot: env.PI_CODING_AGENT_SESSION_DIR?.trim() || join(agentDir, "sessions"),
	};
}

/**
 * Pi's per-project session directory name: the leading separator is removed, `/`, `\` and `:`
 * become `-`, and the result is wrapped in `--`. `C:\Coding\app` → `--C--Coding-app--`.
 */
export function projectSlug(cwd: string): string {
	return `--${cwd.replace(/^[\\/]+/, "").replace(/[\\/:]/g, "-")}--`;
}

/**
 * `\\wsl.localhost\Ubuntu\home\x` and `\\wsl$\Ubuntu\home\x` name the same place as `/home/x`
 * inside that distro. Sessions recorded under WSL carry the Linux path, while anything that
 * registered the project from Windows carries the UNC path.
 */
export function stripWslPrefix(value: string): string {
	const clean = value.replace(/\\/g, "/");
	const match = /^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+(\/.*)?$/.exec(clean);
	return match ? match[1] ?? "/" : value;
}

/** Windows paths compare case-insensitively; POSIX paths do not. */
export function sameDir(a: string, b: string): boolean {
	const clean = (value: string): string => stripWslPrefix(value).replace(/[\\/]+/g, "/").replace(/\/+$/, "");
	const left = clean(a);
	const right = clean(b);
	const windows = (value: string): boolean => /^[a-zA-Z]:\//.test(value) || value.includes("\\");
	if (windows(left) || windows(right)) return left.toLowerCase() === right.toLowerCase();
	return left === right;
}

/** Every `*.jsonl` under a sessions root, sorted by path. Missing roots yield an empty list. */
export async function listSessionFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith(".jsonl")) found.push(full);
		}
	}
	await walk(root);
	return found.sort();
}

/**
 * Parse one session file. Unparseable lines are counted as warnings rather than failing the
 * read: a truncated final line is normal for sessions that are still being written.
 */
export async function readTranscript(path: string): Promise<SessionTranscript> {
	const text = await readFile(path, "utf8");
	const entries: SessionEntry[] = [];
	const warnings: string[] = [];
	let header: SessionHeader | undefined;
	const lines = text.split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			warnings.push(`line ${index + 1}: unparseable JSON, skipped`);
			continue;
		}
		const entry = parsed as SessionEntry;
		if (entry.type === "session" && !header) {
			header = entry as unknown as SessionHeader;
			continue;
		}
		entries.push(entry);
	}
	return { path, header, entries, bytes: Buffer.byteLength(text), warnings };
}

export interface ActivePath {
	entries: SessionEntry[];
	/** Set when entries were dropped (an abandoned branch) or the chain was broken (file order). */
	note?: string;
}

/**
 * Reconstruct the active branch by walking `parentId` back from the last entry. Sessions are a
 * tree; abandoned branches (from editing or navigating) would otherwise be counted as work that
 * happened. If the chain does not resolve, fall back to file order and say so.
 */
export function activePath(entries: SessionEntry[]): ActivePath {
	if (entries.length === 0) return { entries };
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) if (entry.id) byId.set(entry.id, entry);
	const chain: SessionEntry[] = [];
	let cursor: SessionEntry | undefined = entries[entries.length - 1];
	while (cursor) {
		chain.push(cursor);
		const parentId = cursor.parentId ?? null;
		if (!parentId) break;
		const parent = byId.get(parentId);
		if (!parent) return { entries, note: "parent chain broken; used file order" };
		cursor = parent;
	}
	const ordered = chain.reverse();
	if (ordered.length === entries.length) return { entries: ordered };
	return {
		entries: ordered,
		note: `${entries.length - ordered.length} entr(ies) on an abandoned branch excluded`,
	};
}

/** Concatenated text blocks of a message content array. */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const candidate = block as { type?: string; text?: string };
		if (candidate.type === "text" && typeof candidate.text === "string") parts.push(candidate.text);
	}
	return parts.join("\n");
}

export function toolCallsOf(message: SessionMessage | undefined): ToolCallBlock[] {
	if (!message || !Array.isArray(message.content)) return [];
	const calls: ToolCallBlock[] = [];
	for (const block of message.content) {
		if (!block || typeof block !== "object") continue;
		const candidate = block as ToolCallBlock;
		if (candidate.type === "toolCall") calls.push(candidate);
	}
	return calls;
}

/** `nestedCalls` is `{ calls: [...] }` in practice; tolerate a bare array. */
export function nestedCallsOf(message: SessionMessage | undefined): NestedCall[] {
	const raw = message?.nestedCalls;
	if (!raw) return [];
	if (Array.isArray(raw)) return raw;
	if (Array.isArray(raw.calls)) return raw.calls;
	return [];
}

export function textOfMessage(message: SessionMessage | undefined): string {
	return contentText(message?.content);
}
