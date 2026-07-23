/**
 * findRelatedKnowledge 関連度テスト
 *
 * 被覆率（bigramCoverage）採点と RELATED_KNOWLEDGE_MIN_COVERAGE 足切り、
 * および日本語クエリへの CJK n-gram キーワード展開を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';

// HACK(agent): Bun mock型推論の制限 — `as any` で型チェックをバイパス
const findMany = mock(() => Promise.resolve([] as unknown[])) as any;
const mockPrisma = { knowledgeEntry: { findMany } };

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return { createLogger: () => noop, logger: noop, getBackendLogFilePath: () => '/tmp/b.log' };
});
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: () => Promise.resolve({ content: '', tokensUsed: 0 }),
}));
mock.module('../../utils/common/json-extractor', () => ({ parseJsonArray: () => null }));
mock.module('../../services/memory/timeline', () => ({ appendEvent: () => Promise.resolve() }));
mock.module('../../services/memory/index', () => ({
  memoryTaskQueue: { enqueue: () => Promise.resolve() },
}));
// NOTE: bun mock.module replaces the module for ALL importers, so the mock
// must mirror every export — rag/vector-index imports cosineSimilarity too.
mock.module('../../services/memory/utils', () => ({
  createContentHash: (s: string) => s,
  cosineSimilarity: () => 0,
}));

const { findRelatedKnowledge } = await import('../../services/memory/task-knowledge-extractor');

/** Extracts the `contains` keyword of each OR clause passed to findMany. */
function keywordsOfCall(callIndex: number): string[] {
  const where = (
    findMany.mock.calls[callIndex][0] as {
      where: { OR: Array<{ OR: Array<{ title?: { contains: string } }> }> };
    }
  ).where;
  return where.OR.map((clause) => clause.OR[0].title?.contains ?? '');
}

const baseEntry = {
  category: 'pattern',
  confidence: 0.7,
  decayScore: 1,
  themeId: null,
  tags: '[]',
  validationStatus: 'pending',
};

describe('findRelatedKnowledge relevance', () => {
  test('日本語クエリの where.OR に 3文字 n-gram キーワードが追加される', async () => {
    findMany.mockResolvedValueOnce([]);
    await findRelatedKnowledge('タスク作成画面のちらつき修正', null);
    const kws = keywordsOfCall(findMany.mock.calls.length - 1);
    // Full token + non-overlapping trigrams (was: a single giant keyword).
    expect(kws.length).toBeGreaterThanOrEqual(2);
    expect(kws).toContain('タスク作成画面のちらつき修正');
    expect(kws).toContain('タスク');
    expect(kws).toContain('作成画');
  });

  test('英数字のみのクエリでは従来どおり区切り文字分割のみ（n-gram なし）', async () => {
    findMany.mockResolvedValueOnce([]);
    await findRelatedKnowledge('extractJsonArray helper', null);
    const kws = keywordsOfCall(findMany.mock.calls.length - 1);
    expect(kws).toEqual(['extractjsonarray', 'helper']);
  });

  test('take は limit * 6（足切りで削られる分の候補を確保）', async () => {
    findMany.mockResolvedValueOnce([]);
    await findRelatedKnowledge('タスク作成画面のちらつき修正', null, null, 5);
    const args = findMany.mock.calls[findMany.mock.calls.length - 1][0] as { take: number };
    expect(args.take).toBe(30);
  });

  test('日本語主題が一致するエントリは残り、無関係エントリは足切りされる', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 1,
        title: 'タスク作成画面のバリデーション',
        content: 'タスク作成画面のちらつき修正は表示条件の変更で行う。',
        ...baseEntry,
      },
      {
        id: 2,
        title: 'SQLiteの接続プール設定',
        content: '接続プールの最大数は10に設定する。',
        ...baseEntry,
      },
    ]);
    const res = await findRelatedKnowledge('タスク作成画面のちらつき修正', null);
    expect(res.map((e) => e.id)).toEqual([1]);
  });

  test('全候補が閾値未満なら空配列を返す', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 3,
        title: 'デプロイ禁止曜日',
        content: '金曜日のデプロイは避けるべきである。',
        ...baseEntry,
      },
    ]);
    const res = await findRelatedKnowledge('タスク作成画面のちらつき修正', null);
    expect(res).toEqual([]);
  });

  test('無関係エントリより関連エントリのスコアが高い（被覆率が支配項）', async () => {
    findMany.mockResolvedValueOnce([
      {
        id: 4,
        title: 'タスク作成画面のちらつき修正手順',
        content: 'タスク作成画面のちらつき修正では debounce と描画条件を見直す。',
        ...baseEntry,
      },
      {
        id: 5,
        title: 'タスク作成画面の色設定',
        content: 'タスク作成画面の配色はダークモード対応が必要。',
        ...baseEntry,
      },
    ]);
    const res = await findRelatedKnowledge('タスク作成画面のちらつき修正', null);
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res[0].id).toBe(4); // full-phrase entry outranks partial overlap
  });
});
