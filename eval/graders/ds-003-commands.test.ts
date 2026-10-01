/**
 * ds-003 — hidden grader.
 *
 * Handlers are driven directly with spy dependencies, so nothing here needs a Discord connection.
 * Registering the commands with the client is reviewed by hand; this covers the behaviour that can go
 * wrong silently — above all, whether a non-owner can make the bot do something.
 *
 * The module is imported dynamically on purpose: a static import of a missing or renamed export makes
 * the file fail to collect, so zero assertions run. Loading it inside each test turns "not there yet"
 * into a readable failing test.
 *
 * Contract under test: `handleSlashCommand(name, option, user, deps)`
 *   - non-owner → `handled: false`, and none of the four action dependencies are touched
 *   - `record` + `start` → `startRecord()` once
 *   - `record` + `stop`  → `stopRecord()` once
 *   - `status`           → `statusText()` once, and its text is sent back through `reply`
 *   - `use` + a name     → `useProject(name)` once
 *   - `record` with an unrecognised option, or an unknown command → `handled: false`, no action calls
 */
import { describe, expect, it, vi } from 'vitest';

interface CommandDeps {
	ownerId: string;
	startRecord: () => Promise<unknown>;
	stopRecord: () => Promise<unknown>;
	statusText: () => Promise<string>;
	useProject: (name: string) => Promise<string>;
	reply: (text: string) => Promise<unknown>;
}

interface CommandResult {
	handled: boolean;
	reason?: string;
}

type HandleSlashCommand = (name: string, option: string | undefined, user: { id: string }, deps: CommandDeps) => Promise<CommandResult>;

async function load(): Promise<{ handleSlashCommand: HandleSlashCommand }> {
	let module: { handleSlashCommand?: unknown };
	try {
		module = (await import('../src/bot/commands.js')) as { handleSlashCommand?: unknown };
	} catch (error) {
		throw new Error(`cannot import src/bot/commands.ts — ${(error as Error).message}`);
	}
	if (typeof module.handleSlashCommand !== 'function') {
		throw new Error('src/bot/commands.ts must export `handleSlashCommand`');
	}
	return module as { handleSlashCommand: HandleSlashCommand };
}

const OWNER = 'owner-1';
const STRANGER = 'stranger-9';

interface Harness {
	deps: CommandDeps;
	actionCalls: string[];
}

function harness(ownerId = OWNER): Harness {
	const actionCalls: string[] = [];
	const spy = <T>(name: string, value: T) =>
		vi.fn(async () => {
			actionCalls.push(name);
			return value;
		});
	return {
		actionCalls,
		deps: {
			ownerId,
			startRecord: spy('startRecord', { ok: true }),
			stopRecord: spy('stopRecord', { ok: true }),
			statusText: spy('statusText', 'session: idle'),
			useProject: spy('useProject', 'project: alpha'),
			reply: spy('reply', undefined),
		} as CommandDeps,
	};
}

describe('handleSlashCommand', () => {
	it('lets the owner start and stop recording', async () => {
		const { handleSlashCommand } = await load();

		const start = harness();
		const started = await handleSlashCommand('record', 'start', { id: OWNER }, start.deps);
		expect(started.handled).toBe(true);
		expect(start.deps.startRecord).toHaveBeenCalledTimes(1);
		expect(start.actionCalls).not.toContain('stopRecord');

		const stop = harness();
		const stopped = await handleSlashCommand('record', 'stop', { id: OWNER }, stop.deps);
		expect(stopped.handled).toBe(true);
		expect(stop.deps.stopRecord).toHaveBeenCalledTimes(1);
		expect(stop.actionCalls).not.toContain('startRecord');
	});

	it('reports status by sending the text back', async () => {
		const { handleSlashCommand } = await load();
		const state = harness();
		const result = await handleSlashCommand('status', undefined, { id: OWNER }, state.deps);
		expect(result.handled).toBe(true);
		expect(state.deps.statusText).toHaveBeenCalledTimes(1);
		expect(state.deps.reply).toHaveBeenCalledWith(expect.stringContaining('idle'));
	});

	it('switches project when given a name', async () => {
		const { handleSlashCommand } = await load();
		const state = harness();
		const result = await handleSlashCommand('use', 'alpha', { id: OWNER }, state.deps);
		expect(result.handled).toBe(true);
		expect(state.deps.useProject).toHaveBeenCalledWith('alpha');
	});

	it('does nothing at all for anyone who is not the owner', async () => {
		const { handleSlashCommand } = await load();
		for (const [name, option] of [
			['record', 'start'],
			['record', 'stop'],
			['status', undefined],
			['use', 'alpha'],
		] as Array<[string, string | undefined]>) {
			const state = harness();
			const result = await handleSlashCommand(name, option, { id: STRANGER }, state.deps);
			expect(result.handled).toBe(false);
			expect(state.actionCalls, `${name} ${option ?? ''} reached a dependency for a non-owner`).toHaveLength(0);
		}
	});

	it('refuses a record command it does not understand', async () => {
		const { handleSlashCommand } = await load();
		const state = harness();
		const result = await handleSlashCommand('record', 'sideways', { id: OWNER }, state.deps);
		expect(result.handled).toBe(false);
		expect(state.actionCalls).toHaveLength(0);
	});

	it('ignores an unknown command', async () => {
		const { handleSlashCommand } = await load();
		const state = harness();
		const result = await handleSlashCommand('nonsense', undefined, { id: OWNER }, state.deps);
		expect(result.handled).toBe(false);
		expect(state.actionCalls).toHaveLength(0);
	});
});
