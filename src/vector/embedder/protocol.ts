/**
 * Wire protocol shared by the embedder process and its clients. Newline-delimited JSON: one request
 * per line, one reply per line, both carrying the request `id`.
 *
 * Parity rule: every reply identifies the embedder that produced it (`fingerprint`). A client whose
 * configured identity does not match must refuse to use the daemon's vectors and replace it.
 */
export const PROTOCOL_VERSION = 1;

export interface HelloReply {
	protocol: number;
	fingerprint: string;
	model: string;
	dims: number;
	pid: number;
	startedAt: string;
	queue: { interactive: number; batch: number };
}

export interface EmbedRequest {
	id?: number;
	op: "embed";
	kind: "query" | "document";
	priority: "interactive" | "batch";
	inputs: Array<{ title?: string; text: string }>;
}

export interface EmbedReply {
	dims: number;
	/** One base64 Float32Array per input, in order. */
	vectors: string[];
}

export function encodeVectors(vectors: Float32Array[]): string[] {
	return vectors.map((vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64"));
}

export function decodeVector(encoded: string): Float32Array {
	const buffer = Buffer.from(encoded, "base64");
	return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
