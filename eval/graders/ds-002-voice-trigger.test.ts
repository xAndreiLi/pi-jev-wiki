// eval-canary: EVAL-CANARY-ds002-514587 (the harness detects any agent that saw this file)
/**
 * ds-002 — hidden grader.
 *
 * The decision is graded as a pure function so it can be checked without a gateway connection or a
 * real call. The wiring into the Discord client (`Events.VoiceStateUpdate`) is reviewed by hand; this
 * covers the part that decides, which is the part that can go wrong silently.
 *
 * The module is imported dynamically on purpose: with a plain static import a missing or renamed
 * export makes the whole file fail to collect, so zero assertions run. Loading it inside the test
 * turns "the module is not there yet" into a readable failing test instead.
 *
 * Contract under test: `voiceTriggerAction(previous, next, { ownerId })`
 *   - owner arrives in a channel     → 'start'
 *   - owner leaves a channel         → 'stop'
 *   - owner moves between channels   → 'ignore' (do not restart capture)
 *   - anyone else, either direction  → 'ignore'
 *   - a null state (no information)  → 'ignore'
 */
import { describe, expect, it } from 'vitest';

interface VoiceStateLike {
	userId: string;
	channelId: string | null;
}

type VoiceTriggerAction = (previous: VoiceStateLike | null, next: VoiceStateLike | null, options: { ownerId: string }) => string;

interface TriggerModule {
	voiceTriggerAction: VoiceTriggerAction;
}

async function load(): Promise<TriggerModule> {
	let module: Partial<TriggerModule>;
	try {
		module = (await import('../src/bot/voice-trigger.js')) as Partial<TriggerModule>;
	} catch (error) {
		throw new Error(`cannot import src/bot/voice-trigger.ts — ${(error as Error).message}`);
	}
	if (typeof module.voiceTriggerAction !== 'function') {
		throw new Error('src/bot/voice-trigger.ts must export `voiceTriggerAction`');
	}
	return module as TriggerModule;
}

const OWNER = 'owner-1';
const options = { ownerId: OWNER };
const inChannel = (userId: string, channelId: string): VoiceStateLike => ({ userId, channelId });
const absent = (userId: string): VoiceStateLike => ({ userId, channelId: null });

describe('voiceTriggerAction', () => {
	it('starts when the owner joins a channel', async () => {
		const { voiceTriggerAction } = await load();
		expect(voiceTriggerAction(absent(OWNER), inChannel(OWNER, 'chan-1'), options)).toBe('start');
	});

	it('stops when the owner leaves', async () => {
		const { voiceTriggerAction } = await load();
		expect(voiceTriggerAction(inChannel(OWNER, 'chan-1'), absent(OWNER), options)).toBe('stop');
	});

	it('does not restart when the owner moves between channels', async () => {
		const { voiceTriggerAction } = await load();
		expect(voiceTriggerAction(inChannel(OWNER, 'chan-1'), inChannel(OWNER, 'chan-2'), options)).toBe('ignore');
	});

	it('ignores an owner re-announced in the same channel', async () => {
		const { voiceTriggerAction } = await load();
		expect(voiceTriggerAction(inChannel(OWNER, 'chan-1'), inChannel(OWNER, 'chan-1'), options)).toBe('ignore');
	});

	it('ignores everyone else, in both directions', async () => {
		const { voiceTriggerAction } = await load();
		expect(voiceTriggerAction(absent('someone'), inChannel('someone', 'chan-1'), options)).toBe('ignore');
		expect(voiceTriggerAction(inChannel('someone', 'chan-1'), absent('someone'), options)).toBe('ignore');
	});

	it('ignores events that carry no state', async () => {
		const { voiceTriggerAction } = await load();
		expect(voiceTriggerAction(null, null, options)).toBe('ignore');
		expect(voiceTriggerAction(absent(OWNER), null, options)).toBe('ignore');
		expect(voiceTriggerAction(null, inChannel(OWNER, 'chan-1'), options)).toBe('ignore');
	});
});
