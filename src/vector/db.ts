/**
 * Vector storage: PGlite (WASM Postgres) + pgvector. One user-level database so
 * every registered wiki is searchable from any session. The DB is a derived
 * cache — knowledge always lives in the markdown wikis.
 */
import { mkdir } from "node:fs/promises";

export interface VectorRow {
	wiki: string;
	path: string;
	key: string;
	kind: string;
	claimId?: string | null;
	status?: string | null;
	title: string;
	text: string;
	hash: string;
	model: string;
	dim: number;
	embedding: Float32Array;
}

export interface KnnHit {
	wiki: string;
	path: string;
	key: string;
	kind: string;
	claimId?: string | null;
	status?: string | null;
	title: string;
	text: string;
	score: number;
}

export interface IndexState {
	wiki: string;
	model: string;
	dim: number;
	chunks: number;
	updatedAt: string;
}

export interface KnnOptions {
	model: string;
	dim: number;
	limit: number;
	wikis?: string[];
	kinds?: string[];
	includeInactive?: boolean;
}

export interface VectorDb {
	init(): Promise<void>;
	hasAny(): Promise<boolean>;
	hashes(wiki: string, model: string, paths?: string[]): Promise<Map<string, { path: string; hash: string }>>;
	upsert(rows: VectorRow[]): Promise<void>;
	deleteKeys(wiki: string, entries: Array<{ path: string; key: string }>): Promise<number>;
	purgeWiki(wiki: string): Promise<void>;
	purgeOtherModels(wiki: string, model: string): Promise<number>;
	knn(embedding: Float32Array, options: KnnOptions): Promise<KnnHit[]>;
	state(wiki: string): Promise<IndexState | undefined>;
	setState(state: IndexState): Promise<void>;
	counts(): Promise<Array<{ wiki: string; model: string; chunks: number }>>;
	close(): Promise<void>;
}

