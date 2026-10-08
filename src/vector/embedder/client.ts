/**
 * Client for the shared embedder process.
 *
 * Sessions never load the model: they connect to the daemon over a local pipe, starting it when it
 * is not there. The daemon is detached, so it outlives the session that started it and every other
 * session reuses it — one embedder identity for the whole machine, which is what makes stored and
 * query vectors comparable at all.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintFor, resolvePreset, type EmbedInput, type EmbeddingProvider } from "../embed.ts";
import { decodeVector, PROTOCOL_VERSION, type EmbedReply, type HelloReply } from "./protocol.ts";

export interface EmbedderOptions {
	agentDir: string;
	model: string;
	dtype?: string | null;
	dimensions?: number | null;
	idleExitMs?: number;
	logMaxBytes?: number;
	/** Allow the model to be fetched (a first rebuild); queries and warm-ups never do. */
	allowDownload?: boolean;
}

export const DEFAULT_IDLE_EXIT_MS = 30 * 60 * 1000;

/** Queries must answer inside the auto-retrieve budget; document batches may take minutes. */
const QUERY_TIMEOUT_MS = 20_000;
const BATCH_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH_INPUTS = 32;

/**
 * One daemon per agent dir, whatever spelling the caller used: `C:/x`, `C:\x` and `C:\X` must land
 * on the same pipe, or the machine ends up with one model per path spelling.
 */
