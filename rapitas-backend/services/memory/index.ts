/**
 * メモリ/知識管理システム - エクスポート
 */

// Types
export type * from "./types";

// Core services
export { appendEvent, queryEvents } from "./timeline";
export { MemoryJournal } from "./streaming_journal";
export { MemoryTaskQueueProcessor } from "./task_queue";

// Knowledge lifecycle
export { runConsolidation, getConsolidationRuns } from "./consolidation";
export { runForgettingSweep, boostDecayOnAccess } from "./forgetting";
export { distillFromExecution } from "./distillation";
export { triggerReconsolidation } from "./reconsolidation";
export { validateEntry } from "./validation";
export {
  detectContradictions,
  resolveContradiction,
  getUnresolvedContradictions,
} from "./contradiction";

// RAG
export { generateEmbedding, generateEmbeddings } from "./rag/embedding";
export { upsertEmbedding, deleteEmbedding, searchSimilar, getEmbeddingCount, closeVectorDb } from "./rag/vector-index";
export { vectorSearch, searchKnowledge } from "./rag/search";
export { buildRAGContext, buildTaskRAGContext } from "./rag/context-builder";

// Utils
export { createContentHash, cosineSimilarity } from "./utils";

// --- Memory System Singleton ---
import { prisma } from "../../config/database";
import { createLogger } from "../../config/logger";
import { MemoryJournal } from "./streaming_journal";
import { MemoryTaskQueueProcessor } from "./task_queue";
import { generateEmbedding } from "./rag/embedding";
import { upsertEmbedding, deleteEmbedding } from "./rag/vector-index";
import { validateEntry } from "./validation";
import { detectContradictions } from "./contradiction";
import { runConsolidation } from "./consolidation";
import { runForgettingSweep } from "./forgetting";
import { distillFromExecution } from "./distillation";
import { createContentHash } from "./utils";
import { appendEvent } from "./timeline";
import type { CreateKnowledgeEntryInput, UpdateKnowledgeEntryInput, KnowledgeListOptions } from "./types";

const log = createLogger("memory:system");

// キューワーカーのシングルトン
export const memoryTaskQueue = new MemoryTaskQueueProcessor();

/**
 * メモリシステムを初期化
 * サーバー起動時に呼び出す
 */
export async function initializeMemorySystem(): Promise<void> {
  // 1. ジャーナルリカバリ
  const recovered = await MemoryJournal.recover();
  if (recovered > 0) {
    log.info({ recovered }, "Journal entries recovered");
  }

  // 2. タスクハンドラーを登録
  memoryTaskQueue.registerHandler("embed", async (payload) => {
    const { entryId, content } = payload as { entryId: number; content: string };
    const { embedding } = await generateEmbedding(content);
    upsertEmbedding(entryId, embedding, content.slice(0, 200));
  });

  memoryTaskQueue.registerHandler("validate", async (payload) => {
    const { entryId } = payload as { entryId: number };
    await validateEntry(entryId);
  });

  memoryTaskQueue.registerHandler("detect_contradiction", async (payload) => {
    const { entryId } = payload as { entryId: number };
    await detectContradictions(entryId);
  });

  memoryTaskQueue.registerHandler("consolidate", async () => {
    await runConsolidation();
  });

  memoryTaskQueue.registerHandler("forget_sweep", async () => {
    await runForgettingSweep();
  });

  memoryTaskQueue.registerHandler("distill", async (payload) => {
    const { executionId } = payload as { executionId: number };
    await distillFromExecution(executionId);
  });

  // 3. キューワーカーを開始
  memoryTaskQueue.start();

  // 4. ジャーナルチェックポイント
  await MemoryJournal.checkpoint();

  log.info("Memory system initialized");
}

/**
 * メモリシステムを停止
 */
export function shutdownMemorySystem(): void {
  memoryTaskQueue.stop();
  log.info("Memory system shut down");
}

// --- Knowledge Entry CRUD ---

/**
 * 知識エントリを作成（→ validation + embedding キューイング）
 */
export async function createKnowledgeEntry(input: CreateKnowledgeEntryInput) {
  const contentHash = createContentHash(input.content);

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      title: input.title,
      content: input.content,
      contentHash,
      category: input.category ?? "general",
      tags: JSON.stringify(input.tags ?? []),
      confidence: input.confidence ?? 1.0,
      themeId: input.themeId,
      taskId: input.taskId,
    },
  });

  await appendEvent({
    eventType: "knowledge_created",
    payload: { entryId: entry.id, sourceType: input.sourceType, category: entry.category },
  });

  // バックグラウンドでembedding + validation + 矛盾検出をキューイング
  await memoryTaskQueue.enqueue("embed", { entryId: entry.id, content: input.content }, 10);
  await memoryTaskQueue.enqueue("validate", { entryId: entry.id }, 5);
  await memoryTaskQueue.enqueue("detect_contradiction", { entryId: entry.id }, 3);

  return entry;
}

