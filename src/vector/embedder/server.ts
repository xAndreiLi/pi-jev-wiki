/**
 * The shared embedder process: one embedding model for the whole machine.
 *
 * It owns the model and nothing else — it never touches the index store, so killing it cannot damage
 * the index, and it serves exactly one embedder identity, which every reply states outright.
 *
 * This file is both the daemon entry point (spawned by `client.ts` under Node's TypeScript type
 * stripping, so keep the import graph free of enums, parameter properties and namespaces) and a
 * library function the tests host in-process.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalProvider, modelsDir, resolvePreset, type EmbedInput, type EmbeddingProvider } from "../embed.ts";
import { encodeVectors, PROTOCOL_VERSION } from "./protocol.ts";

export interface EmbedderServiceOptions {
	pipePath: string;
	provider: EmbeddingProvider;
	/** Preset key, for display. */
	model: string;
	/** Exit after this long with no clients connected and no requests (0 disables). */
	idleExitMs?: number;
	logPath?: string;
	logMaxBytes?: number;
	onExit?: () => void;
}

export interface EmbedderService {
	readonly pid: number;
	readonly startedAt: string;
	stop(): Promise<void>;
}

interface Request {
	id?: number;
	op?: string;
	kind?: "query" | "document";
	priority?: "interactive" | "batch";
	inputs?: EmbedInput[];
}

const DEFAULT_LOG_MAX_BYTES = 1_048_576;

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * One daemon per agent dir. A pipe name is not enough on Windows — several processes may bind the
 * same name, and two clients starting at once would each load the model. The lock file is the
 * arbiter: whoever creates it first wins, everyone else exits quietly and lets the winner serve.
 */
function claimSingleInstance(lockPath: string): boolean {
	try {
		const holder = Number(readFileSync(lockPath, "utf8").trim());
		if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) return false;
	} catch {
		/* no lock yet, or unreadable: take it */
	}
	try {
		rmSync(lockPath, { force: true });
		writeFileSync(lockPath, String(process.pid), { flag: "wx" });
		return true;
	} catch {
		return false;
	}
}

