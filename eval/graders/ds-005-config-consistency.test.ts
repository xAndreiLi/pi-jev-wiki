// eval-canary: EVAL-CANARY-ds005-af72b1 (the harness detects any agent that saw this file)
/**
 * ds-005 — hidden grader.
 *
 * Cross-field configuration rules are where a per-field validator quietly fails: every value is valid on
 * its own, and the configuration is still wrong. The baseline environment is the repository's own
 * `.env.example`, so the grader stays honest about what "valid" means in this project.
 *
 * Contract under test, added to `loadConfig` in `src/config/index.ts`:
 *   - `VOICE_PROMPT_MODE=wake` requires a non-empty `VOICE_WAKE_WORD`
 *   - `ASR_ENGINE=whisper-cpp` requires `ASR_MODEL` to name an existing file (faster-whisper takes a
 *     model *name* instead, so the same value must not be rejected for that engine)
 *   - every problem is collected and reported together in one `ConfigError`, naming the variable at
 *     fault, instead of throwing on the first one
 *   - a valid environment still loads, with defaults applied
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const temporary = mkdtempSync(join(tmpdir(), 'ds-005-'));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function baseline(): Record<string, string> {
	const text = readFileSync('.env.example', 'utf8');
	const env: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (match) env[match[1]] = match[2].trim();
	}
	return env;
}

async function load(overrides: Record<string, string>): Promise<{ config?: unknown; error?: Error }> {
	const module = (await import('../src/config/index.js')) as {
		loadConfig: (env: Record<string, string | undefined>) => unknown;
	};
	try {
		return { config: module.loadConfig({ ...baseline(), ...overrides }) };
	} catch (error) {
		return { error: error as Error };
	}
}

describe('cross-field configuration rules', () => {
	it('accepts the repository\'s own example environment', async () => {
		const { config, error } = await load({ CAPTURE_DEVICE: baseline().CAPTURE_DEVICE ?? '' });
		expect(error, `the baseline .env.example no longer loads: ${error?.message}`).toBeUndefined();
		expect(config).toBeTruthy();
	});

	it('rejects wake mode without a wake word, naming the variable', async () => {
		const { error } = await load({ VOICE_PROMPT_MODE: 'wake', VOICE_WAKE_WORD: '' });
		expect(error).toBeDefined();
		expect(error?.message).toContain('VOICE_WAKE_WORD');
	});

	it('accepts wake mode with a wake word', async () => {
		const { error } = await load({ VOICE_PROMPT_MODE: 'wake', VOICE_WAKE_WORD: 'ling' });
		expect(error).toBeUndefined();
	});

	it('rejects whisper-cpp without an existing model file', async () => {
		const { error } = await load({ ASR_ENGINE: 'whisper-cpp', ASR_MODEL: join(temporary, 'absent.bin') });
		expect(error).toBeDefined();
		expect(error?.message).toContain('ASR_MODEL');
	});

	it('accepts whisper-cpp when the model file is there', async () => {
		const model = join(temporary, 'ggml-small.bin');
		writeFileSync(model, 'not a real model', 'utf8');
		const { error } = await load({ ASR_ENGINE: 'whisper-cpp', ASR_MODEL: model });
		expect(error).toBeUndefined();
	});

	it('does not demand a file for faster-whisper, which takes a model name', async () => {
		const { error } = await load({ ASR_ENGINE: 'faster-whisper', ASR_MODEL: 'small' });
		expect(error).toBeUndefined();
	});

	it('collects every problem instead of failing on the first', async () => {
		const { error } = await load({ VOICE_PROMPT_MODE: 'wake', VOICE_WAKE_WORD: '', ASR_ENGINE: 'whisper-cpp', ASR_MODEL: join(temporary, 'absent.bin') });
		expect(error).toBeDefined();
		expect(error?.message).toContain('VOICE_WAKE_WORD');
		expect(error?.message, 'the second problem was dropped — problems must be collected, not thrown one at a time').toContain('ASR_MODEL');
	});
});
