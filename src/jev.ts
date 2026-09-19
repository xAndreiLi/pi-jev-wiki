/**
 * Minimal TypeSafe / Jev client.
 *
 * Endpoint contract (native schema):
 *   POST {baseUrl}  Authorization: Bearer <key>
 *   { model, state, questions: { key: Question } }
 *   -> { model, answers: { key: Answer }, usage: { input_tokens, output_tokens }, meta? }
 *
 * Chat completions do NOT work with decision models. This client is provider-agnostic:
 * TypeSafe direct, OpenRouter `/api/alpha/decisions`, and AI/ML API all accept this schema.
 */

export type JevQuestion =
	| { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
	| { type: "choice"; instructions: string; criteria: Record<string, string | null> }
	| { type: "score"; instructions: string; criteria: string[] };

export interface NoulAnswer {
	type: "noul";
	noul: number;
}
export interface ChoiceAnswer {
	type: "choice";
	choice: string;
	confidence: number;
	probabilities: Record<string, number>;
}
export interface ScoreAnswer {
	type: "score";
	score: number;
	confidence: number;
	legend: Record<string, string>;
	probabilities: Record<string, number>;
}
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevUsage {
	input_tokens: number;
	output_tokens: number;
	cost?: number;
}

export interface JevResponse {
	model: string;
	provider?: string;
	answers: Record<string, JevAnswer>;
	usage: JevUsage;
	meta?: unknown;
}

export interface JevClientOptions {
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutMs?: number;
	maxRetries?: number;
	fetchImpl?: typeof fetch;
	userAgent?: string;
}

export class JevError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(message: string, status: number, body: unknown) {
		super(message);
		this.name = "JevError";
		this.status = status;
		this.body = body;
	}
}

export function noul(instructions: string, criteria?: { true: string; false: string }): JevQuestion {
	return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

export function choice(instructions: string, criteria: Record<string, string | null>): JevQuestion {
	return { type: "choice", instructions, criteria };
}

export function score(instructions: string, criteria: string[]): JevQuestion {
	return { type: "score", instructions, criteria };
}

export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JevClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;
	private readonly timeoutMs: number;
	private readonly maxRetries: number;
	private readonly fetchImpl: typeof fetch;
	private readonly userAgent: string;
	readonly totals: JevUsage = { input_tokens: 0, output_tokens: 0, cost: 0 };

	constructor(options: JevClientOptions) {
		this.baseUrl = options.baseUrl;
		this.apiKey = options.apiKey;
		this.model = options.model;
		this.timeoutMs = options.timeoutMs ?? 60_000;
		this.maxRetries = options.maxRetries ?? 3;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.userAgent = options.userAgent ?? "jev-wiki/0.1";
	}

	async systemOne(
		state: unknown,
		questions: Record<string, JevQuestion>,
		options?: { signal?: AbortSignal; model?: string; timeoutMs?: number },
	): Promise<JevResponse> {
		const body = JSON.stringify({ model: options?.model ?? this.model, state, questions });
		let lastError: unknown;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			const timeout = AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs);
			const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
			let response: Response;
			try {
				response = await this.fetchImpl(this.baseUrl, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${this.apiKey}`,
						"user-agent": this.userAgent,
					},
					body,
					signal,
				});
			} catch (error) {
				lastError = error;
				if (attempt < this.maxRetries) {
					await sleep(500 * 2 ** attempt);
					continue;
				}
				throw new JevError(`Jev request failed: ${String((error as Error)?.message ?? error)}`, 0, undefined);
			}

			if (response.ok) {
				const payload = (await response.json()) as JevResponse;
				this.totals.input_tokens += payload.usage?.input_tokens ?? 0;
				this.totals.output_tokens += payload.usage?.output_tokens ?? 0;
				this.totals.cost = (this.totals.cost ?? 0) + (payload.usage?.cost ?? 0);
				return payload;
			}

			const retryable = response.status === 429 || response.status === 529 || response.status >= 500;
			const text = await response.text().catch(() => "");
			let parsed: unknown = text;
			try {
				parsed = JSON.parse(text);
			} catch {
				/* keep text */
			}
			lastError = new JevError(`Jev HTTP ${response.status}: ${text.slice(0, 300)}`, response.status, parsed);
			if (!retryable || attempt === this.maxRetries) throw lastError;

			const retryAfter = Number(response.headers.get("retry-after"));
			const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
			await sleep(delay);
		}

		throw lastError instanceof Error ? lastError : new JevError("Jev request failed", 0, undefined);
	}
}

/** Convenience: build a client from a resolved config. */
export function createJevClient(config: { baseUrl: string; model: string }, apiKey: string, options?: Partial<JevClientOptions>): JevClient {
	return new JevClient({ baseUrl: config.baseUrl, model: config.model, apiKey, ...options });
}

export function isNoul(answer: JevAnswer | undefined): answer is NoulAnswer {
	return answer?.type === "noul";
}
export function isChoice(answer: JevAnswer | undefined): answer is ChoiceAnswer {
	return answer?.type === "choice";
}
export function isScore(answer: JevAnswer | undefined): answer is ScoreAnswer {
	return answer?.type === "score";
}
