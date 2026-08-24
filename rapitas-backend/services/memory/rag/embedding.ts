/**
 * Local Embedding Generation
 *
 * Generates sentence embeddings locally via @xenova/transformers. The model is
 * chosen by `RAPITAS_EMBEDDING_MODEL` (default: the English-only
 * all-MiniLM-L6-v2 that the existing index was built with); when the configured
 * model cannot be loaded (e.g. first download offline) it falls back to that
 * legacy model so embeddings never go fully dark. `getActiveEmbeddingModel()`
 * reports the model ACTUALLY loaded — every index/search decision must use it,
 * never the configured name. Falls back to a Node.js subprocess if Bun
 * compatibility issues arise.
 */
import { createLogger } from '../../../config/logger';
import type { EmbeddingResult } from '../types';
import { existsSync } from 'fs';
import { join } from 'path';

const log = createLogger('memory:rag:embedding');

/** Model the pre-existing vector index was built with (English-only). */
export const LEGACY_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

// Pipeline type definition for @xenova/transformers
interface EmbeddingPipeline {
  (
    text: string,
    options?: { pooling?: string; normalize?: boolean },
  ): Promise<{
    data: Float32Array;
  }>;
}

type PipelineFactory = (task: string, model: string) => Promise<unknown>;

let pipeline: EmbeddingPipeline | null = null;
let useSubprocess = false;
let embeddingDisabled = false;
let initAttempted = false;
let activeModel: string | null = null;

/**
 * Model name requested via env (trimmed), or the legacy default.
 *
 * @returns Configured model id. / 設定されたモデル名
 */
export function getConfiguredEmbeddingModel(): string {
  const v = process.env.RAPITAS_EMBEDDING_MODEL?.trim();
  return v ? v : LEGACY_EMBEDDING_MODEL;
}

/**
 * Model the pipeline actually loaded (null until the first initialization).
 * Differs from the configured one after a fallback.
 *
 * @returns Active model id or null. / 実際にロード済みのモデル名
 */
export function getActiveEmbeddingModel(): string | null {
  return activeModel;
}

/**
 * Reset the embedding pipeline for re-initialization.
 */
export function resetEmbeddingPipeline(): void {
  pipeline = null;
  useSubprocess = false;
  embeddingDisabled = false;
  initAttempted = false;
  activeModel = null;
  log.info('Embedding pipeline reset - ready for re-initialization');
}

/** Try to load a model in-process; null on any failure. */
async function loadDirect(
  createPipeline: PipelineFactory,
  model: string,
): Promise<EmbeddingPipeline | null> {
  try {
    // HACK(agent): Cast needed because @xenova/transformers has incompatible pooling type definitions
    return (await createPipeline('feature-extraction', model)) as unknown as EmbeddingPipeline;
  } catch (err) {
    log.debug({ err, model }, 'Direct embedding model load failed');
    return null;
  }
}

/**
 * Initialize the embedding pipeline.
 */
async function initPipeline(): Promise<void> {
  if (pipeline || initAttempted) return;
  initAttempted = true;
  const configured = getConfiguredEmbeddingModel();

  let createPipeline: PipelineFactory | null = null;
  try {
    // Dynamic import of @xenova/transformers
    // NOTE: @xenova/transformers has no type declarations; dynamic import resolves to any
    const mod = await import('@xenova/transformers');
    createPipeline = mod.pipeline as PipelineFactory;
  } catch {
    createPipeline = null;
  }

  if (createPipeline) {
    pipeline = await loadDirect(createPipeline, configured);
    if (pipeline) {
      activeModel = configured;
      log.info({ model: configured }, 'Embedding pipeline initialized (direct)');
      return;
    }
    if (configured !== LEGACY_EMBEDDING_MODEL) {
      // NOTE: the configured model may need a first-time network download;
      // offline / installed builds must still embed, so fall back to the model
      // that is already cached rather than disabling RAG entirely.
      log.warn(
        { configured, fallback: LEGACY_EMBEDDING_MODEL },
        'Configured embedding model failed to load — falling back to legacy model',
      );
      pipeline = await loadDirect(createPipeline, LEGACY_EMBEDDING_MODEL);
      if (pipeline) {
        activeModel = LEGACY_EMBEDDING_MODEL;
        log.info({ model: activeModel }, 'Embedding pipeline initialized (direct, fallback)');
        return;
      }
    }
  }

  // If direct init fails, check if the module exists for subprocess fallback
  try {
    require.resolve('@xenova/transformers');
    log.warn('Direct embedding init failed, using subprocess fallback');
    useSubprocess = true;
    activeModel = configured;
  } catch {
    log.warn(
      '@xenova/transformers is not installed. Embedding/RAG features are disabled. Install with: bun add @xenova/transformers',
    );
    embeddingDisabled = true;
  }
}

/**
 * Generate embedding via Node.js subprocess (fallback for Bun compatibility).
 */
async function generateEmbeddingSubprocess(text: string, model: string): Promise<number[]> {
  const workerPath = join(__dirname, '../../../workers/embedding-worker.cjs');

  if (!existsSync(workerPath)) {
    throw new Error(`Embedding worker not found: ${workerPath}`);
  }

  const proc = Bun.spawn(['node', workerPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(JSON.stringify({ text, model }));
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Embedding worker failed (exit ${exitCode}): ${stderr}`);
  }

  const result = JSON.parse(output);
  return result.embedding;
}

/**
 * Whether the subprocess fallback is in use (slow: one node start per call).
 *
 * @returns True when embeddings run out-of-process. / サブプロセス経路か
 */
export function isEmbeddingSubprocess(): boolean {
  return useSubprocess;
}

/**
 * Initialize (if needed) and return the model that will be used.
 *
 * @returns The active model id. / 実測モデル名
 * @throws {Error} When embeddings are disabled. / 埋め込み無効時
 */
export async function ensureEmbeddingReady(): Promise<string> {
  await initPipeline();
  if (embeddingDisabled || !activeModel) {
    throw new Error('Embedding is disabled: @xenova/transformers is not installed');
  }
  return activeModel;
}

/**
 * Generate an embedding from text.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const model = await ensureEmbeddingReady();

  let embedding: number[];

  if (useSubprocess) {
    embedding = await generateEmbeddingSubprocess(text, model);
  } else {
    const output = await pipeline!(text, { pooling: 'mean', normalize: true });
    embedding = Array.from(output.data as Float32Array);
  }

  return {
    embedding,
    model,
    // Dimension follows the model actually loaded, not a hard-coded 384.
    dimension: embedding.length,
  };
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}
