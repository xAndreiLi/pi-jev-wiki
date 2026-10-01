/**
 * ds-006 — hidden grader.
 *
 * Retention deletes files, so the interesting part is not that it deletes the right audio but that it
 * refuses to delete anything else: transcripts, files inside the window, anything when the window is
 * nonsense, and anything on a second run.
 *
 * Contract under test: `pruneRawAudio` in `src/bot/retention.ts`
 *   - deletes audio files (`.wav`, `.flac`, `.ogg`, `.mp3`, `.m4a`) older than the retention window
 *   - never deletes transcripts or other artefacts (`.md`, `.jsonl`, `.json`, `.txt`), however old
 *   - keeps audio inside the window
 *   - deletes nothing when the window is zero or negative
 *   - is idempotent: running it twice deletes the same set once
 *   - reports what it did: `{ deleted, kept, skipped }`
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'ds-006-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface PruneResult {
	deleted: string[];
	kept: string[];
	skipped: string[];
}

type Prune = (options: { sessionsRoot: string; retentionDays: number; now?: Date }) => PruneResult;

async function load(): Promise<Prune> {
	let module: { pruneRawAudio?: unknown };
	try {
		module = (await import('../src/bot/retention.js')) as { pruneRawAudio?: unknown };
	} catch (error) {
		throw new Error(`cannot import src/bot/retention.ts — ${(error as Error).message}`);
	}
	if (typeof module.pruneRawAudio !== 'function') {
		throw new Error('src/bot/retention.ts must export `pruneRawAudio`');
	}
	return module.pruneRawAudio as Prune;
}

function fixture(name: string): string {
	const base = join(root, name);
	mkdirSync(join(base, 'session-1', 'audio'), { recursive: true });
	mkdirSync(join(base, 'session-2'), { recursive: true });
	const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
	const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
	const files: Array<[string, Date]> = [
		[join(base, 'session-1', 'audio', 'mic.wav'), old],
		[join(base, 'session-1', 'audio', 'call.wav'), recent],
		[join(base, 'session-1', 'transcript.md'), old],
		[join(base, 'session-2', 'prompts.jsonl'), old],
		[join(base, 'session-2', 'notes.txt'), old],
	];
	for (const [path, when] of files) {
		writeFileSync(path, 'x', 'utf8');
		utimesSync(path, when, when);
	}
	return base;
}

describe('pruneRawAudio', () => {
	it('deletes old audio and leaves the transcripts alone', async () => {
		const prune = await load();
		const base = fixture('a');
		const result = prune({ sessionsRoot: base, retentionDays: 7 });
		expect(existsSync(join(base, 'session-1', 'audio', 'mic.wav'))).toBe(false);
		expect(existsSync(join(base, 'session-1', 'audio', 'call.wav'))).toBe(true);
		expect(existsSync(join(base, 'session-1', 'transcript.md'))).toBe(true);
		expect(existsSync(join(base, 'session-2', 'prompts.jsonl'))).toBe(true);
		expect(existsSync(join(base, 'session-2', 'notes.txt'))).toBe(true);
		expect(result.deleted.length).toBe(1);
	});

	it('keeps everything when the window is zero or negative', async () => {
		const prune = await load();
		const base = fixture('b');
		prune({ sessionsRoot: base, retentionDays: 0 });
		prune({ sessionsRoot: base, retentionDays: -5 });
		expect(existsSync(join(base, 'session-1', 'audio', 'mic.wav'))).toBe(true);
	});

	it('is idempotent', async () => {
		const prune = await load();
		const base = fixture('c');
		const first = prune({ sessionsRoot: base, retentionDays: 7 });
		const second = prune({ sessionsRoot: base, retentionDays: 7 });
		expect(first.deleted.length).toBe(1);
		expect(second.deleted.length).toBe(0);
	});

	it('honours an explicit now, so the window is testable', async () => {
		const prune = await load();
		const base = fixture('d');
		const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
		prune({ sessionsRoot: base, retentionDays: 7, now: farFuture });
		expect(existsSync(join(base, 'session-1', 'audio', 'mic.wav'))).toBe(false);
		expect(existsSync(join(base, 'session-1', 'audio', 'call.wav'))).toBe(false);
		expect(existsSync(join(base, 'session-1', 'transcript.md'))).toBe(true);
	});

	it('survives a missing sessions root', async () => {
		const prune = await load();
		const missing = join(root, 'does-not-exist');
		const result = prune({ sessionsRoot: missing, retentionDays: 7 });
		expect(result.deleted).toHaveLength(0);
		expect(readdirSync(root).includes('does-not-exist')).toBe(false);
	});
});
