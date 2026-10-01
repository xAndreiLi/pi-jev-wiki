/**
 * ds-001 — hidden grader.
 *
 * Copied into `web/lib/` after the agent has finished, so the prompt specifies the interface and
 * these assertions stay unseen. The bot is stubbed with a local HTTP server: nothing here needs
 * Discord, audio, or a running bot core.
 *
 * Contract under test: `POST /api/actions/<id>`
 *   - `voice.join`  → POST to `<BOT_URL>/api/voice/join` with the same JSON body, return its answer
 *   - `voice.leave` → POST to `<BOT_URL>/api/voice/leave`
 *   - planned but unimplemented (`record.start`, `record.stop`, `notes.publish`, `agent.pause`) → 501
 *   - bot unreachable → 503 with an `error` field, never a silent failure
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface RecordedCall {
	method: string;
	path: string;
	body: string;
}

const recorded: RecordedCall[] = [];
let server: Server | undefined;
let liveBotUrl = '';

beforeAll(async () => {
	server = createServer((request, response) => {
		let body = '';
		request.on('data', (chunk) => (body += chunk));
		request.on('end', () => {
			recorded.push({ method: request.method ?? '', path: request.url ?? '', body });
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ ok: true, path: request.url }));
		});
	});
	await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
	const address = server.address();
	if (address && typeof address === 'object') liveBotUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

/**
 * The route may read BOT_URL at import time or per request; resetting the module registry between
 * cases makes either implementation work.
 */
async function postAction(botUrl: string, id: string, body: unknown = {}): Promise<Response> {
	process.env.BOT_URL = botUrl;
	vi.resetModules();
	const module = (await import('../app/api/actions/[id]/route')) as {
		POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
	};
	return module.POST(
		new Request(`http://panel.test/api/actions/${id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
		{ params: Promise.resolve({ id }) },
	);
}

describe('POST /api/actions/[id]', () => {
	it('performs voice.join against the bot and returns its answer', async () => {
		recorded.length = 0;
		const response = await postAction(liveBotUrl, 'voice.join', { channelId: 'chan-1' });
		expect(response.status).toBe(200);
		const call = recorded.find((entry) => entry.path === '/api/voice/join');
		expect(call, 'the bot never received /api/voice/join').toBeDefined();
		expect(call?.method).toBe('POST');
		expect(call?.body ?? '').toContain('chan-1');
		await expect(response.json()).resolves.toMatchObject({ ok: true });
	});

	it('performs voice.leave against the bot', async () => {
		recorded.length = 0;
		const response = await postAction(liveBotUrl, 'voice.leave');
		expect(response.status).toBe(200);
		expect(recorded.map((entry) => entry.path)).toContain('/api/voice/leave');
	});

	it('still refuses actions that are only planned', async () => {
		const response = await postAction(liveBotUrl, 'notes.publish');
		expect(response.status).toBe(501);
		const body = (await response.json()) as { error?: string };
		expect(body.error).toBeTruthy();
	});

	it('reports an unreachable bot instead of failing silently', async () => {
		// Loopback port 1 is reserved and never listening.
		const response = await postAction('http://127.0.0.1:1', 'voice.join');
		expect(response.status).toBe(503);
		const body = (await response.json()) as { error?: string };
		expect(body.error).toBeTruthy();
	});
});