export async function startEmbedderService(options: EmbedderServiceOptions): Promise<EmbedderService> {
	const startedAt = new Date().toISOString();
	/** Beside the log, so both are per agent dir. */
	const lockPath = options.logPath ? `${options.logPath}.lock` : undefined;
	if (lockPath && !claimSingleInstance(lockPath)) {
		throw new Error("another embedder is already running for this agent dir");
	}
	const sockets = new Set<Socket>();
	const queue: Array<{ priority: "interactive" | "batch"; run: () => Promise<void> }> = [];
	let draining = false;
	let closed = false;
	let idleTimer: NodeJS.Timeout | undefined;

	const depth = () => ({
		interactive: queue.filter((entry) => entry.priority === "interactive").length,
		batch: queue.filter((entry) => entry.priority === "batch").length,
	});

	const log = (message: string): void => {
		if (!options.logPath) return;
		try {
			mkdirSync(dirname(options.logPath), { recursive: true });
			const limit = options.logMaxBytes ?? DEFAULT_LOG_MAX_BYTES;
			try {
				if (statSync(options.logPath).size > limit) renameSync(options.logPath, `${options.logPath}.1`);
			} catch {
				/* first write, nothing to rotate */
			}
			appendFileSync(options.logPath, `${new Date().toISOString()} ${message}\n`);
		} catch {
			/* logging must never break embedding */
		}
	};

	/** Queries jump ahead of document batches so a rebuild cannot starve prompt-time retrieval. */
	const drain = async (): Promise<void> => {
		if (draining) return;
		draining = true;
		try {
			while (queue.length > 0) {
				const index = queue.findIndex((entry) => entry.priority === "interactive");
				const [job] = queue.splice(index >= 0 ? index : 0, 1);
				try {
					await job.run();
				} catch (error) {
					log(`job failed: ${(error as Error).message}`);
				}
			}
		} finally {
			draining = false;
		}
	};

	const enqueue = (priority: "interactive" | "batch", run: () => Promise<void>): Promise<void> =>
		new Promise((resolve, reject) => {
			queue.push({
				priority,
				run: async () => {
					try {
						await run();
						resolve();
					} catch (error) {
						reject(error as Error);
					}
				},
			});
			void drain();
		});

	const hello = () => ({
		protocol: PROTOCOL_VERSION,
		fingerprint: options.provider.fingerprint,
		model: options.model,
		dims: options.provider.dimensions,
		pid: process.pid,
		startedAt,
		queue: depth(),
	});

	const idleExitMs = options.idleExitMs ?? 0;
	const touch = (): void => {
		if (idleExitMs <= 0) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (sockets.size === 0) void stop();
			else touch();
		}, idleExitMs);
		idleTimer.unref();
	};

	const stop = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		if (idleTimer) clearTimeout(idleTimer);
		log(`stopping (pid ${process.pid})`);
		server.close(() => undefined);
		for (const socket of sockets) socket.destroy();
		if (process.platform !== "win32") {
			try {
				unlinkSync(options.pipePath);
			} catch {
				/* already gone */
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
		if (lockPath) rmSync(lockPath, { force: true });
		options.onExit?.();
	};

	const handle = async (request: Request): Promise<Record<string, unknown>> => {
		touch();
		switch (request.op) {
			case "hello":
			case "status":
				return hello();
			case "warm":
				// The provider is created (and therefore loaded) before the daemon starts listening.
				return { modelLoaded: true };
			case "embed": {
				const inputs = Array.isArray(request.inputs) ? request.inputs : [];
				const kind = request.kind === "document" ? "document" : "query";
				const priority = request.priority === "batch" ? "batch" : "interactive";
				let vectors: Float32Array[] = [];
				await enqueue(priority, async () => {
					vectors = await options.provider.embed(inputs, kind);
				});
				return { dims: options.provider.dimensions, vectors: encodeVectors(vectors) };
			}
			case "shutdown":
				setTimeout(() => void stop(), 20);
				return { stopping: true };
			default:
				throw new Error(`unknown op "${String(request.op)}"`);
		}
	};

	const server = createServer((socket) => {
		sockets.add(socket);
		touch();
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			let index: number;
			while ((index = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				if (!line.trim()) continue;
				let request: Request;
				try {
					request = JSON.parse(line) as Request;
				} catch {
					socket.write(`${JSON.stringify({ id: 0, ok: false, error: "malformed request" })}\n`);
					continue;
				}
				void handle(request).then(
					(payload) => socket.write(`${JSON.stringify({ id: request.id ?? 0, ok: true, ...payload })}\n`),
					(error) => socket.write(`${JSON.stringify({ id: request.id ?? 0, ok: false, error: (error as Error).message })}\n`),
				);
			}
		});
		const forget = () => sockets.delete(socket);
		socket.on("error", forget);
		socket.on("close", forget);
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.pipePath, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	log(`listening on ${options.pipePath} (pid ${process.pid}, ${options.provider.fingerprint})`);
	touch();
	return { pid: process.pid, startedAt, stop };
}

/** Daemon entry point: `node server.ts <pipePath> <agentDir> <model> <dtype> <dimensions> <idleExitMs> <logPath> <allowDownload>`. */
async function main(): Promise<void> {
	const [pipePath, agentDir, model, dtype, dimensions, idleExitMs, logPath, allowDownload] = process.argv.slice(2);
	if (!pipePath || !agentDir || !model) {
		console.error("usage: server.ts <pipePath> <agentDir> <model> <dtype> <dimensions> <idleExitMs> <logPath> <allowDownload>");
		process.exit(2);
	}
	const preset = resolvePreset(model);
	const provider = await createLocalProvider({
		preset,
		...(dtype ? { dtype } : {}),
		...(Number(dimensions) > 0 ? { dimensions: Number(dimensions) } : {}),
		cacheDir: modelsDir(agentDir),
		allowDownload: allowDownload === "true",
	});
	await startEmbedderService({
		pipePath,
		provider,
		model,
		idleExitMs: Number(idleExitMs) > 0 ? Number(idleExitMs) : 0,
		...(logPath ? { logPath } : {}),
		onExit: () => process.exit(0),
	});
}

/** Entry detection compares resolved paths: the client may pass either separator style on Windows. */
const invoked = (() => {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
	} catch {
		return false;
	}
})();
if (invoked) {
	main().catch((error: unknown) => {
		// stdio is ignored by the spawning client, so a startup failure must land in the log file.
		const logPath = process.argv[8];
		const line = `${new Date().toISOString()} failed to start: ${(error as Error).message}\n`;
		try {
			if (logPath) {
				mkdirSync(dirname(logPath), { recursive: true });
				appendFileSync(logPath, line);
			}
		} catch {
			/* nothing else we can do */
		}
		process.exit(1);
	});
}
