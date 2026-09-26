/**
 * Embedding providers. Presets pin model-specific details (repo, dtype, dims,
 * pooling, prompt templates) so the rest of the pipeline stays model-agnostic.
 * The local provider lazily imports @huggingface/transformers (optional dep).
 */
import { join } from "node:path";

export interface EmbedInput {
	title?: string;
	text: string;
}

export interface EmbeddingProvider {
	id: string;
	dimensions: number;
	embed(inputs: EmbedInput[], kind: "query" | "document"): Promise<Float32Array[]>;
}

export type Pooling = "sentence_embedding" | "mean" | "last_token";

export interface ModelPreset {
	id: string;
	repo: string;
	dtype: string;
	dimensions: number;
	pooling: Pooling;
	expectedBytes: number;
	queryPrefix: (text: string) => string;
	documentText: (input: EmbedInput) => string;
}

const QWEN_TASK = "Given a wiki query, retrieve relevant claims and notes that answer it.";

export const MODEL_PRESETS: Record<string, ModelPreset> = {
	performance: {
		id: "embeddinggemma-300m",
		repo: "onnx-community/embeddinggemma-300m-ONNX",
		dtype: "q8",
		dimensions: 768,
		pooling: "sentence_embedding",
		expectedBytes: 309_000_000,
		queryPrefix: (text) => `task: search result | query: ${text}`,
		documentText: (input) => `title: ${input.title || "none"} | text: ${input.text}`,
	},
	quality: {
		id: "qwen3-embedding-0.6b",
		repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
		dtype: "q8",
		dimensions: 1024,
		pooling: "last_token",
		expectedBytes: 614_000_000,
		queryPrefix: (text) => `Instruct: ${QWEN_TASK}\nQuery:${text}`,
		documentText: (input) => (input.title ? `${input.title} — ${input.text}` : input.text),
	},
};

export function resolvePreset(model: string): ModelPreset {
	const preset = MODEL_PRESETS[model];
	if (!preset) {
		throw new Error(
			`Unknown search.vector.model "${model}". Available presets: ${Object.keys(MODEL_PRESETS).join(", ")}.`,
		);
	}
	return preset;
}

/** The exact text handed to the model for an input — pure, so tests can pin templates. */
export function previewEmbedText(preset: ModelPreset, input: EmbedInput, kind: "query" | "document"): string {
	return kind === "query" ? preset.queryPrefix(input.text) : preset.documentText(input);
}

export function modelsDir(agentDir: string): string {
	return join(agentDir, "jev-wiki", "models");
}

/** Minimal shapes for the optional @huggingface/transformers dependency. */
interface TokenizerLike {
	(texts: string[], options: { padding: boolean; truncation: boolean }): Promise<unknown>;
}

interface ModelLike {
	(inputs: unknown): Promise<{ sentence_embedding?: { tolist(): number[][] } }>;
}

interface TransformersModule {
	env: { cacheDir?: string };
	AutoTokenizer: {
		from_pretrained(repo: string, options?: { progress_callback?: ProgressCallback }): Promise<TokenizerLike>;
	};
	AutoModel: {
		from_pretrained(repo: string, options?: { dtype?: string; progress_callback?: ProgressCallback }): Promise<ModelLike>;
	};
	pipeline(
		task: string,
		repo: string,
		options?: { dtype?: string; progress_callback?: ProgressCallback },
	): Promise<unknown>;
}

interface ProgressInfo {
	status?: string;
	file?: string;
	progress?: number;
}

type ProgressCallback = (info: ProgressInfo) => void;

async function loadTransformers(): Promise<TransformersModule> {
	const specifier = "@huggingface/transformers";
	try {
		return (await import(specifier)) as unknown as TransformersModule;
	} catch (error) {
		throw new Error(
			"Semantic search needs the optional dependency @huggingface/transformers. Install it or set search.vector.enabled false.",
			{ cause: error },
		);
	}
}

export interface LocalProviderOptions {
	preset: ModelPreset;
	/** MRL truncation; defaults to the preset's full dimensionality. */
	dimensions?: number;
	/** Overrides the preset dtype (e.g. "q4" for EmbeddingGemma, "fp16" for Qwen3). */
	dtype?: string;
	cacheDir?: string;
	batchSize?: number;
	/** Optional progress sink for the first-run model download. */
	onProgress?: (message: string) => void;
}

interface Extractor {
	(inputs: string[], options: { pooling: Pooling; normalize: boolean }): Promise<{ tolist(): number[][] }>;
}

export async function createLocalProvider(options: LocalProviderOptions): Promise<EmbeddingProvider> {
	const { preset } = options;
	const dimensions = options.dimensions ?? preset.dimensions;
	if (dimensions <= 0 || dimensions > preset.dimensions) {
		throw new Error(`search.vector.dimensions must be between 1 and ${preset.dimensions} for ${preset.id}.`);
	}
	const dtype = options.dtype ?? preset.dtype;
	const batchSize = options.batchSize ?? 16;

	const transformers = await loadTransformers();
	if (options.cacheDir) transformers.env.cacheDir = options.cacheDir;

	const progress_callback: ProgressCallback | undefined = options.onProgress
		? (info) => {
				if (info?.status === "progress" && typeof info.progress === "number") {
					options.onProgress?.(`${info.file ?? "model"} ${Math.round(info.progress)}%`);
				} else if (info?.status === "done" && info.file) {
					options.onProgress?.(`${info.file} ready`);
				}
			}
		: undefined;

	const encode = await createEncoder(transformers, preset, dtype, progress_callback);

	return {
		id: `${preset.id}:${dtype}`,
		dimensions,
		async embed(inputs: EmbedInput[], kind: "query" | "document"): Promise<Float32Array[]> {
			const out: Float32Array[] = [];
			for (let start = 0; start < inputs.length; start += batchSize) {
				const batch = inputs.slice(start, start + batchSize);
				const texts = batch.map((input) => previewEmbedText(preset, input, kind));
				const vectors = await encode(texts);
				for (const vector of vectors) out.push(truncateAndNormalize(vector, dimensions));
			}
			return out;
		},
	};
}

async function createEncoder(
	transformers: TransformersModule,
	preset: ModelPreset,
	dtype: string,
	progress_callback?: ProgressCallback,
): Promise<(texts: string[]) => Promise<number[][]>> {
	if (preset.pooling === "sentence_embedding") {
		const tokenizer = await transformers.AutoTokenizer.from_pretrained(preset.repo, { progress_callback });
		const model = await transformers.AutoModel.from_pretrained(preset.repo, { dtype, progress_callback });
		return async (texts) => {
			const inputs = await tokenizer(texts, { padding: true, truncation: true });
			const output = await model(inputs);
			if (!output.sentence_embedding) throw new Error(`${preset.repo} did not return sentence_embedding.`);
			return output.sentence_embedding.tolist();
		};
	}
	const extractor = (await transformers.pipeline("feature-extraction", preset.repo, { dtype, progress_callback })) as unknown as Extractor;
	return async (texts) => {
		const output = await extractor(texts, { pooling: preset.pooling, normalize: false });
		return output.tolist();
	};
}

export function truncateAndNormalize(vector: ArrayLike<number>, dimensions: number): Float32Array {
	const out = new Float32Array(dimensions);
	let norm = 0;
	for (let i = 0; i < dimensions; i++) {
		const value = Number(vector[i] ?? 0);
		out[i] = value;
		norm += value * value;
	}
	norm = Math.sqrt(norm);
	if (norm > 0) for (let i = 0; i < dimensions; i++) out[i] /= norm;
	return out;
}
