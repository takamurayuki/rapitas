/**
 * Local Embedding Generation
 *
 * Generates 384-dimensional embeddings using @xenova/transformers all-MiniLM-L6-v2.
 * Falls back to a Node.js subprocess if Bun compatibility issues arise.
 */
import { createLogger } from '../../../config/logger';
import type { EmbeddingResult } from '../types';
import { existsSync } from 'fs';
import { join } from 'path';

const log = createLogger('memory:rag:embedding');

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384;

// Pipeline type definition for @xenova/transformers
interface EmbeddingPipeline {
  (
    text: string,
    options?: { pooling?: string; normalize?: boolean },
  ): Promise<{
    data: Float32Array;
  }>;
}

let pipeline: EmbeddingPipeline | null = null;
let useSubprocess = false;
let embeddingDisabled = false;
let initAttempted = false;

// NOTE: 3 separates a transient hiccup from persistent breakage (e.g. a broken
// sharp native binding crashing the worker on require) without adding a config
// surface; resetEmbeddingPipeline() re-arms the breaker without a restart.
const MAX_SUBPROCESS_FAILURES = 3;
let subprocessFailureCount = 0;

/**
 * Reset the embedding pipeline for re-initialization.
 */
export function resetEmbeddingPipeline(): void {
  pipeline = null;
  useSubprocess = false;
  embeddingDisabled = false;
  initAttempted = false;
  subprocessFailureCount = 0;
  log.info('Embedding pipeline reset - ready for re-initialization');
}

/**
 * Initialize the embedding pipeline.
 */
async function initPipeline(): Promise<void> {
  if (pipeline || initAttempted) return;
  initAttempted = true;

  try {
    // Dynamic import of @xenova/transformers
    // NOTE: @xenova/transformers has no type declarations; dynamic import resolves to any
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    // HACK(agent): Cast needed because @xenova/transformers has incompatible pooling type definitions
    pipeline = (await createPipeline(
      'feature-extraction',
      MODEL_NAME,
    )) as unknown as EmbeddingPipeline;
    log.info('Embedding pipeline initialized (direct)');
  } catch {
    // If direct import fails, check if the module exists for subprocess fallback
    try {
      require.resolve('@xenova/transformers');
      log.warn('Direct embedding init failed, using subprocess fallback');
      useSubprocess = true;
    } catch {
      log.warn(
        '@xenova/transformers is not installed. Embedding/RAG features are disabled. Install with: bun add @xenova/transformers',
      );
      embeddingDisabled = true;
    }
  }
}

/**
 * Structural stdin sink so tests can pass fakes without depending on Bun's FileSink type.
 */
export interface WorkerStdinSink {
  write(chunk: string): unknown;
  end(): unknown;
}

/**
 * Write a request payload to the worker's stdin and close it, tolerating a dead pipe.
 *
 * @param sink - the worker's stdin sink / ワーカーの標準入力シンク
 * @param payload - serialized request to write / 書き込むシリアライズ済みリクエスト
 * @returns resolves even if the pipe is already closed / パイプが閉じていても resolve する
 */
export async function writeWorkerRequest(sink: WorkerStdinSink, payload: string): Promise<void> {
  // NOTE: Bun's FileSink can fail with a synchronous throw OR a rejected promise
  // (EOF errno -136 when the worker died before consuming stdin). Awaiting via
  // Promise.resolve funnels both into this one catch, so no unhandled rejection escapes.
  try {
    await Promise.resolve(sink.write(payload));
    await Promise.resolve(sink.end());
  } catch (err) {
    // NOTE: debug only — the caller's `exit !== 0` check reports the failure as
    // "Embedding worker failed"; warn+ here would log one event twice and make
    // log-health-check file a duplicate concern.
    log.debug({ err }, 'Embedding worker stdin write failed (worker likely exited)');
  }
}

/**
 * Generate embedding via Node.js subprocess (fallback for Bun compatibility).
 */
async function generateEmbeddingSubprocess(text: string): Promise<number[]> {
  if (subprocessFailureCount >= MAX_SUBPROCESS_FAILURES) {
    // Circuit breaker: a persistently crashing worker (e.g. broken sharp native
    // binding) would otherwise be respawned on every call. Recover via
    // resetEmbeddingPipeline() (exposed as POST /knowledge/embedding/reset).
    throw new Error(
      `Embedding worker unavailable after ${MAX_SUBPROCESS_FAILURES} consecutive failures`,
    );
  }

  const workerPath = join(__dirname, '../../../workers/embedding-worker.cjs');

  if (!existsSync(workerPath)) {
    throw new Error(`Embedding worker not found: ${workerPath}`);
  }

  const proc = Bun.spawn(['node', workerPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await writeWorkerRequest(proc.stdin, JSON.stringify({ text, model: MODEL_NAME }));

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    subprocessFailureCount++;
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Embedding worker failed (exit ${exitCode}): ${stderr}`);
  }

  subprocessFailureCount = 0;
  const result = JSON.parse(output);
  return result.embedding;
}

/**
 * Generate an embedding from text.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  await initPipeline();

  if (embeddingDisabled) {
    throw new Error('Embedding is disabled: @xenova/transformers is not installed');
  }

  let embedding: number[];

  if (useSubprocess) {
    embedding = await generateEmbeddingSubprocess(text);
  } else {
    const output = await pipeline!(text, { pooling: 'mean', normalize: true });
    embedding = Array.from(output.data as Float32Array);
  }

  return {
    embedding,
    model: MODEL_NAME,
    dimension: DIMENSION,
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
