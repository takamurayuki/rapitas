/**
 * Workflow Memory Context テスト
 *
 * 過去知見の注入: 純粋レンダラ(renderMemorySection)の整形と空入力、
 * buildMemoryContext のテーマ優先→グローバルフォールバック、
 * 検索失敗時のサイレント縮退(''返し)を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface SearchOpts {
  query: string;
  limit?: number;
  minSimilarity?: number;
  stages?: string[];
  themeId?: number;
  themeFallback?: boolean;
  telemetry?: { source: string; taskId?: number };
}
interface KnowledgeRow {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  forgettingStage: string;
  similarity: number;
  tags: string[];
  createdAt: Date;
  taskId: number | null;
  validationStatus: string;
  channel: 'vector' | 'lexical' | 'both';
  lexicalScore: number | null;
}

const mockSearchKnowledge = mock((_opts: SearchOpts) => Promise.resolve([] as KnowledgeRow[]));
const mockFindUnique = mock((_args: unknown) => Promise.resolve({ themeId: 3 }));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: { task: { findUnique: mockFindUnique } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/memory/recall/hybrid-search', () => ({
  searchKnowledgeHybrid: mockSearchKnowledge,
}));

const { buildMemoryContext, renderMemorySection } =
  await import('../../services/workflow/workflow-memory-context');

function row(over: Partial<KnowledgeRow>): KnowledgeRow {
  return {
    id: 1,
    title: 't',
    content: 'c',
    category: 'bug',
    confidence: 0.8,
    forgettingStage: 'active',
    similarity: 0.7,
    tags: [],
    createdAt: new Date(0),
    taskId: null,
    validationStatus: 'pending',
    channel: 'vector',
    lexicalScore: null,
    ...over,
  };
}

describe('renderMemorySection', () => {
  test('空配列なら空文字を返す', () => {
    expect(renderMemorySection([], 'ja')).toBe('');
    expect(renderMemorySection([], 'en')).toBe('');
  });

  test('カテゴリ・タイトル・関連度%・本文を整形して含める', () => {
    const out = renderMemorySection(
      [
        {
          id: 77,
          title: 'N+1クエリ',
          content: 'findManyをループで呼ぶと遅い',
          category: 'perf',
          similarity: 0.82,
        },
      ],
      'ja',
    );
    expect(out).toContain('過去の知見');
    expect(out).toContain('[perf] N+1クエリ');
    expect(out).toContain('82%');
    expect(out).toContain('findManyをループ');
    // R8: entries carry a K-<id> handle + the usage-declaration instruction.
    expect(out).toContain('K-77');
    expect(out).toContain('使用知識');
  });

  test('dormant / archived には要検証マーカーを付ける', () => {
    const out = renderMemorySection(
      [
        {
          id: 1,
          title: 'A',
          content: 'a',
          category: 'x',
          similarity: 0.6,
          forgettingStage: 'dormant',
        },
        {
          id: 2,
          title: 'B',
          content: 'b',
          category: 'x',
          similarity: 0.6,
          forgettingStage: 'archived',
        },
        {
          id: 3,
          title: 'C',
          content: 'c',
          category: 'x',
          similarity: 0.6,
          forgettingStage: 'active',
        },
      ],
      'ja',
    );
    expect(out).toContain('休眠中の知見（要検証）');
    expect(out).toContain('アーカイブ済みの知見（古い可能性・要検証）');
    const en = renderMemorySection(
      [
        {
          id: 2,
          title: 'B',
          content: 'b',
          category: 'x',
          similarity: 0.6,
          forgettingStage: 'archived',
        },
      ],
      'en',
    );
    expect(en).toContain('archived, may be stale');
  });

  test('語彙チャネルのみのヒットは lexicalScore を関連度として表示する', () => {
    const out = renderMemorySection(
      [
        {
          id: 5,
          title: 'L',
          content: 'l',
          category: 'x',
          similarity: 0,
          channel: 'lexical',
          lexicalScore: 0.42,
        },
      ],
      'ja',
    );
    expect(out).toContain('関連度 42%');
    expect(out).not.toContain('関連度 0%');
  });

  test('長い本文は切り詰める(…付き)', () => {
    const long = 'x'.repeat(1000);
    const out = renderMemorySection(
      [{ id: 1, title: 'T', content: long, category: 'bug', similarity: 0.6 }],
      'en',
    );
    expect(out).toContain('…');
    // The full 1000-char body must not appear verbatim (only the 400-char snippet).
    expect(out).not.toContain(long);
  });
});

describe('buildMemoryContext', () => {
  beforeEach(() => {
    mockSearchKnowledge.mockReset().mockReturnValue(Promise.resolve([] as KnowledgeRow[]));
    mockFindUnique.mockReset().mockReturnValue(Promise.resolve({ themeId: 3 }));
  });

  test('関連知見があればテーマID・全ステージ・workflow テレメトリで検索しセクションを返す', async () => {
    mockSearchKnowledge.mockReturnValue(
      Promise.resolve([row({ title: '教訓A', similarity: 0.9 })]),
    );
    const out = await buildMemoryContext(10, { title: 'T', description: 'D' }, 'ja');
    expect(out).toContain('教訓A');
    const opts = mockSearchKnowledge.mock.calls[0][0];
    expect(opts.themeId).toBe(3);
    // Stages come from RAPITAS_KB_RECALL_STAGES (default: every stage) — no
    // longer pinned to 'active'.
    expect(opts.stages).toEqual(['active', 'dormant', 'archived']);
    expect(opts.minSimilarity).toBe(0.55);
    expect(opts.limit).toBe(6);
    expect(opts.telemetry).toEqual({ source: 'workflow', taskId: 10 });
  });

  test('テーマ→グローバルのフォールバックは themeFallback として 1 回の呼び出しに委ねる', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.resolve([row({ title: '横断教訓' })]));
    const out = await buildMemoryContext(10, { title: 'T', description: 'D' }, 'ja');
    expect(out).toContain('横断教訓');
    expect(mockSearchKnowledge).toHaveBeenCalledTimes(1);
    expect(mockSearchKnowledge.mock.calls[0][0].themeFallback).toBe(true);
  });

  test('archived の知見はマーカー付きで注入される', async () => {
    mockSearchKnowledge.mockReturnValue(
      Promise.resolve([row({ title: '古い教訓', forgettingStage: 'archived' })]),
    );
    const out = await buildMemoryContext(10, { title: 'T', description: 'D' }, 'ja');
    expect(out).toContain('古い教訓');
    expect(out).toContain('アーカイブ済みの知見');
  });

  test('検索が throw してもサイレントに空文字へ縮退する', async () => {
    mockSearchKnowledge.mockReturnValue(Promise.reject(new Error('embeddings disabled')));
    const out = await buildMemoryContext(10, { title: 'T', description: 'D' }, 'ja');
    expect(out).toBe('');
  });

  test('クエリが空(タイトル/説明とも空)なら検索せず空文字', async () => {
    const out = await buildMemoryContext(10, { title: '', description: null }, 'ja');
    expect(out).toBe('');
    expect(mockSearchKnowledge).not.toHaveBeenCalled();
  });
});
