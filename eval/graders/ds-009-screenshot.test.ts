// eval-canary: EVAL-CANARY-ds009-6c5d96 (the harness detects any agent that saw this file)
/**
 * ds-009 — hidden grader.
 *
 * The assistant hears and speaks but cannot see. The contract is a script she can run from her
 * session and a skill that tells her how the pixels reach her context:
 *
 *   scripts/screenshot.mjs --list   → stdout is one JSON object, {"displays":[{id,width,height,primary}]},
 *                                     and nothing is captured
 *   scripts/screenshot.mjs          → every listed monitor is captured to a PNG and stdout lists the
 *                                     same displays with an absolute `path` per display
 *   skills/screenshot/SKILL.md      → a skill named `screenshot` documenting when to look and that she
 *                                     sees the image by reading the PNG with her file-reading tool
 *   src/bot/skills.ts               → the skill is advertised (SKILL_NAMES)
 *   src/bot/index.ts                → the script's absolute path reaches her session as
 *                                     LING_SCREENSHOT_SCRIPT, because her cwd is memory/
 *
 * The capture half is tested against the real machine: this is a Windows box with a display, and a
 * screenshot that cannot actually be taken is not the feature. The assertions are on the contract
 * above, not on how the script talks to the OS.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILL_NAMES } from '../src/bot/skills.js';

const root = process.cwd();
const scriptPath = join(root, 'scripts', 'screenshot.mjs');
const skillPath = join(root, 'skills', 'screenshot', 'SKILL.md');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Display {
	id: number;
	width: number;
	height: number;
	primary?: boolean;
	path?: string | null;
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile(
			process.execPath,
			[scriptPath, ...args],
			{ cwd: root, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
				resolve({ code, stdout, stderr });
			},
		);
	});
}

/** The contract says stdout is the JSON object and nothing else. */
function parse(stdout: string): { displays: Display[] } {
	const text = stdout.replace(/^\uFEFF/, '').trim();
	const body = JSON.parse(text) as { displays?: Display[] };
	if (!Array.isArray(body.displays)) throw new Error(`stdout is not {"displays":[...]}: ${text.slice(0, 200)}`);
	return body as { displays: Display[] };
}

/** PNG width/height are the first two big-endian uint32s of IHDR, at offsets 16 and 20. */
function pngSize(path: string): { width: number; height: number } {
	const bytes = readFileSync(path);
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('scripts/screenshot.mjs — the monitors', () => {
	it(
		'lists every monitor as JSON without capturing anything',
		async () => {
			const { code, stdout, stderr } = await runCli(['--list']);
			expect(code, `--list exited ${code}: ${stderr.slice(-400)}`).toBe(0);
			const { displays } = parse(stdout);
			expect(displays.length).toBeGreaterThan(0);
			for (const display of displays) {
				expect(typeof display.id).toBe('number');
				expect(display.width).toBeGreaterThan(0);
				expect(display.height).toBeGreaterThan(0);
				expect(typeof display.primary).toBe('boolean');
				expect(display.path == null, '--list must not capture').toBe(true);
			}
			expect(displays.filter((display) => display.primary === true)).toHaveLength(1);
		},
		95_000,
	);

	it(
		'captures every listed monitor to a PNG',
		async () => {
			const listed = parse((await runCli(['--list'])).stdout).displays;
			const { code, stdout, stderr } = await runCli([]);
			expect(code, `capture exited ${code}: ${stderr.slice(-400)}`).toBe(0);
			const { displays } = parse(stdout);
			expect(displays).toHaveLength(listed.length);

			const paths: string[] = [];
			for (const display of displays) {
				expect(typeof display.path, `display ${display.id} has no path`).toBe('string');
				const path = display.path as string;
				expect(isAbsolute(path)).toBe(true);
				expect(existsSync(path), `${path} does not exist`).toBe(true);
				expect(statSync(path).size).toBeGreaterThan(1000);
				expect(readFileSync(path).subarray(0, 8).equals(PNG_MAGIC), `${path} is not a PNG`).toBe(true);
				expect(pngSize(path)).toEqual({ width: display.width, height: display.height });
				paths.push(path);
			}
			expect(new Set(paths).size, 'a monitor was captured over another').toBe(paths.length);
		},
		95_000,
	);
});

describe('the screenshot skill — how she sees', () => {
	it('is advertised by the bot, next to speak, remember and mcp', () => {
		expect([...(SKILL_NAMES as readonly string[])]).toContain('screenshot');
		expect(existsSync(skillPath), `${skillPath} is missing`).toBe(true);
	});

	it('is loadable and tells her how the pixels reach her context', () => {
		const text = readFileSync(skillPath, 'utf8');
		const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
		expect(match, `${skillPath} has no frontmatter`).not.toBeNull();
		if (!match) return;
		const [, fields = '', body = ''] = match;
		expect(fields).toMatch(/^name:\s*screenshot\s*$/m);
		const description = /^description:\s*(.+)$/m.exec(fields)?.[1]?.trim() ?? '';
		expect(description.length).toBeGreaterThan(40);
		expect(body.trim().length).toBeGreaterThan(200);
		expect(body).toMatch(/LING_SCREENSHOT_SCRIPT/);
		expect(body).toMatch(/png/i);
		// The image only enters her context when she reads the file; a skill that stops at the path
		// leaves her blind.
		expect(body).toMatch(/\bread\b/i);
	});

	it('hands the script path to her session, as LING_SAY_SCRIPT already is', () => {
		const index = readFileSync(join(root, 'src', 'bot', 'index.ts'), 'utf8');
		expect(index).toMatch(/LING_SCREENSHOT_SCRIPT/);
	});
});
