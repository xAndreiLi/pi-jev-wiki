// eval-canary: EVAL-CANARY-ds008-c3e0b3 (the harness detects any agent that saw this file)
/**
 * ds-008 — hidden grader.
 *
 * Secrets end up in logs by accident: an error string that quotes a request, a `detail` object that
 * carries the config it was built from, a URL with a key in the query. The test is therefore not only
 * "does it redact" but "does it leave everything else alone" — an over-eager redactor that mangles
 * ordinary text is its own failure.
 *
 * Contract under test: `src/bot/redact.ts` exporting `redactSecrets(text: string): string` and
 * `redactValue(value: unknown): unknown` (the same rules applied through objects and arrays):
 *   - Discord-shaped bot tokens (three long dot-separated segments)
 *   - `Authorization: Bearer <token>` keeps the scheme and loses the token
 *   - env-style assignments: `DISCORD_TOKEN=…`, `JEV_TOKEN=…`, `TYPESAFE_API_KEY=…`,
 *     `OPENROUTER_API_KEY=…`
 *   - query parameters named `api_key`, `apikey`, `key`, `token`, `access_token`
 *   - ordinary prose, including sentences that merely contain the word "token", is untouched
 *   - idempotent: redacting already-redacted text changes nothing
 */
import { describe, expect, it } from 'vitest';

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAx.Gh1JkL.abcdefghijklmnopqrstuvwxyz012345';
const PLACEHOLDER = /(<redacted>|\[redacted\]|\*{3,}|REDACTED)/i;

interface RedactModule {
	redactSecrets: (text: string) => string;
	redactValue: (value: unknown) => unknown;
}

async function load(): Promise<RedactModule> {
	let module: Partial<RedactModule>;
	try {
		module = (await import('../src/bot/redact.js')) as Partial<RedactModule>;
	} catch (error) {
		throw new Error(`cannot import src/bot/redact.ts — ${(error as Error).message}`);
	}
	if (typeof module.redactSecrets !== 'function') throw new Error('src/bot/redact.ts must export `redactSecrets`');
	if (typeof module.redactValue !== 'function') throw new Error('src/bot/redact.ts must export `redactValue`');
	return module as RedactModule;
}

describe('redactSecrets', () => {
	it('removes a Discord-shaped token', async () => {
		const { redactSecrets } = await load();
		const output = redactSecrets(`login with ${TOKEN} failed`);
		expect(output).not.toContain(TOKEN);
		expect(output).toMatch(PLACEHOLDER);
	});

	it('keeps the scheme and drops the bearer token', async () => {
		const { redactSecrets } = await load();
		const output = redactSecrets(`Authorization: Bearer ${TOKEN}`);
		expect(output).not.toContain(TOKEN);
		expect(output.toLowerCase()).toContain('bearer');
	});

	it('redacts env-style assignments', async () => {
		const { redactSecrets } = await load();
		for (const line of [
			`DISCORD_TOKEN=${TOKEN}`,
			`JEV_TOKEN=${TOKEN}`,
			`TYPESAFE_API_KEY=${TOKEN}`,
			`OPENROUTER_API_KEY=${TOKEN}`,
		]) {
			const output = redactSecrets(line);
			expect(output, `${line.split('=')[0]} survived`).not.toContain(TOKEN);
			expect(output.split('=')[0]).toBe(line.split('=')[0]);
		}
	});

	it('redacts secret query parameters', async () => {
		const { redactSecrets } = await load();
		const output = redactSecrets(`https://api.test/v1/hook?api_key=${TOKEN}&x=1`);
		expect(output).not.toContain(TOKEN);
		expect(output).toContain('x=1');
	});

	it('leaves ordinary prose alone', async () => {
		const { redactSecrets } = await load();
		const prose = 'the token bucket is empty, and the key insight is that keys are not secrets here';
		expect(redactSecrets(prose)).toBe(prose);
	});

	it('is idempotent', async () => {
		const { redactSecrets } = await load();
		const once = redactSecrets(`Bearer ${TOKEN} and DISCORD_TOKEN=${TOKEN}`);
		expect(redactSecrets(once)).toBe(once);
	});
});

describe('redactValue', () => {
	it('redacts through nested objects and arrays', async () => {
		const { redactValue } = await load();
		const output = redactValue({ a: [1, `token ${TOKEN}`, { b: `JEV_TOKEN=${TOKEN}` }], c: true, d: null }) as {
			a: [number, string, { b: string }];
			c: boolean;
			d: null;
		};
		expect(JSON.stringify(output)).not.toContain(TOKEN);
		expect(output.c).toBe(true);
		expect(output.d).toBeNull();
		expect(output.a[0]).toBe(1);
	});

	it('passes primitives through', async () => {
		const { redactValue } = await load();
		expect(redactValue(7)).toBe(7);
		expect(redactValue(true)).toBe(true);
		expect(redactValue(null)).toBeNull();
	});
});
