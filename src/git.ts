/**
 * Minimal git helpers for change-driven wiki invalidation.
 * Uses child_process directly so the logic is testable without the pi runtime.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitResult {
	code: number;
	stdout: string;
	stderr: string;
}

export async function git(cwd: string, args: string[]): Promise<GitResult> {
	try {
		const { stdout, stderr } = await run("git", ["-C", cwd, ...args], { maxBuffer: 20 * 1024 * 1024 });
		return { code: 0, stdout, stderr };
	} catch (error) {
		const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
		return {
			code: typeof failure.code === "number" ? failure.code : 1,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? failure.message ?? String(error),
		};
	}
}

export async function isGitRepo(cwd: string): Promise<boolean> {
	const result = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	return result.code === 0 && result.stdout.trim() === "true";
}

export async function headCommit(cwd: string): Promise<string | undefined> {
	const result = await git(cwd, ["rev-parse", "HEAD"]);
	return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function changedFiles(cwd: string, from: string, to = "HEAD"): Promise<string[]> {
	const result = await git(cwd, ["diff", "--name-only", "--diff-filter=ACMR", `${from}..${to}`]);
	if (result.code !== 0) return [];
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split("\\").join("/"));
}

export async function diffForFiles(cwd: string, from: string, to: string, files: string[], maxChars: number): Promise<string> {
	if (files.length === 0) return "";
	const result = await git(cwd, ["diff", "--no-color", "--unified=3", `${from}..${to}`, "--", ...files]);
	if (result.code !== 0) return "";
	return result.stdout.length > maxChars ? `${result.stdout.slice(0, maxChars)}\n[... diff truncated ...]` : result.stdout;
}

/** Exact path, directory prefix, or a simple `*` glob. */
export function fileMatches(changedPath: string, pattern: string): boolean {
	const changed = changedPath.split("\\").join("/");
	const candidate = pattern.split("\\").join("/").replace(/^\.\//, "");
	if (!candidate) return false;
	if (candidate.includes("*")) {
		const regex = new RegExp(`^${candidate.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
		return regex.test(changed);
	}
	if (changed === candidate) return true;
	const prefix = candidate.endsWith("/") ? candidate : `${candidate}/`;
	return changed.startsWith(prefix);
}
