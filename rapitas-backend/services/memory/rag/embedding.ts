/**
 * ローカルEmbedding生成
 * @xenova/transformers の all-MiniLM-L6-v2 モデルで384次元のembeddingを生成
 * Bun互換性問題がある場合はNode.jsサブプロセスにフォールバック
 */
import { createLogger } from '../../../config/logger';
import type { EmbeddingResult } from '../types';
import { existsSync } from 'fs';
import { join } from 'path';

const log = createLogger('memory:rag:embedding');

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const DIMENSION = 384;

// @xenova/transformersのパイプライン型定義
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
 * 埋め込みパイプラインをリセット（再初期化のため）
 */
export function resetEmbeddingPipeline(): void {
  pipeline = null;
  useSubprocess = false;
  embeddingDisabled = false;
  initAttempted = false;
  log.info('Embedding pipeline reset - ready for re-initialization');
}

/**
 * embeddingパイプラインを初期化
 */
async function initPipeline(): Promise<void> {
  if (pipeline || initAttempted) return;
  initAttempted = true;

  try {
    // @xenova/transformersを動的インポート
    // @ts-expect-error @xenova/transformers has no type declarations
    const { pipeline: createPipeline } = await import('@xenova/transformers');
    pipeline = await createPipeline('feature-extraction', MODEL_NAME);
    log.info('Embedding pipeline initialized (direct)');
  } catch (_directError) {
    // 直接importが失敗した場合、サブプロセスでもモジュールが必要なためチェック
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
 * Node.jsサブプロセスでembeddingを生成（フォールバック）
 */
async function generateEmbeddingSubprocess(text: string): Promise<number[]> {
  const workerPath = join(__dirname, '../../../workers/embedding-worker.cjs');

  if (!existsSync(workerPath)) {
    throw new Error(`Embedding worker not found: ${workerPath}`);
  }

  const proc = Bun.spawn(['node', workerPath], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(JSON.stringify({ text, model: MODEL_NAME }));
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
 * テキストからembeddingを生成
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
 * 複数テキストのembeddingをバッチ生成
 */
export async function generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}
