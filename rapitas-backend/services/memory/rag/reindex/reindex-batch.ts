/**
 * reindex-batch
 *
 * Re-embeds the whole knowledge base with the embedding model that is ACTUALLY
 * loaded (see rag/embedding.ts) after a model switch, in id-ordered chunks
 * with a pause between them so the server stays responsive. Progress is
 * tracked by the `embedding_model` column of the vector index itself, which
 * makes every run idempotent and resumable (rows already on the target model
 * are skipped). Also owns the startup auto-enqueue and the status snapshot.
 *
 * NOT responsible for scheduling (memoryTaskQueue runs the `reembed` job) or
 * for choosing the model (rag/embedding.ts).
 */
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';
import { appendEvent } from '../../timeline';
import {
  ensureEmbeddingReady,
  generateEmbedding,
  getActiveEmbeddingModel,
  getConfiguredEmbeddingModel,
  isEmbeddingSubprocess,
} from '../embedding';
import {
  countEmbeddingsByModel,
  getEmbeddingCount,
  getEmbeddingModels,
  upsertEmbedding,
} from '../vector-index';
import type { MemoryTaskQueueProcessor } from '../../task_queue';

const log = createLogger('memory:rag:reindex');

/** Above this many remaining rows the subprocess path is impractically slow. */
const SUBPROCESS_WARN_THRESHOLD = 500;

