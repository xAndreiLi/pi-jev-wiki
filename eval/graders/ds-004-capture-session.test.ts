/**
 * ds-004 — hidden grader.
 *
 * The session owns a child process, so the part that can go wrong silently is the state machine: starting
 * twice, forgetting an exit, stopping something that already stopped. The process factory is injectable,
 * which is what makes that checkable without launching Python or touching a device.
 *
 * The module is imported dynamically so a missing or renamed export fails as a readable assertion rather
 * than a collection error that asserts nothing.
 *
 * Contract under test: `CaptureSession` in `src/bot/capture-session.ts`
 *   - `start()` → `{ state: 'running', pid }`, spawning exactly once
 *   - a second `start()` while running rejects and does **not** spawn again
 *   - the child's `exit` returns the session to `idle`
 *   - `stop()` kills once, is idempotent, and leaves the session `idle`
 *   - `status()` reports `{ state, pid, startedAt }` at every stage
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

class FakeChild extends EventEmitter {
	pid = 4242;
	killed: string[] = [];
	stderr = new EventEmitter();
	stdout = new EventEmitter();

	kill(signal?: string): boolean {
		this.killed.push(signal ?? 'SIGTERM');
		this.emit('exit', 0);
		return true;
	}
}

interface SessionLike {
	start(): Promise<{ state: string; pid?: number }>;
	stop(): Promise<void>;
	status(): { state: string; pid?: number; startedAt?: string | null };
}

type SessionConstructor = new (options: {
	command: string;
	args: string[];
	cwd: string;
	spawnProcess?: (command: string, args: string[], options: { cwd: string }) => FakeChild;
}) => SessionLike;

async function load(): Promise<SessionConstructor> {
	let module: { CaptureSession?: unknown };
	try {
		module = (await import('../src/bot/capture-session.js')) as { CaptureSession?: unknown };
	} catch (error) {
		throw new Error(`cannot import src/bot/capture-session.ts — ${(error as Error).message}`);
	}
	if (typeof module.CaptureSession !== 'function') {
		throw new Error('src/bot/capture-session.ts must export a `CaptureSession` class');
	}
	return module.CaptureSession as SessionConstructor;
}

function harness() {
	const spawned: Array<{ command: string; args: string[]; child: FakeChild }> = [];
	const spawnProcess = (command: string, args: string[], options: { cwd: string }): FakeChild => {
		void options;
		const child = new FakeChild();
		spawned.push({ command, args, child });
		return child;
	};
	return { spawned, spawnProcess };
}

describe('CaptureSession', () => {
	it('spawns once and reports itself running', async () => {
		const CaptureSession = await load();
		const { spawned, spawnProcess } = harness();
		const session = new CaptureSession({ command: 'python3', args: ['agent.py'], cwd: '.', spawnProcess });

		const started = await session.start();
		expect(started.state).toBe('running');
		expect(started.pid).toBe(4242);
		expect(spawned).toHaveLength(1);
		expect(session.status().state).toBe('running');
	});

	it('refuses to start twice and does not spawn a second process', async () => {
		const CaptureSession = await load();
		const { spawned, spawnProcess } = harness();
		const session = new CaptureSession({ command: 'python3', args: [], cwd: '.', spawnProcess });
		await session.start();
		await expect(session.start()).rejects.toThrow();
		expect(spawned).toHaveLength(1);
	});

	it('returns to idle when the child exits on its own', async () => {
		const CaptureSession = await load();
		const { spawned, spawnProcess } = harness();
		const session = new CaptureSession({ command: 'python3', args: [], cwd: '.', spawnProcess });
		await session.start();
		spawned[0].child.emit('exit', 0);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(session.status().state).toBe('idle');
	});

	it('stops the child once and is safe to stop again', async () => {
		const CaptureSession = await load();
		const { spawned, spawnProcess } = harness();
		const session = new CaptureSession({ command: 'python3', args: [], cwd: '.', spawnProcess });
		await session.start();
		await session.stop();
		await session.stop();
		expect(spawned[0].child.killed).toHaveLength(1);
		expect(session.status().state).toBe('idle');
	});

	it('starting after a stop spawns a fresh process', async () => {
		const CaptureSession = await load();
		const { spawned, spawnProcess } = harness();
		const session = new CaptureSession({ command: 'python3', args: [], cwd: '.', spawnProcess });
		await session.start();
		await session.stop();
		await session.start();
		expect(spawned).toHaveLength(2);
		expect(session.status().state).toBe('running');
	});

	it('reports an idle session with nothing to kill', async () => {
		const CaptureSession = await load();
		const { spawnProcess } = harness();
		const session = new CaptureSession({ command: 'python3', args: [], cwd: '.', spawnProcess });
		expect(session.status().state).toBe('idle');
		await session.stop();
		expect(session.status().state).toBe('idle');
	});
});