function canonicalAgentDir(agentDir: string): string {
	const resolved = resolve(agentDir).replace(/\\/g, "/");
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function embedderPipePath(agentDir: string): string {
	const hash = createHash("sha1").update(canonicalAgentDir(agentDir)).digest("hex").slice(0, 12);
	return process.platform === "win32"
		? `\\\\.\\pipe\\pi-jev-wiki-embed-${hash}`
		: join(tmpdir(), `pi-jev-wiki-embed-${hash}.sock`);
}

export function embedderLogPath(agentDir: string): string {
	return join(agentDir, "jev-wiki", "embedder.log");
}

/**
 * The launcher, not `server.ts`: Node will not strip types for files under node_modules, so an
 * installed copy must be started through the jiti shim. See daemon.mjs.
 */
export function embedderServerPath(): string {
	return fileURLToPath(new URL("./daemon.mjs", import.meta.url));
}

/** Node runs TypeScript by default from 22.18; below that the flag is required. */
function needsTypeStrippingFlag(): boolean {
	const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
	return major < 22 || (major === 22 && minor < 18);
}

export function spawnEmbedder(options: EmbedderOptions): number | undefined {
	const args = [
		...(needsTypeStrippingFlag() ? ["--experimental-strip-types"] : []),
		embedderServerPath(),
		embedderPipePath(options.agentDir),
		options.agentDir,
		options.model,
		options.dtype ?? "",
		String(options.dimensions ?? 0),
		String(options.idleExitMs ?? DEFAULT_IDLE_EXIT_MS),
		embedderLogPath(options.agentDir),
		options.allowDownload ? "true" : "false",
	];
	const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", windowsHide: true });
	child.unref();
	return child.pid;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

class SharedEmbedder implements EmbeddingProvider {
	readonly id: string;
	readonly fingerprint: string;
	readonly dimensions: number;
	private readonly pipe: string;
	private socket?: Socket;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
	private connecting?: Promise<void>;

	constructor(private readonly options: EmbedderOptions) {
		const preset = resolvePreset(options.model);
		this.dimensions = options.dimensions ?? preset.dimensions;
		this.fingerprint = fingerprintFor(options.model, { dtype: options.dtype ?? null, dimensions: options.dimensions ?? null });
		this.id = `${preset.id}:${options.dtype ?? preset.dtype}`;
		this.pipe = embedderPipePath(options.agentDir);
	}

	async embed(inputs: EmbedInput[], kind: "query" | "document"): Promise<Float32Array[]> {
		if (inputs.length === 0) return [];
		const timeout = kind === "query" ? QUERY_TIMEOUT_MS : BATCH_TIMEOUT_MS;
		const out: Float32Array[] = [];
		for (let start = 0; start < inputs.length; start += BATCH_INPUTS) {
			const batch = inputs.slice(start, start + BATCH_INPUTS);
			const reply = await this.embedBatch(batch, kind, timeout);
			if (!Array.isArray(reply.vectors) || reply.vectors.length !== batch.length) {
				throw new Error(`The shared embedder returned ${reply.vectors?.length ?? 0} vectors for ${batch.length} inputs.`);
			}
			for (const vector of reply.vectors) out.push(decodeVector(vector));
		}
		return out;
	}

	/**
	 * One batch, retried once on a lost connection: the daemon may have idle-exited, been stopped, or
	 * been replaced between batches, and losing a whole wiki's index run to that is not acceptable.
	 */
	private async embedBatch(batch: EmbedInput[], kind: "query" | "document", timeout: number): Promise<EmbedReply> {
		const request = { op: "embed", kind, priority: kind === "query" ? "interactive" : "batch", inputs: batch } as const;
		try {
			await this.ensure();
			return (await this.request(request, timeout)) as unknown as EmbedReply;
		} catch (error) {
			this.drop();
			await this.ensure();
			try {
				return (await this.request(request, timeout)) as unknown as EmbedReply;
			} catch (retryError) {
				throw new Error(`The shared embedder failed twice (${describe(error)} → ${describe(retryError)}).`);
			}
		}
	}

	/** Non-spawning status check: report, never start a process. */
	async peek(): Promise<HelloReply | undefined> {
		try {
			await this.attach(300);
			return (await this.request({ op: "hello" }, 3000)) as unknown as HelloReply;
		} catch {
			this.drop();
			return undefined;
		}
	}

	/** Identity handshake without embedding anything; starts the daemon if needed. */
	async hello(): Promise<HelloReply> {
		await this.ensure();
		return (await this.request({ op: "hello" }, 10_000)) as unknown as HelloReply;
	}

	async stop(): Promise<boolean> {
		// Connect first, without spawning: a fresh session has no socket yet, and stopping a running
		// daemon must not depend on having already talked to it.
		if (!this.socket || this.socket.destroyed) {
			try {
				await this.attach(1000);
			} catch {
				return false;
			}
		}
		try {
			await this.request({ op: "shutdown" }, 5000);
			this.drop();
			return true;
		} catch {
			this.drop();
			return false;
		}
	}

	private drop(): void {
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error("The shared embedder connection closed."));
		}
		this.pending.clear();
		this.socket?.destroy();
		this.socket = undefined;
		this.buffer = "";
	}

	private attach(timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = connect(this.pipe);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("timed out connecting to the shared embedder"));
			}, timeoutMs);
			socket.once("connect", () => {
				clearTimeout(timer);
				socket.setNoDelay(true);
				this.socket = socket;
				this.buffer = "";
				socket.on("data", (chunk: Buffer) => this.onData(chunk));
				socket.on("close", () => {
					if (this.socket === socket) this.drop();
				});
				socket.on("error", () => {
					if (this.socket === socket) this.drop();
				});
				resolve();
			});
			socket.once("error", (error) => {
				clearTimeout(timer);
				socket.destroy();
				reject(error);
			});
		});
	}

	private onData(chunk: Buffer): void {
		this.buffer += chunk.toString();
		let index: number;
		while ((index = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			if (!line.trim()) continue;
			let reply: { id?: number; ok?: boolean; error?: string } & Record<string, unknown>;
			try {
				reply = JSON.parse(line) as typeof reply;
			} catch {
				continue;
			}
			const entry = this.pending.get(Number(reply.id));
			if (!entry) continue;
			this.pending.delete(Number(reply.id));
			clearTimeout(entry.timer);
			if (reply.ok === false) entry.reject(new Error(reply.error ?? "the shared embedder failed"));
			else entry.resolve(reply);
		}
	}

	private request(payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
		const socket = this.socket;
		if (!socket || socket.destroyed) return Promise.reject(new Error("The shared embedder is not connected."));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`The shared embedder did not answer ${String(payload.op)} within ${Math.round(timeoutMs / 1000)}s.`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			socket.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
				if (!error) return;
				this.pending.delete(id);
				clearTimeout(timer);
				reject(error);
			});
		});
	}

	private async ensure(): Promise<void> {
		if (this.socket && !this.socket.destroyed) return;
		if (!this.connecting) this.connecting = this.connectOrSpawn().finally(() => (this.connecting = undefined));
		return this.connecting;
	}

	private async connectOrSpawn(): Promise<void> {
		if (await this.reach()) return;
		// Nothing healthy is listening (or the wrong identity was evicted): start a matching daemon.
		spawnEmbedder(this.options);
		if (await this.waitForDaemon()) return;
		throw new Error(
			`The shared embedder did not start. See ${embedderLogPath(this.options.agentDir)} — semantic search is unavailable until it runs.`,
		);
	}

	/** Attach to a running daemon and verify its identity. Evicts a reachable but mismatched daemon. */
	private async reach(): Promise<boolean> {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				await this.attach(1000);
			} catch {
				await delay(100);
				continue;
			}
			if (await this.matches()) return true;
			// Reachable but not ours: shut it down so the replacement can bind the same pipe.
			await this.request({ op: "shutdown" }, 3000).catch(() => undefined);
			this.drop();
			await delay(300);
			return false;
		}
		return false;
	}

	private async waitForDaemon(): Promise<boolean> {
		const deadline = Date.now() + (this.options.allowDownload ? 120_000 : 20_000);
		while (Date.now() < deadline) {
			await delay(150);
			try {
				await this.attach(1000);
			} catch {
				continue;
			}
			if (await this.matches()) return true;
			this.drop();
			return false;
		}
		return false;
	}

	/** True when the reachable daemon speaks this protocol and serves this identity. */
	private async matches(): Promise<boolean> {
		try {
			const hello = (await this.request({ op: "hello" }, 5000)) as unknown as HelloReply;
			return hello.protocol === PROTOCOL_VERSION && hello.fingerprint === this.fingerprint && hello.dims === this.dimensions;
		} catch {
			this.drop();
			return false;
		}
	}
}

const instances = new Map<string, SharedEmbedder>();

/** One client per embedder identity in this process. */
export function sharedEmbedderFor(options: EmbedderOptions): SharedEmbedder {
	const key = `${canonicalAgentDir(options.agentDir)}|${fingerprintFor(options.model, { dtype: options.dtype ?? null, dimensions: options.dimensions ?? null })}`;
	let embedder = instances.get(key);
	if (!embedder) {
		embedder = new SharedEmbedder(options);
		instances.set(key, embedder);
	}
	return embedder;
}

/** Start the daemon and load the model, so the first prompt does not pay for it. */
export async function warmEmbedder(options: EmbedderOptions): Promise<boolean> {
	try {
		await sharedEmbedderFor(options).hello();
		return true;
	} catch {
		return false;
	}
}

export async function embedderStatusFor(options: EmbedderOptions): Promise<HelloReply | undefined> {
	return sharedEmbedderFor(options).peek();
}

export async function stopEmbedder(options: EmbedderOptions): Promise<boolean> {
	return sharedEmbedderFor(options).stop();
}
