/**
 * reindex-batch テスト
 *
 * dryRun は書き込みなし、対象モデル済み行のスキップ、予算での停止、
 * 1 件失敗時の継続、自動投入の重複防止・無効化条件を検証する。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

type Row = { id: number; title: string; content: string };
let rows: Row[] = [];
let storedModels = new Map<number, string>();
let byModel: Record<string, number> = {};
let existingJob: { id: number; status: string } | null = null;
let embeddingCount = 0;

const mockGenerateEmbedding = mock((_text: string) =>
  Promise.resolve({ embedding: [1, 0, 0], model: 'new-model', dimension: 3 }),
);
const mockUpsert = mock((_id: number, _emb: number[], _preview?: string, _model?: string) => {});
const mockEnqueue = mock((_type: string, _payload: Record<string, unknown>, _prio: number) =>
  Promise.resolve(42),
);
const mockAppendEvent = mock((_ev: Record<string, unknown>) => Promise.resolve({ id: 1 }));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));
mock.module('../../../../config/database', () => ({
  prisma: {
    knowledgeEntry: {
      count: () => Promise.resolve(rows.length),
      findMany: ({ where, take }: { where: { id: { gt: number } }; take: number }) =>
        Promise.resolve(rows.filter((r) => r.id > where.id.gt).slice(0, take)),
    },
    memoryTaskQueue: { findFirst: () => Promise.resolve(existingJob) },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../embedding', () => ({
  ensureEmbeddingReady: () => Promise.resolve('new-model'),
  generateEmbedding: mockGenerateEmbedding,
  getActiveEmbeddingModel: () => 'new-model',
  getConfiguredEmbeddingModel: () => 'new-model',
  isEmbeddingSubprocess: () => false,
}));
mock.module('../vector-index', () => ({
  countEmbeddingsByModel: () => byModel,
  getEmbeddingCount: () => embeddingCount,
  getEmbeddingModels: (ids: number[]) => {
    const out = new Map<number, string>();
    for (const id of ids) if (storedModels.has(id)) out.set(id, storedModels.get(id)!);
    return out;
  },
  upsertEmbedding: mockUpsert,
}));
mock.module('../../timeline', () => ({ appendEvent: mockAppendEvent }));

const { runReindexBatch, countReindexPending, maybeEnqueueReindex, getEmbeddingIndexStatus } =
  await import('./reindex-batch');

const fakeQueue = { enqueue: mockEnqueue } as unknown as Parameters<typeof maybeEnqueueReindex>[0];

beforeEach(() => {
  rows = [
    { id: 1, title: 'A', content: 'a' },
    { id: 2, title: 'B', content: 'b' },
    { id: 3, title: 'C', content: 'c' },
  ];
  storedModels = new Map([[2, 'new-model']]);
  byModel = { 'new-model': 1, 'old-model': 2 };
  existingJob = null;
  embeddingCount = 3;
  mockGenerateEmbedding
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve({ embedding: [1, 0, 0], model: 'new-model', dimension: 3 }),
    );
  mockUpsert.mockReset();
  mockEnqueue.mockReset().mockReturnValue(Promise.resolve(42));
  mockAppendEvent.mockReset().mockReturnValue(Promise.resolve({ id: 1 }));
});

afterEach(() => {
  delete process.env.RAPITAS_KB_REINDEX_AUTO;
});

describe('countReindexPending / getEmbeddingIndexStatus', () => {
  test('総数 − 対象モデル件数（負にならない）', async () => {
    expect(await countReindexPending('new-model')).toBe(2);
    byModel = { 'new-model': 10 };
    expect(await countReindexPending('new-model')).toBe(0);
  });

  test('status は active/configured/byModel/total/pendingReindex を返す', async () => {
    const s = await getEmbeddingIndexStatus();
    expect(s).toEqual({
      activeModel: 'new-model',
      configuredModel: 'new-model',
      byModel: { 'new-model': 1, 'old-model': 2 },
      total: 3,
      pendingReindex: 2,
    });
  });
});

describe('runReindexBatch', () => {
  test('dryRun は埋め込みも書き込みもせず残件だけ返す', async () => {
    const r = await runReindexBatch({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.remaining).toBe(2);
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAppendEvent).not.toHaveBeenCalled();
  });

  test('対象モデル済みの行はスキップし、title\\ncontent を実測モデル名で upsert する', async () => {
    const r = await runReindexBatch({ batchSize: 2, pauseMs: 0 });
    expect(r.scanned).toBe(3);
    expect(r.reembedded).toBe(2);
    expect(r.failed).toBe(0);
    expect(mockGenerateEmbedding.mock.calls.map((c) => c[0])).toEqual(['A\na', 'C\nc']);
    expect(mockUpsert.mock.calls.map((c) => [c[0], c[3]])).toEqual([
      [1, 'new-model'],
      [3, 'new-model'],
    ]);
    expect(mockAppendEvent.mock.calls[0][0].eventType).toBe('embedding_reindex');
  });

  test('maxEntries に達したら停止する', async () => {
    const r = await runReindexBatch({ batchSize: 10, pauseMs: 0, maxEntries: 1 });
    expect(r.reembedded).toBe(1);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  test('1 件の失敗は数えて続行する', async () => {
    mockGenerateEmbedding.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const r = await runReindexBatch({ batchSize: 10, pauseMs: 0 });
    expect(r.failed).toBe(1);
    expect(r.reembedded).toBe(1);
  });
});

describe('maybeEnqueueReindex', () => {
  test('残件があり既存ジョブが無ければ priority 1 で投入する', async () => {
    const id = await maybeEnqueueReindex(fakeQueue);
    expect(id).toBe(42);
    expect(mockEnqueue).toHaveBeenCalledWith('reembed', {}, 1);
  });

  test('pending/processing の reembed があれば重複投入せずその id を返す', async () => {
    existingJob = { id: 7, status: 'pending' };
    expect(await maybeEnqueueReindex(fakeQueue)).toBe(7);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('残件 0 なら何もしない', async () => {
    byModel = { 'new-model': 3 };
    expect(await maybeEnqueueReindex(fakeQueue)).toBeNull();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  test('索引が空なら何もしない（新規環境は書込時に埋め込まれる）', async () => {
    embeddingCount = 0;
    expect(await maybeEnqueueReindex(fakeQueue)).toBeNull();
  });

  test('RAPITAS_KB_REINDEX_AUTO=0 で無効化できる', async () => {
    process.env.RAPITAS_KB_REINDEX_AUTO = '0';
    expect(await maybeEnqueueReindex(fakeQueue)).toBeNull();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
