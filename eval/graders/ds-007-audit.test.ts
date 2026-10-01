/**
 * ds-007 — hidden grader.
 *
 * The audit log is the record of everything the bot did, and today it writes `detail` verbatim: a token
 * that passes through a prompt or an API call lands in the file in plain text, and nothing bounds the
 * file's growth within a day.
 *
 * Contract under test, added to `AuditLog` in `src/bot/audit.ts`:
 *   - every record carries a schema version `v: 1` alongside `ts`
 *   - secrets never reach the file: Discord-shaped tokens, bearer tokens and env-style
 *     `*_TOKEN=`/`*_KEY=` assignments in `detail` are replaced by a placeholder
 *   - a `maxBytes` option (default kept sensible) rotates the day's file to `<name>.1` once it is
 *     exceeded, so no single file grows without bound
 *   - daily file naming is unchanged, and appending still never throws at the caller
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = mkdtempSync(join(tmpdir(), 'ds-007-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const FIXED = new Date('2026-10-01T12:00:00.000Z');
const FAKE_TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAx.Gh1JkL.abcdefghijklmnopqrstuvwxyz012345';
const PLACEHOLDER = /(<redacted>|\[redacted\]|\*{3,}|REDACTED)/;

interface AuditLogLike {
	append(entry: { kind: string; message: string; detail?: Record<string, unknown> }): void;
}

type AuditLogConstructor = new (dir: string, now?: () => Date, options?: { maxBytes?: number }) => AuditLogLike;

async function load(): Promise<AuditLogConstructor> {
	let module: { AuditLog?: unknown };
	try {
		module = (await import('../src/bot/audit.js')) as { AuditLog?: unknown };
	} catch (error) {
		throw new Error(`cannot import src/bot/audit.ts — ${(error as Error).message}`);
	}
	if (typeof module.AuditLog !== 'function') throw new Error('src/bot/audit.ts must export an `AuditLog` class');
	return module.AuditLog as AuditLogConstructor;
}

async function fresh(name: string, options?: { maxBytes?: number }): Promise<{ dir: string; log: AuditLogLike }> {
	const dir = join(root, name);
	const AuditLog = await load();
	return { dir, log: new AuditLog(dir, () => FIXED, options) };
}

function dayFile(dir: string): string {
	const found = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
	if (found.length === 0) throw new Error(`no audit file in ${dir}`);
	return join(dir, found[0]);
}

describe('AuditLog invariants', () => {
	it('stamps a schema version on every record', async () => {
		const { dir, log } = await fresh('version');
		log.append({ kind: 'prompt', message: 'hello' });
		const record = JSON.parse(readFileSync(dayFile(dir), 'utf8').trim().split(/\r?\n/)[0]);
		expect(record.v).toBe(1);
		expect(record.ts).toBeTruthy();
		expect(record.kind).toBe('prompt');
	});

	it('never writes a token into the file', async () => {
		const { dir, log } = await fresh('secrets');
		log.append({ kind: 'error', message: 'login failed', detail: { token: FAKE_TOKEN, note: `bearer ${FAKE_TOKEN}` } });
		log.append({ kind: 'pi', message: 'env', detail: { line: `JEV_TOKEN=${FAKE_TOKEN}` } });
		log.append({ kind: 'discord', message: 'request', detail: { url: `https://x.test/hook?api_key=${FAKE_TOKEN}` } });
		const text = readFileSync(dayFile(dir), 'utf8');
		expect(text, 'the raw token reached the audit file').not.toContain(FAKE_TOKEN);
		for (const line of text.trim().split(/\r?\n/)) {
			expect(JSON.parse(line)).toBeTruthy();
		}
		expect(text).toMatch(PLACEHOLDER);
	});

	it('leaves ordinary details alone', async () => {
		const { dir, log } = await fresh('ordinary');
		log.append({ kind: 'voice', message: 'joined', detail: { channel: 'general', users: 2, note: 'the token bucket is empty' } });
		const text = readFileSync(dayFile(dir), 'utf8');
		expect(text).toContain('general');
		expect(text).toContain('the token bucket is empty');
	});

	it('rotates instead of growing one file without bound', async () => {
		const { dir, log } = await fresh('rotation', { maxBytes: 400 });
		for (let index = 0; index < 40; index += 1) log.append({ kind: 'pi', message: `entry ${index}`, detail: { pad: 'x'.repeat(64) } });
		const rotated = readdirSync(dir).filter((name) => name.endsWith('.1'));
		expect(rotated.length, 'nothing rotated: the day file grew without bound').toBeGreaterThan(0);
		const current = readFileSync(dayFile(dir), 'utf8').length;
		expect(current).toBeLessThan(400 * 4);
	});

	it('still swallows its own failures', async () => {
		const AuditLog = await load();
		// A file where a directory is expected: writing must not take the bot down.
		const notADirectory = join(root, 'plain-file');
		writeFileSync(notADirectory, 'x', 'utf8');
		const log = new AuditLog(notADirectory, () => FIXED);
		expect(() => log.append({ kind: 'error', message: 'boom' })).not.toThrow();
	});
});
