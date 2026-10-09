/**
 * Daemon launcher (plain JavaScript on purpose).
 *
 * Node refuses to strip TypeScript types for files under node_modules, so an installed copy of this
 * package cannot be started with `node .../server.ts`. This shim loads the TypeScript daemon through
 * jiti instead — the same loader pi uses for the extension — which works from any location.
 *
 * argv[1] stays this file, so the daemon's own entry guard is bypassed: the shim calls startFromCli().
 * That also bypasses the guard's failure logging, so the shim does it: the client spawns the daemon
 * with stdio ignored, and the log file is the only place a startup failure can surface.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

function logStartupFailure(message) {
	const logPath = process.argv[8];
	if (!logPath) return;
	try {
		mkdirSync(dirname(logPath), { recursive: true });
		appendFileSync(logPath, `${new Date().toISOString()} failed to start: ${message}\n`);
	} catch {
		/* nothing else we can do */
	}
}

jiti
	.import("./server.ts")
	.then((module) => module.startFromCli())
	.catch((error) => {
		const message = error?.message ?? String(error);
		console.error(`embedder failed: ${message}`);
		logStartupFailure(message);
		process.exit(1);
	});
