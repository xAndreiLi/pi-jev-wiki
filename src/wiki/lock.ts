/**
 * Cross-process wiki lock.
 *
 * `withFileMutationQueue` only serializes within one pi process; two sessions in
 * the same project can otherwise interleave read-modify-write cycles on the TOC,
 * log, review queue, and raw index. This is a simple exclusive-create lock file
 * with stale takeover. Locks are held only around short mutations — never across
 * model or Jev calls — and are not reentrant.
 */
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WikiLayout } from "./layout.ts";

export interface LockOptions {
	timeoutMs?: number;
	staleMs?: number;
}

export class WikiLockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WikiLockError";
	}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function lockPath(layout: WikiLayout): string {
	return join(layout.stateDir, "lock");
}

export async function isLocked(layout: WikiLayout, staleMs = 30_000): Promise<{ locked: boolean; stale: boolean; ageMs?: number }> {
	try {
		const raw = await readFile(lockPath(layout), "utf8");
		const info = JSON.parse(raw) as { ts?: number };
		const ageMs = info.ts ? Date.now() - info.ts : undefined;
		return { locked: true, stale: ageMs === undefined || ageMs > staleMs, ageMs };
	} catch {
		return { locked: false, stale: false };
	}
}

/** Run `fn` while holding the wiki lock. Not reentrant. */
export async function withWikiLock<T>(layout: WikiLayout, fn: () => Promise<T>, options?: LockOptions): Promise<T> {
	const path = lockPath(layout);
	const timeoutMs = options?.timeoutMs ?? 15_000;
	const staleMs = options?.staleMs ?? 30_000;
	const started = Date.now();
	await mkdir(dirname(path), { recursive: true });

	let handle: Awaited<ReturnType<typeof open>>;
	for (;;) {
		try {
			handle = await open(path, "wx");
			await handle.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now(), host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? "" }));
			break;
		} catch (error) {
			if ((error as { code?: string }).code !== "EEXIST") throw error;
			// Existing lock: take it over if stale, otherwise wait.
			try {
				const raw = await readFile(path, "utf8");
				const info = JSON.parse(raw) as { ts?: number };
				if (!info.ts || Date.now() - info.ts > staleMs) {
					await rm(path, { force: true });
					continue;
				}
			} catch {
				await rm(path, { force: true }).catch(() => undefined);
				continue;
			}
			if (Date.now() - started > timeoutMs) {
				throw new WikiLockError(
					`Wiki is locked by another pi session (${path}). Retry in a moment, or delete the lock file if it is stale.`,
				);
			}
			await sleep(100 + Math.floor(Math.random() * 150));
		}
	}

	try {
		return await fn();
	} finally {
		await handle.close().catch(() => undefined);
		await rm(path, { force: true }).catch(() => undefined);
	}
}