const DDL = [
	`CREATE TABLE IF NOT EXISTS wiki_chunks (
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
		dim INTEGER NOT NULL,
		embedding vector NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (wiki, path, key)
	)`,
	`CREATE INDEX IF NOT EXISTS wiki_chunks_wiki_idx ON wiki_chunks (wiki)`,
	`CREATE TABLE IF NOT EXISTS wiki_index_state (
		wiki TEXT PRIMARY KEY,
		model TEXT NOT NULL,
		dim INTEGER NOT NULL,
		chunks INTEGER NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
];

export function formatVector(embedding: Float32Array): string {
	const parts = new Array<string>(embedding.length);
	for (let i = 0; i < embedding.length; i++) parts[i] = embedding[i].toFixed(5);
	return `[${parts.join(",")}]`;
}

export class PGliteVectorDb implements VectorDb {
	private db: InstanceType<typeof import("@electric-sql/pglite").PGlite> | undefined;

	constructor(private readonly dataDir: string) {}

	private async handle(): Promise<InstanceType<typeof import("@electric-sql/pglite").PGlite>> {
		if (this.db) return this.db;
		let pglite: typeof import("@electric-sql/pglite");
		let pgvector: typeof import("@electric-sql/pglite-pgvector");
		try {
			pglite = await import("@electric-sql/pglite");
			pgvector = await import("@electric-sql/pglite-pgvector");
		} catch (error) {
			throw new Error(
				"Semantic search needs the optional dependencies @electric-sql/pglite and @electric-sql/pglite-pgvector. Install them or set search.vector.enabled false.",
				{ cause: error },
			);
		}
		await mkdir(this.dataDir, { recursive: true });
		const db = new pglite.PGlite({ dataDir: this.dataDir, extensions: { vector: pgvector.vector } });
		await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
		this.db = db;
		return db;
	}

	async init(): Promise<void> {
		const db = await this.handle();
		for (const statement of DDL) await db.exec(statement);
	}

	async hasAny(): Promise<boolean> {
		const db = await this.handle();
		const result = await db.query<{ one: number }>("SELECT 1 AS one FROM wiki_chunks LIMIT 1");
		return result.rows.length > 0;
	}

	async hashes(wiki: string, model: string, paths?: string[]): Promise<Map<string, { path: string; hash: string }>> {
		const db = await this.handle();
		const result = paths && paths.length > 0
			? await db.query<{ path: string; key: string; hash: string }>(
					"SELECT path, key, hash FROM wiki_chunks WHERE wiki = $1 AND model = $2 AND path = ANY($3)",
					[wiki, model, paths],
				)
			: await db.query<{ path: string; key: string; hash: string }>(
					"SELECT path, key, hash FROM wiki_chunks WHERE wiki = $1 AND model = $2",
					[wiki, model],
				);
		return new Map(result.rows.map((row) => [`${row.path}\u0000${row.key}`, { path: row.path, hash: row.hash }]));
	}

	async upsert(rows: VectorRow[]): Promise<void> {
		if (rows.length === 0) return;
		const db = await this.handle();
		const columns = 13;
		for (let start = 0; start < rows.length; start += 50) {
			const batch = rows.slice(start, start + 50);
			const values: unknown[] = [];
			const placeholders = batch.map((row, index) => {
				const base = index * columns;
				values.push(
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
					row.dim,
					formatVector(row.embedding),
					new Date().toISOString(),
				);
				return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}::vector, $${base + 13}::timestamptz)`;
			});
			await db.query(
				`INSERT INTO wiki_chunks (wiki, path, key, kind, claim_id, status, title, text, hash, model, dim, embedding, updated_at)
				 VALUES ${placeholders.join(", ")}
				 ON CONFLICT (wiki, path, key) DO UPDATE SET
					kind = EXCLUDED.kind, claim_id = EXCLUDED.claim_id, status = EXCLUDED.status,
					title = EXCLUDED.title, text = EXCLUDED.text, hash = EXCLUDED.hash,
					model = EXCLUDED.model, dim = EXCLUDED.dim, embedding = EXCLUDED.embedding,
					updated_at = EXCLUDED.updated_at`,
				values,
			);
		}
	}

	async deleteKeys(wiki: string, entries: Array<{ path: string; key: string }>): Promise<number> {
		if (entries.length === 0) return 0;
		const db = await this.handle();
		let deleted = 0;
		for (const entry of entries) {
			const result = await db.query("DELETE FROM wiki_chunks WHERE wiki = $1 AND path = $2 AND key = $3", [wiki, entry.path, entry.key]);
			deleted += result.affectedRows ?? 0;
		}
		return deleted;
	}

	async purgeWiki(wiki: string): Promise<void> {
		const db = await this.handle();
		await db.query("DELETE FROM wiki_chunks WHERE wiki = $1", [wiki]);
		await db.query("DELETE FROM wiki_index_state WHERE wiki = $1", [wiki]);
	}

	async purgeOtherModels(wiki: string, model: string): Promise<number> {
		const db = await this.handle();
		const result = await db.query("DELETE FROM wiki_chunks WHERE wiki = $1 AND model <> $2", [wiki, model]);
		return result.affectedRows ?? 0;
	}

	async knn(embedding: Float32Array, options: KnnOptions): Promise<KnnHit[]> {
		const db = await this.handle();
		const conditions = ["model = $2", "dim = $3"];
		const params: unknown[] = [formatVector(embedding), options.model, options.dim];
		if (options.wikis && options.wikis.length > 0) {
			params.push(options.wikis);
			conditions.push(`wiki = ANY($${params.length})`);
		}
		if (options.kinds && options.kinds.length > 0) {
			params.push(options.kinds);
			conditions.push(`kind = ANY($${params.length})`);
		}
		if (!options.includeInactive) {
			conditions.push("(status IS NULL OR status IN ('verified', 'user-stated', 'needs_recheck'))");
		}
		params.push(Math.max(1, options.limit));
		const result = await db.query<KnnHit>(
			`SELECT wiki, path, key, kind, claim_id AS "claimId", status, title, text,
			        1 - (embedding <=> $1::vector) AS score
			 FROM wiki_chunks
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY embedding <=> $1::vector
			 LIMIT $${params.length}`,
			params,
		);
		return result.rows;
	}

	async state(wiki: string): Promise<IndexState | undefined> {
		const db = await this.handle();
		const result = await db.query<{ wiki: string; model: string; dim: number; chunks: number; updated_at: string }>(
			"SELECT wiki, model, dim, chunks, updated_at FROM wiki_index_state WHERE wiki = $1",
			[wiki],
		);
		const row = result.rows[0];
		return row ? { wiki: row.wiki, model: row.model, dim: row.dim, chunks: row.chunks, updatedAt: String(row.updated_at) } : undefined;
	}

	async setState(state: IndexState): Promise<void> {
		const db = await this.handle();
		await db.query(
			`INSERT INTO wiki_index_state (wiki, model, dim, chunks, updated_at)
			 VALUES ($1, $2, $3, $4, now())
			 ON CONFLICT (wiki) DO UPDATE SET model = EXCLUDED.model, dim = EXCLUDED.dim, chunks = EXCLUDED.chunks, updated_at = now()`,
			[state.wiki, state.model, state.dim, state.chunks],
		);
	}

	async counts(): Promise<Array<{ wiki: string; model: string; chunks: number }>> {
		const db = await this.handle();
		const result = await db.query<{ wiki: string; model: string; chunks: number }>(
			"SELECT wiki, model, count(*)::int AS chunks FROM wiki_chunks GROUP BY wiki, model ORDER BY wiki",
		);
		return result.rows;
	}

	async close(): Promise<void> {
		await this.db?.close();
		this.db = undefined;
	}
}

const instances = new Map<string, PGliteVectorDb>();

/** Process-wide shared handle per data directory. */
export function vectorDbFor(dataDir: string): PGliteVectorDb {
	let db = instances.get(dataDir);
	if (!db) {
		db = new PGliteVectorDb(dataDir);
		instances.set(dataDir, db);
	}
	return db;
}
