/**
 * index.update-version.test
 *
 * Verifies updateKnowledgeEntry bumps entryVersion (via a Prisma { increment: 1 })
 * only when the content actually changes, and leaves it untouched for
 * metadata-only updates. Own file — mock.module is process-global, and the
 * memory barrel pulls a large dependency graph that is fully stubbed here.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const updateCalls: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
const keUpdate = mock((args: { where: { id: number }; data: Record<string, unknown> }) => {
  updateCalls.push(args);
  return Promise.resolve({ id: args.where.id, ...args.data });
});

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { knowledgeEntry: { update: keUpdate } },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
// Stub the barrel's heavy dependency graph. Every named export the barrel
// re-exports must be present here (a partial mock breaks the re-export line);
// none is exercised by the version bump under test.
mock.module('./streaming_journal', () => ({ MemoryJournal: { recover: async () => 0 } }));
mock.module('./task_queue', () => ({
  MemoryTaskQueueProcessor: class {
    enqueue = async () => {};
    reapStuckProcessing = async () => ({ reapedToPending: 0, reapedToDeadLetter: 0 });
    registerHandler = () => {};
  },
}));
mock.module('./rag/embedding', () => ({
  generateEmbedding: async () => ({ embedding: [], model: '' }),
  generateEmbeddings: async () => [],
}));
mock.module('./rag/vector-index', () => ({
  upsertEmbedding: () => {},
  deleteEmbedding: () => {},
  searchSimilar: () => [],
  getEmbeddingCount: () => 0,
  closeVectorDb: () => {},
}));
mock.module('./rag/search', () => ({ vectorSearch: async () => [], searchKnowledge: async () => [] }));
mock.module('./rag/context-builder', () => ({
  buildRAGContext: async () => ({}),
  buildTaskRAGContext: async () => ({}),
}));
mock.module('./recall/hybrid-search', () => ({ searchKnowledgeHybrid: async () => [] }));
mock.module('./knowledge-stats', () => ({ getKnowledgeStats: async () => ({}) }));
mock.module('./validation', () => ({ validateEntry: async () => {}, revalidatePendingBacklog: async () => {} }));
mock.module('./contradiction', () => ({
  detectContradictions: async () => 0,
  resolveContradiction: async () => {},
  getUnresolvedContradictions: async () => [],
}));
mock.module('./contradiction-sweep', () => ({
  drainStaleConflicts: async () => {},
  revalidateStaleConflicts: async () => {},
}));
mock.module('./consolidation', () => ({ runConsolidation: async () => {}, getConsolidationRuns: async () => [] }));
mock.module('./reconsolidation', () => ({ triggerReconsolidation: async () => {} }));
mock.module('./forgetting', () => ({ runForgettingSweep: async () => {}, boostDecayOnAccess: async () => {} }));
mock.module('./distillation', () => ({ distillFromExecution: async () => {} }));
mock.module('./dedup', () => ({
  findSemanticDuplicate: async () => null,
  findLexicalDuplicate: async () => null,
}));
mock.module('./rag/reindex', () => ({ runReindexBatch: async () => {}, maybeEnqueueReindex: async () => {} }));
mock.module('./recall/lexical-index', () => ({ invalidateLexicalIndex: () => {} }));
mock.module('./utils', () => ({
  createContentHash: (s: string) => `hash:${s}`,
  parseTagsAsStrings: () => [],
  cosineSimilarity: () => 0,
}));
mock.module('./timeline', () => ({ appendEvent: async () => {}, queryEvents: async () => ({ events: [], total: 0 }) }));
mock.module('../../config/db-provider', () => ({ getInsensitiveMode: () => 'default' }));

const { updateKnowledgeEntry } = await import('./index');

describe('updateKnowledgeEntry — entryVersion', () => {
  beforeEach(() => {
    updateCalls.length = 0;
  });

  test('content change increments entryVersion (1 → 2 semantics)', async () => {
    await updateKnowledgeEntry(5, { content: '修正後の本文' });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data.entryVersion).toEqual({ increment: 1 });
    // content + its hash are updated alongside the version bump.
    expect(updateCalls[0]!.data.content).toBe('修正後の本文');
    expect(updateCalls[0]!.data.contentHash).toBe('hash:修正後の本文');
  });

  test('metadata-only update does NOT touch entryVersion', async () => {
    await updateKnowledgeEntry(6, { confidence: 0.9 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data.entryVersion).toBeUndefined();
  });
});