/**
 * 知識エントリを更新（→ 再検証 + 再embedding）
 */
export async function updateKnowledgeEntry(id: number, input: UpdateKnowledgeEntryInput) {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.content !== undefined) {
    data.content = input.content;
    data.contentHash = createContentHash(input.content);
  }
  if (input.category !== undefined) data.category = input.category;
  if (input.tags !== undefined) data.tags = JSON.stringify(input.tags);
  if (input.confidence !== undefined) data.confidence = input.confidence;
  if (input.themeId !== undefined) data.themeId = input.themeId;
  if (input.taskId !== undefined) data.taskId = input.taskId;

  const entry = await prisma.knowledgeEntry.update({
    where: { id },
    data,
  });

  await appendEvent({
    eventType: "knowledge_updated",
    payload: { entryId: id },
  });

  // コンテンツが変更された場合は再embedding + 再検証
  if (input.content !== undefined) {
    await memoryTaskQueue.enqueue("embed", { entryId: id, content: input.content }, 10);
    await memoryTaskQueue.enqueue("validate", { entryId: id }, 5);
    await memoryTaskQueue.enqueue("detect_contradiction", { entryId: id }, 3);
  }

  return entry;
}

/**
 * 知識エントリをアーカイブ（論理削除）
 */
export async function archiveKnowledgeEntry(id: number) {
  const entry = await prisma.knowledgeEntry.update({
    where: { id },
    data: { forgettingStage: "archived" },
  });

  deleteEmbedding(id);

  await appendEvent({
    eventType: "knowledge_archived",
    payload: { entryId: id },
  });

  return entry;
}

/**
 * 知識エントリをピン留め
 */
export async function pinKnowledgeEntry(id: number, until: Date) {
  return prisma.knowledgeEntry.update({
    where: { id },
    data: { pinnedUntil: until },
  });
}

/**
 * 知識エントリ一覧を取得
 */
export async function listKnowledgeEntries(options: KnowledgeListOptions = {}) {
  const {
    page = 1,
    limit = 20,
    sourceType,
    category,
    forgettingStage,
    validationStatus,
    themeId,
    search,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = options;

  const where: Record<string, unknown> = {};
  if (sourceType) where.sourceType = sourceType;
  if (category) where.category = category;
  if (forgettingStage) where.forgettingStage = forgettingStage;
  if (validationStatus) where.validationStatus = validationStatus;
  if (themeId) where.themeId = themeId;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { content: { contains: search, mode: "insensitive" } },
    ];
  }

  const [entries, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.knowledgeEntry.count({ where }),
  ]);

  return {
    entries: entries.map((e) => ({ ...e, tags: JSON.parse(e.tags) })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * 知識エントリ統計を取得
 */
export async function getKnowledgeStats() {
  const [
    totalEntries,
    byCategory,
    byStage,
    byValidation,
    bySource,
    avgConfidence,
    avgDecay,
    recentlyAccessed,
  ] = await Promise.all([
    prisma.knowledgeEntry.count(),
    prisma.knowledgeEntry.groupBy({ by: ["category"], _count: { id: true } }),
    prisma.knowledgeEntry.groupBy({ by: ["forgettingStage"], _count: { id: true } }),
    prisma.knowledgeEntry.groupBy({ by: ["validationStatus"], _count: { id: true } }),
    prisma.knowledgeEntry.groupBy({ by: ["sourceType"], _count: { id: true } }),
    prisma.knowledgeEntry.aggregate({ _avg: { confidence: true } }),
    prisma.knowledgeEntry.aggregate({ _avg: { decayScore: true } }),
    prisma.knowledgeEntry.count({
      where: { lastAccessedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const toRecord = (items: Array<{ _count: { id: number }; [key: string]: unknown }>, key: string) =>
    Object.fromEntries(items.map((i) => [i[key], i._count.id]));

  return {
    totalEntries,
    byCategory: toRecord(byCategory, "category"),
    byStage: toRecord(byStage, "forgettingStage"),
    byValidation: toRecord(byValidation, "validationStatus"),
    bySource: toRecord(bySource, "sourceType"),
    averageConfidence: avgConfidence._avg.confidence ?? 0,
    averageDecayScore: avgDecay._avg.decayScore ?? 0,
    recentlyAccessed,
  };
}
