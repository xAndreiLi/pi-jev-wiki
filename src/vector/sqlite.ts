/**
 * SQLite-backed vector store (built-in `node:sqlite`, no dependency).
 *
 * Design rules this file exists to enforce:
 * - One connection per operation, closed immediately. SQLite supplies multi-process locking, so the
 *   store needs no owner, and a reset is a file delete that works while sessions run (a long-lived
 *   handle would make the file undeletable on Windows).
 * - The schema is re-created on every open, so a store deleted underneath a live session reads as
 *   "not indexed yet" instead of failing.
 * - Rows carry an embedder fingerprint and every read filters on it: vectors from two embedders are
 *   never compared.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IndexState, KnnHit, KnnOptions, VectorDb, VectorRow } from "./db.ts";

export const STORE_FILE = "index.sqlite";

/** The store path for an agent dir. Kept inside the `vector/` dir so the reset target never moves. */
export function storePath(dataDir: string): string {
	return join(dataDir, STORE_FILE);
}

/** Delete the store (and its WAL sidecars). Safe whenever no operation is in flight. */
export async function resetStore(dataDir: string): Promise<boolean> {
	const file = storePath(dataDir);
	let existed = false;
	for (const path of [file, `${file}-wal`, `${file}-shm`]) {
		existed = (await stat(path).then(() => true).catch(() => false)) || existed;
		await rm(path, { force: true });
	}
	return existed;
}

