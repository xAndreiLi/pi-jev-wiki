/**
 * Daemon launcher (plain JavaScript on purpose).
 *
 * Node refuses to strip TypeScript types for files under node_modules, so an installed copy of this
 * package cannot be started with `node .../server.ts`. This shim loads the TypeScript daemon through
 * jiti instead — the same loader pi uses for the extension — which works from any location.
 *
 * argv[1] stays this file, so the daemon's own entry guard is bypassed: the shim calls startFromCli().
 */
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

jiti
	.import("./server.ts")
	.then((module) => module.startFromCli())
	.catch((error) => {
		console.error(`embedder failed: ${error?.message ?? error}`);
		process.exit(1);
	});
