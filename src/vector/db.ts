/**
 * Vector storage interface. The store is a derived cache — knowledge always lives in the markdown
 * wikis — and rows are keyed by an embedder fingerprint, not just a model name, so vectors from two
 * different embedders can never be compared by accident.
 *
 * The implementation is SQLite (`src/vector/sqlite.ts`): it locks across processes, so no session
 * owns the store and a reset is a file delete.
 */
import { SqliteVectorDb } from "./sqlite.ts";

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
	/** Preset key for display ("performance" | "quality"). */
	model: string;
	/** Embedder identity that produced `embedding` — the value queries filter on. */
	fingerprint: string;
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
	fingerprint: string;
	dim: number;
	chunks: number;
	updatedAt: string;
}

export interface KnnOptions {
	fingerprint: string;
	dim: number;
	limit: number;
	wikis?: string[];
	kinds?: string[];
	includeInactive?: boolean;
}

export interface VectorDb {
	init(): Promise<void>;
	hasAny(): Promise<boolean>;
	hashes(wiki: string, fingerprint: string, paths?: string[]): Promise<Map<string, { path: string; hash: string }>>;
	upsert(rows: VectorRow[]): Promise<void>;
	deleteKeys(wiki: string, entries: Array<{ path: string; key: string }>): Promise<number>;
	purgeWiki(wiki: string): Promise<void>;
	/** Drop rows this wiki stored under any other embedder identity. */
	purgeOtherIdentities(wiki: string, fingerprint: string): Promise<number>;
	knn(embedding: Float32Array, options: KnnOptions): Promise<KnnHit[]>;
	state(wiki: string): Promise<IndexState | undefined>;
	setState(state: IndexState): Promise<void>;
	counts(): Promise<Array<{ wiki: string; fingerprint: string; chunks: number }>>;
	close(): Promise<void>;
}

const instances = new Map<string, SqliteVectorDb>();
/** Process-wide shared store handle per data directory. */
export function vectorDbFor(dataDir: string): SqliteVectorDb {
	let db = instances.get(dataDir);
	if (!db) {
		db = new SqliteVectorDb(dataDir);
		instances.set(dataDir, db);
	}
	return db;
}

/** Drop every cached store. Nothing is held open between operations, so this is only bookkeeping. */
export async function closeVectorDbs(): Promise<void> {
	const open = [...instances.values()];
	instances.clear();
	await Promise.allSettled(open.map((db) => db.close()));
}