/** Reported by `wiki_index status`. */
export async function storeBytes(dataDir: string): Promise<number> {
	let total = 0;
	for (const path of [storePath(dataDir), `${storePath(dataDir)}-wal`]) {
		total += (await stat(path).catch(() => undefined))?.size ?? 0;
	}
	return total;
}

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS chunks (
		wiki TEXT NOT NULL,
		path TEXT NOT NULL,
		key TEXT NOT NULL,
		kind TEXT NOT NULL,
		claim_id TEXT,
		status TEXT,
		title TEXT NOT NULL DEFAULT '',
		text TEXT NOT NULL,
		hash TEXT NOT NULL,
		model TEXT NOT NULL,
		fingerprint TEXT NOT NULL,
		dim INTEGER NOT NULL,
		embedding BLOB NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (wiki, path, key)
	)`,
	`CREATE INDEX IF NOT EXISTS chunks_identity_idx ON chunks (wiki, fingerprint)`,
	`CREATE TABLE IF NOT EXISTS index_state (
		wiki TEXT PRIMARY KEY,
		model TEXT NOT NULL,
		fingerprint TEXT NOT NULL,
		dim INTEGER NOT NULL,
		chunks INTEGER NOT NULL,
		updated_at TEXT NOT NULL
	)`,
];

let ctor: typeof DatabaseSync | undefined;
let patched = false;

/**
 * `node:sqlite` is experimental below Node 24.15 and prints one warning per process at import time.
 * The extension lives inside pi's process, so filter that single line out of the terminal.
 */
function suppressExperimentalWarning(): void {
	if (patched) return;
	patched = true;
	const original = process.emitWarning.bind(process);
	process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
		const text = typeof warning === "string" ? warning : String((warning as Error | undefined)?.message ?? "");
		if (text.includes("SQLite is an experimental feature")) return;
		return (original as unknown as (first: unknown, ...args: unknown[]) => void)(warning, ...rest);
	}) as typeof process.emitWarning;
}

async function databaseCtor(): Promise<typeof DatabaseSync> {
	if (ctor) return ctor;
	suppressExperimentalWarning();
	try {
		const sqlite = await import("node:sqlite");
		ctor = sqlite.DatabaseSync;
	} catch (error) {
		throw new Error(
			"The semantic index needs the built-in node:sqlite module (Node 22.13 or newer). Set search.vector.enabled false to turn the index off.",
			{ cause: error },
		);
	}
	return ctor;
}

type Row = Record<string, unknown>;

function viewOf(blob: unknown): Float32Array | undefined {
	if (!(blob instanceof Uint8Array) || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return undefined;
	return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

export class SqliteVectorDb implements VectorDb {
	constructor(private readonly dataDir: string) {}

	private file(): string {
		return storePath(this.dataDir);
	}

	/**
	 * Open, prepare, run, close. `busy_timeout` is set first and on its own: switching to WAL needs an
	 * exclusive lock and throws SQLITE_BUSY immediately if the timeout is not already in force.
	 */
	private async with<T>(operation: (db: DatabaseSync) => T): Promise<T> {
		if (this.dataDir.startsWith("\\\\") || this.dataDir.startsWith("//")) {
			throw new Error(`The semantic index store must live on a local filesystem; ${this.dataDir} is a network path.`);
		}
		const Database = await databaseCtor();
		await mkdir(this.dataDir, { recursive: true });
		const db = new Database(this.file());
		try {
			db.exec("PRAGMA busy_timeout = 5000");
			db.exec("PRAGMA journal_mode = WAL");
			db.exec("PRAGMA synchronous = NORMAL");
			for (const statement of SCHEMA) db.exec(statement);
			return operation(db);
		} finally {
			db.close();
		}
	}

	async init(): Promise<void> {
		await this.with(() => undefined);
	}

	async hasAny(): Promise<boolean> {
		return this.with((db) => db.prepare("SELECT 1 AS one FROM chunks LIMIT 1").get() !== undefined);
	}

	async hashes(wiki: string, fingerprint: string, paths?: string[]): Promise<Map<string, { path: string; hash: string }>> {
		return this.with((db) => {
			const rows = (paths && paths.length > 0
				? db
						.prepare(
							`SELECT path, key, hash FROM chunks WHERE wiki = ? AND fingerprint = ? AND path IN (${paths.map(() => "?").join(",")})`,
						)
						.all(wiki, fingerprint, ...paths)
				: db.prepare("SELECT path, key, hash FROM chunks WHERE wiki = ? AND fingerprint = ?").all(wiki, fingerprint)) as Row[];
			return new Map(rows.map((row) => [`${row.path as string}\u0000${row.key as string}`, { path: row.path as string, hash: row.hash as string }]));
		});
	}

	async upsert(rows: VectorRow[]): Promise<void> {
		if (rows.length === 0) return;
		await this.with((db) => {
			const statement = db.prepare(
				`INSERT INTO chunks (wiki, path, key, kind, claim_id, status, title, text, hash, model, fingerprint, dim, embedding, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT (wiki, path, key) DO UPDATE SET
					kind = excluded.kind, claim_id = excluded.claim_id, status = excluded.status,
					title = excluded.title, text = excluded.text, hash = excluded.hash,
					model = excluded.model, fingerprint = excluded.fingerprint, dim = excluded.dim,
					embedding = excluded.embedding, updated_at = excluded.updated_at`,
			);
			const now = new Date().toISOString();
			db.exec("BEGIN IMMEDIATE");
			try {
				for (const row of rows) {
					statement.run(
						row.wiki,
						row.path,
						row.key,
						row.kind,
						row.claimId ?? null,
						row.status ?? null,
						row.title,
						row.text,
						row.hash,
						row.model,
						row.fingerprint,
						row.dim,
						Buffer.from(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength),
						now,
					);
				}
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		});
	}

	async deleteKeys(wiki: string, entries: Array<{ path: string; key: string }>): Promise<number> {
		if (entries.length === 0) return 0;
		return this.with((db) => {
			const statement = db.prepare("DELETE FROM chunks WHERE wiki = ? AND path = ? AND key = ?");
			db.exec("BEGIN IMMEDIATE");
			let deleted = 0;
			try {
				for (const entry of entries) deleted += Number(statement.run(wiki, entry.path, entry.key).changes ?? 0);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
			return deleted;
		});
	}

	async purgeWiki(wiki: string): Promise<void> {
		await this.with((db) => {
			db.prepare("DELETE FROM chunks WHERE wiki = ?").run(wiki);
			db.prepare("DELETE FROM index_state WHERE wiki = ?").run(wiki);
		});
	}

	async purgeOtherIdentities(wiki: string, fingerprint: string): Promise<number> {
		return this.with((db) => Number(db.prepare("DELETE FROM chunks WHERE wiki = ? AND fingerprint <> ?").run(wiki, fingerprint).changes ?? 0));
	}

	async knn(embedding: Float32Array, options: KnnOptions): Promise<KnnHit[]> {
		return this.with((db) => {
			const conditions = ["fingerprint = ?", "dim = ?"];
			const params: unknown[] = [options.fingerprint, options.dim];
			if (options.wikis && options.wikis.length > 0) {
				conditions.push(`wiki IN (${options.wikis.map(() => "?").join(",")})`);
				params.push(...options.wikis);
			}
			if (options.kinds && options.kinds.length > 0) {
				conditions.push(`kind IN (${options.kinds.map(() => "?").join(",")})`);
				params.push(...options.kinds);
			}
			if (!options.includeInactive) conditions.push("(status IS NULL OR status IN ('verified', 'user_stated', 'needs_recheck'))");

			const rows = db
				.prepare(
					`SELECT wiki, path, key, kind, claim_id, status, title, text, embedding FROM chunks
					 WHERE ${conditions.join(" AND ")}`,
				)
				.all(...(params as never[])) as Row[];

			// Exact cosine: the query is normalized here, the row norm is divided out per row, so
			// unnormalized writers cannot distort the ranking.
			const query = normalize(embedding);
			const scored: KnnHit[] = [];
			for (const row of rows) {
				const vector = viewOf(row.embedding);
				if (!vector || vector.length !== options.dim) continue;
				let dot = 0;
				let norm = 0;
				for (let i = 0; i < vector.length; i++) {
					dot += vector[i] * query[i];
					norm += vector[i] * vector[i];
				}
				if (norm === 0) continue;
				scored.push({
					wiki: row.wiki as string,
					path: row.path as string,
					key: row.key as string,
					kind: row.kind as string,
					claimId: (row.claim_id as string | null) ?? null,
					status: (row.status as string | null) ?? null,
					title: row.title as string,
					text: row.text as string,
					score: dot / Math.sqrt(norm),
				});
			}
			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, Math.max(1, options.limit));
		});
	}

	async state(wiki: string): Promise<IndexState | undefined> {
		return this.with((db) => {
			const row = db
				.prepare("SELECT wiki, model, fingerprint, dim, chunks, updated_at FROM index_state WHERE wiki = ?")
				.get(wiki) as Row | undefined;
			if (!row) return undefined;
			return {
				wiki: row.wiki as string,
				model: row.model as string,
				fingerprint: row.fingerprint as string,
				dim: Number(row.dim),
				chunks: Number(row.chunks),
				updatedAt: String(row.updated_at),
			};
		});
	}

	async setState(state: IndexState): Promise<void> {
		await this.with((db) => {
			db.prepare(
				`INSERT INTO index_state (wiki, model, fingerprint, dim, chunks, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT (wiki) DO UPDATE SET
					model = excluded.model, fingerprint = excluded.fingerprint, dim = excluded.dim,
					chunks = excluded.chunks, updated_at = excluded.updated_at`,
			).run(state.wiki, state.model, state.fingerprint, state.dim, state.chunks, state.updatedAt);
		});
	}

	async counts(): Promise<Array<{ wiki: string; fingerprint: string; chunks: number }>> {
		return this.with((db) => {
			const rows = db
				.prepare("SELECT wiki, fingerprint, count(*) AS chunks FROM chunks GROUP BY wiki, fingerprint ORDER BY wiki")
				.all() as Row[];
			return rows.map((row) => ({ wiki: row.wiki as string, fingerprint: row.fingerprint as string, chunks: Number(row.chunks) }));
		});
	}

	/** Nothing is held open between operations, so there is nothing to release. */
	async close(): Promise<void> {}
}

function normalize(vector: Float32Array): Float32Array {
	let norm = 0;
	for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
	norm = Math.sqrt(norm);
	if (norm === 0) return vector;
	const out = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
	return out;
}
