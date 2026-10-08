/**
 * Child process for the store concurrency test: writes and reads the shared SQLite index store
 * while the parent does the same, proving the store needs no single owner. Prints one JSON line.
 * Plain JS (no TS loader) so the test can spawn it with `node` directly.
 */
import { DatabaseSync } from "node:sqlite";

const [file, wiki, dim] = process.argv.slice(2);
const database = new DatabaseSync(file);
database.exec("PRAGMA busy_timeout = 5000");
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA synchronous = NORMAL");

const insert = database.prepare(
	`INSERT INTO chunks (wiki, path, key, kind, claim_id, status, title, text, hash, model, fingerprint, dim, embedding, updated_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	 ON CONFLICT (wiki, path, key) DO UPDATE SET hash = excluded.hash, embedding = excluded.embedding`,
);
const count = database.prepare("SELECT count(*) AS n FROM chunks");

const vector = Buffer.alloc(Number(dim) * 4);
let writes = 0;
let reads = 0;
const errors = [];

for (let i = 0; i < 250; i += 1) {
	try {
		insert.run(wiki, `notes/child-${i % 7}.md`, `k${i}`, "section", null, "verified", "t", "b", `h${i}`, "performance", "child@v1:q8:4", Number(dim), vector, new Date().toISOString());
		writes += 1;
		count.get();
		reads += 1;
	} catch (error) {
		errors.push(`${error.code ?? "ERR"}:${String(error.message).slice(0, 60)}`);
	}
}

database.close();
console.log(JSON.stringify({ writes, reads, errors }));
