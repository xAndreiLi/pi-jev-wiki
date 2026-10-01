/**
 * Discover the projects that have session history under one or more session roots.
 *
 * Pi files sessions under a directory named after the working directory, but the authoritative
 * answer to "which project was this?" is the `cwd` recorded in each session header. Reading it makes
 * the discovery robust to renamed or moved project directories, and it is also the only way to spot
 * sessions whose project no longer exists.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stripWslPrefix } from "./sessions.js";

export interface DiscoveredProject {
	/** The working directory recorded in the session headers, exactly as recorded. */
	cwd: string;
	/** Path to use for file access: the UNC form when the sessions live in WSL and cwd is a Linux path. */
	projectPath: string;
	/** Session root that holds this project's sessions. */
	sessionsRoot: string;
	/** Directory under the root, useful when the project itself no longer exists. */
	slugDir: string;
	sessions: number;
	first?: string;
	last?: string;
}

/** Read just the header line of a session file. */
async function readHeaderCwd(path: string): Promise<{ cwd?: string; timestamp?: string }> {
	try {
		const text = await readFile(path, "utf8");
		const newline = text.indexOf("\n");
		const line = newline === -1 ? text : text.slice(0, newline);
		const parsed = JSON.parse(line) as { cwd?: unknown; timestamp?: unknown };
		return {
			...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd } : {}),
			...(typeof parsed.timestamp === "string" ? { timestamp: parsed.timestamp } : {}),
		};
	} catch {
		return {};
	}
}

export async function discoverProjects(roots: string[]): Promise<DiscoveredProject[]> {
	const merged = new Map<string, DiscoveredProject>();
	for (const root of roots) {
		let dirs;
		try {
			dirs = await readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		// A WSL session root reached over UNC holds sessions whose recorded cwd is a Linux path.
		const wsl = /^\/\/(wsl\.localhost|wsl\$)\/([^/]+)/.exec(root.replace(/\\/g, "/"));
		for (const dir of dirs) {
			if (!dir.isDirectory()) continue;
			const slugDir = join(root, dir.name);
			let files: string[];
			try {
				files = (await readdir(slugDir)).filter((name) => name.endsWith(".jsonl")).sort();
			} catch {
				continue;
			}
			for (const file of files) {
				const header = await readHeaderCwd(join(slugDir, file));
				if (!header.cwd) continue;
				const projectPath = wsl && header.cwd.startsWith("/") ? `//${wsl[1]}/${wsl[2]}${header.cwd}` : header.cwd;
				const key = `${stripWslPrefix(header.cwd).toLowerCase()}|${root}`;
				const existing = merged.get(key);
				if (existing) {
					existing.sessions += 1;
					if (header.timestamp && (!existing.first || header.timestamp < existing.first)) existing.first = header.timestamp;
					if (header.timestamp && (!existing.last || header.timestamp > existing.last)) existing.last = header.timestamp;
					continue;
				}
				merged.set(key, {
					cwd: header.cwd,
					projectPath,
					sessionsRoot: root,
					slugDir,
					sessions: 1,
					...(header.timestamp ? { first: header.timestamp, last: header.timestamp } : {}),
				});
			}
		}
	}
	return [...merged.values()].sort((a, b) => b.sessions - a.sessions || a.cwd.localeCompare(b.cwd));
}
