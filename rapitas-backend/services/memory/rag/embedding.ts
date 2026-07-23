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

/**
 * Circuit-breaker threshold for the subprocess fallback.
 *
 * NOTE: When the worker's native deps are broken (e.g. sharp binary missing) every
 * embedding call spawns a process that is doomed to crash at require time — 130
 * doomed spawns were observed over 5 days. 3 consecutive failures is the minimum
 * that separates a transient failure from a persistently broken install. Recovery
 * without a server restart: resetEmbeddingPipeline() (reachable via the existing
 * re-init route in routes/memory/knowledge.ts).
 */
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
 * Minimal structural view of a worker's stdin sink.
 * Kept structural (not Bun's FileSink) so tests can pass fakes.
 */
interface WorkerStdinSink {
  write(chunk: string): unknown;
  end(): unknown;
}

/**
 * Write a request payload to the worker's stdin, tolerating a dead pipe.
 *
 * NOTE: If the worker exits before consuming stdin (e.g. crash at require time),
 * write/end fail with EOF (errno -136). Left uncaught, that surfaced as a
 * process-level unhandledRejection logged as FATAL (task #507). Failures are
 * swallowed at debug level only: the caller's `exit !== 0` check already reports
 * the worker failure, so logging at warn+ here would duplicate one incident into
 * two log-health concerns.
 *
 * @param sink - Worker stdin (Bun FileSink or structural fake) / ワーカー標準入力
 * @param payload - Serialized request to send / 送信するシリアライズ済みリクエスト
 */
export async function writeWorkerRequest(sink: WorkerStdinSink, payload: string): Promise<void> {
  try {
    // Promise.resolve + await funnels both sync throws and returned rejections
    // (Bun's FileSink can produce either) into this single catch.
    await Promise.resolve(sink.write(payload));
    await Promise.resolve(sink.end());
  } catch (err) {
    log.debug({ err }, 'Embedding worker stdin write failed (worker likely exited early)');
  }
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
 * Generate embedding via Node.js subprocess (fallback for Bun compatibility).
 */
async function generateEmbeddingSubprocess(text: string): Promise<number[]> {
  const workerPath = join(__dirname, '../../../workers/embedding-worker.cjs');

  if (!existsSync(workerPath)) {
    throw new Error(`Embedding worker not found: ${workerPath}`);
  }

  if (subprocessFailureCount >= MAX_SUBPROCESS_FAILURES) {
    throw new Error(
      `Embedding worker unavailable after ${MAX_SUBPROCESS_FAILURES} consecutive failures ` +
        '(call resetEmbeddingPipeline() to retry)',
    );
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