function envInt(name: string, fallback: number, min: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

/** Options for {@link runReindexBatch}; env defaults apply when omitted. */
export interface ReindexOptions {
  /** Rows fetched per chunk (RAPITAS_KB_REINDEX_BATCH_SIZE, default 50). */
  batchSize?: number;
  /** Pause between chunks in ms (RAPITAS_KB_REINDEX_PAUSE_MS, default 250). */
  pauseMs?: number;
  /** Max rows (re-embedded + failed) per run; 0 = unlimited (RAPITAS_KB_REINDEX_BUDGET). */
  maxEntries?: number;
  /** Count only — no embedding, no writes. */
  dryRun?: boolean;
}

/** Outcome of one batch run. */
export interface ReindexResult {
  targetModel: string;
  dryRun: boolean;
  scanned: number;
  reembedded: number;
  failed: number;
  /** Rows still not on the target model after this run. */
  remaining: number;
  durationMs: number;
}

/** Snapshot for `GET /memory/embeddings/status` and `/knowledge/stats.embeddingIndex`. */
export interface EmbeddingIndexStatus {
  /** Model actually loaded (null until first use). */
  activeModel: string | null;
  /** Model requested via RAPITAS_EMBEDDING_MODEL. */
  configuredModel: string;
  byModel: Record<string, number>;
  total: number;
  /** Entries whose stored embedding is not on the target model. */
  pendingReindex: number;
}

/**
 * Number of knowledge entries whose stored embedding was not produced by `model`.
 *
 * @param model - Target model id. / 対象モデル
 * @returns Pending count (never negative). / 未再埋め込み件数
 */
export async function countReindexPending(model: string): Promise<number> {
  const total = await prisma.knowledgeEntry.count();
  const done = countEmbeddingsByModel()[model] ?? 0;
  return Math.max(0, total - done);
}

/**
 * Current index status. Does not force a model load — uses the active model
 * when known, else the configured one, as the reindex target.
 *
 * @returns Status snapshot. / 索引状態
 */
export async function getEmbeddingIndexStatus(): Promise<EmbeddingIndexStatus> {
  const activeModel = getActiveEmbeddingModel();
  const configuredModel = getConfiguredEmbeddingModel();
  const byModel = countEmbeddingsByModel();
  const target = activeModel ?? configuredModel;
  return {
    activeModel,
    configuredModel,
    byModel,
    total: getEmbeddingCount(),
    pendingReindex: await countReindexPending(target),
  };
}

/**
 * Re-embed entries not yet on the active model, chunk by chunk.
 *
 * @param options - Batch tuning / dryRun. / バッチ設定
 * @returns Run summary. / 実行結果
 * @throws {Error} When embeddings are disabled. / 埋め込み無効時
 */
export async function runReindexBatch(options: ReindexOptions = {}): Promise<ReindexResult> {
  const started = Date.now();
  const batchSize = options.batchSize ?? envInt('RAPITAS_KB_REINDEX_BATCH_SIZE', 50, 1);
  const pauseMs = options.pauseMs ?? envInt('RAPITAS_KB_REINDEX_PAUSE_MS', 250, 0);
  const maxEntries = options.maxEntries ?? envInt('RAPITAS_KB_REINDEX_BUDGET', 0, 0);
  const dryRun = options.dryRun === true;

  const model = await ensureEmbeddingReady();
  if (dryRun) {
    return {
      targetModel: model,
      dryRun: true,
      scanned: 0,
      reembedded: 0,
      failed: 0,
      remaining: await countReindexPending(model),
      durationMs: Date.now() - started,
    };
  }

  let cursor = 0;
  let scanned = 0;
  let reembedded = 0;
  let failed = 0;
  let budgetHit = false;

  while (!budgetHit) {
    const rows = await prisma.knowledgeEntry.findMany({
      where: { id: { gt: cursor } },
      select: { id: true, title: true, content: true },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    const stored = getEmbeddingModels(rows.map((r) => r.id));
    for (const row of rows) {
      if (stored.get(row.id) === model) continue; // already on the target model
      if (maxEntries > 0 && reembedded + failed >= maxEntries) {
        budgetHit = true;
        break;
      }
      try {
        // Title + content: the title carries the lesson's gist and matches the
        // task-title queries best; the write path embeds the same shape.
        const { embedding, model: used } = await generateEmbedding(`${row.title}\n${row.content}`);
        upsertEmbedding(row.id, embedding, row.content.slice(0, 200), used);
        reembedded += 1;
      } catch (err) {
        failed += 1;
        log.warn({ err, entryId: row.id }, '[reindex] re-embedding failed — continuing');
      }
    }
    if (rows.length < batchSize) break;
    if (pauseMs > 0) await Bun.sleep(pauseMs);
  }

  const remaining = await countReindexPending(model);
  const result: ReindexResult = {
    targetModel: model,
    dryRun: false,
    scanned,
    reembedded,
    failed,
    remaining,
    durationMs: Date.now() - started,
  };
  if (isEmbeddingSubprocess() && remaining > SUBPROCESS_WARN_THRESHOLD) {
    log.warn(
      { remaining },
      '[reindex] subprocess embedding path in use — remaining re-index will take hours',
    );
  }
  await appendEvent({ eventType: 'embedding_reindex', payload: { ...result } }).catch(
    (err: unknown) => log.debug({ err }, '[reindex] failed to record embedding_reindex'),
  );
  log.info(result, '[reindex] batch finished');
  return result;
}

/**
 * The queued/running `reembed` job, if any.
 *
 * @returns Job id + status, or null. / 実行中ジョブ
 */
export async function getReindexJob(): Promise<{ id: number; status: string } | null> {
  const row = await prisma.memoryTaskQueue.findFirst({
    where: { taskType: 'reembed', status: { in: ['pending', 'processing'] } },
    select: { id: true, status: true },
    orderBy: { id: 'asc' },
  });
  return row ?? null;
}

/**
 * Enqueue a `reembed` job (priority 1, below embed/validate) unless one is
 * already pending/processing.
 *
 * @param queue - The memory task queue. / メモリタスクキュー
 * @param maxEntries - Optional per-run budget override. / 1ジョブの上限
 * @returns The existing or new job id. / ジョブID
 */
export async function enqueueReindex(
  queue: MemoryTaskQueueProcessor,
  maxEntries?: number,
): Promise<number> {
  const existing = await getReindexJob();
  if (existing) return existing.id;
  return queue.enqueue('reembed', maxEntries !== undefined ? { maxEntries } : {}, 1);
}

/**
 * Startup hook: enqueue a re-index when the ACTIVE model differs from what the
 * index holds. Skips when RAPITAS_KB_REINDEX_AUTO is off, the index is empty,
 * embeddings are unavailable, or nothing is pending.
 *
 * @param queue - The memory task queue. / メモリタスクキュー
 * @returns Job id when (already) enqueued, else null. / ジョブID
 */
export async function maybeEnqueueReindex(queue: MemoryTaskQueueProcessor): Promise<number | null> {
  const auto = (process.env.RAPITAS_KB_REINDEX_AUTO ?? '1').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(auto)) return null;
  if (getEmbeddingCount() === 0) return null;
  let model: string;
  try {
    model = await ensureEmbeddingReady();
  } catch (err) {
    log.debug({ err }, '[reindex] embeddings unavailable — auto re-index skipped');
    return null;
  }
  const pending = await countReindexPending(model);
  if (pending === 0) return null;
  const id = await enqueueReindex(queue);
  log.info({ model, pending, jobId: id }, '[reindex] re-index job queued');
  return id;
}
