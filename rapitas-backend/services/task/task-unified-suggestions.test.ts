/**
 * task-unified-suggestions ユニットテスト
 *
 * getUnifiedSuggestions のマージ・重複排除・ソート・エラー耐性ロジックを検証する。
 * getFrequencyBasedSuggestions / getKnowledgeBasedSuggestions は mock.module で
 * 差し替える（bun:test の mock.module はプロセスグローバルなため、各モジュールの
 * 全エクスポートをミラーする必要がある — 両モジュールとも対象関数のみをエクスポート）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';

const mockGetFrequencyBasedSuggestions = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
const mockGetKnowledgeBasedSuggestions = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

mock.module('./task-frequency-suggestions', () => ({
  getFrequencyBasedSuggestions: mockGetFrequencyBasedSuggestions,
}));
mock.module('./task-knowledge-suggestions', () => ({
  getKnowledgeBasedSuggestions: mockGetKnowledgeBasedSuggestions,
}));
mock.module('../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { getUnifiedSuggestions } = await import('./task-unified-suggestions');

function buildPrisma(): PrismaClient {
  return {} as unknown as PrismaClient;
}

interface FreqSuggestion {
  title: string;
  frequency: number;
  priority: string;
  estimatedHours: number | null;
  description: string | null;
  labelIds: number[];
}

interface KnowledgeSuggestion {
  title: string;
  description: string;
  priority: string;
  source: 'knowledge-pattern' | 'knowledge-gap' | 'knowledge-followup';
  relatedKnowledgeIds: number[];
  confidence: number;
}

function freq(overrides: Partial<FreqSuggestion> & { title: string }): FreqSuggestion {
  return {
    frequency: 1,
    priority: 'medium',
    estimatedHours: null,
    description: null,
    labelIds: [],
    ...overrides,
  };
}

function knowledge(
  overrides: Partial<KnowledgeSuggestion> & { title: string },
): KnowledgeSuggestion {
  return {
    description: '',
    priority: 'medium',
    source: 'knowledge-followup',
    relatedKnowledgeIds: [],
    confidence: 0.7,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetFrequencyBasedSuggestions.mockReset();
  mockGetKnowledgeBasedSuggestions.mockReset();
  mockGetFrequencyBasedSuggestions.mockResolvedValue([]);
  mockGetKnowledgeBasedSuggestions.mockResolvedValue([]);
});

describe('getUnifiedSuggestions', () => {
  test('両方のソースが空の場合 → 空配列を返すこと', async () => {
    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);
    expect(result).toEqual([]);
  });

  test('頻度ベースの提案は source: frequency として反映されること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: 'ユニークな提案' })]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'ユニークな提案', source: 'frequency' });
  });

  test('知識ベースの提案は source: knowledge として反映されること', async () => {
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '知識ベース提案' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: '知識ベース提案', source: 'knowledge' });
  });

  test('frequency の confidence は 0.5 + frequency*0.1 (上限1) で計算されること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: 'A', frequency: 2 })]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result[0].confidence).toBeCloseTo(0.7);
  });

  test('frequency が非常に高い場合でも confidence は 1 を超えないこと', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: 'A', frequency: 50 })]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result[0].confidence).toBe(1);
  });

  test.each([
    ['knowledge-gap', '知識ベースのギャップを補填'],
    ['knowledge-pattern', '蓄積パターンからの提案'],
    ['knowledge-followup', '過去の学びに基づくフォローアップ'],
  ] as const)('knowledge source=%s → reason が "%s" になること', async (source, expectedReason) => {
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([knowledge({ title: 'X', source })]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result[0].reason).toBe(expectedReason);
  });

  test('頻度ベース取得が失敗しても知識ベースの提案は返ること', async () => {
    mockGetFrequencyBasedSuggestions.mockImplementationOnce(() =>
      Promise.reject(new Error('DB error')),
    );
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([knowledge({ title: '生存提案' })]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('生存提案');
  });

  test('知識ベース取得が失敗しても頻度ベースの提案は返ること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: '生存提案' })]);
    mockGetKnowledgeBasedSuggestions.mockImplementationOnce(() =>
      Promise.reject(new Error('AI error')),
    );

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('生存提案');
  });

  test('両方のソースが失敗した場合 → 空配列を返し例外を投げないこと', async () => {
    mockGetFrequencyBasedSuggestions.mockImplementationOnce(() =>
      Promise.reject(new Error('DB error')),
    );
    mockGetKnowledgeBasedSuggestions.mockImplementationOnce(() =>
      Promise.reject(new Error('AI error')),
    );

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toEqual([]);
  });

  test('完全に同一のタイトルは1件にマージされ source が merged になること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      freq({ title: '重複タスク', frequency: 1 }),
    ]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '重複タスク', confidence: 0.9 }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('merged');
  });

  test('マージ時、confidence が高い方の title/description が採用されること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      freq({ title: '重複タスク', frequency: 1, description: '古い説明' }),
    ]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '重複タスク詳細版', confidence: 0.95, description: '新しい説明' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('重複タスク詳細版');
    expect(result[0].description).toBe('新しい説明');
    expect(result[0].confidence).toBeCloseTo(0.95);
  });

  test('マージ時、後発の confidence が低い場合は既存の title/description が維持されること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      freq({ title: '重複タスク', frequency: 5, description: '頻度ベースの説明' }),
    ]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '重複タスク', confidence: 0.1, description: '低信頼の説明' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('重複タスク');
    expect(result[0].description).toBe('頻度ベースの説明');
  });

  test('マージ時、両方の reason が連結されること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      freq({ title: '重複タスク', frequency: 1 }),
    ]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '重複タスク', source: 'knowledge-gap' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result[0].reason).toContain('過去に');
    expect(result[0].reason).toContain('知識ベースのギャップを補填');
    expect(result[0].reason).toContain('+');
  });

  test('部分文字列一致する類似タイトルもマージされること（片方がもう片方を含む）', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: 'テスト実装' })]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: 'テスト実装を行う' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
  });

  test('単語重複率が60%を超える類似タイトルはマージされること（部分文字列一致は不成立の語順違い）', async () => {
    // 語順を入れ替えて substring 一致（na.includes(nb) 等）を意図的に不成立にし、
    // 単語集合の Jaccard 類似度分岐 (3/4=0.75 > 0.6) のみで一致することを検証する。
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: '設計 実装 確認' })]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '詳細 確認 実装 設計' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(1);
  });

  test('無関係なタイトルはマージされず個別に残ること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([freq({ title: '会計処理の自動化' })]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: 'UIデザインの刷新' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result).toHaveLength(2);
  });

  test('結果は confidence 降順にソートされること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      freq({ title: '低頻度タスク', frequency: 1 }),
    ]);
    mockGetKnowledgeBasedSuggestions.mockResolvedValueOnce([
      knowledge({ title: '高信頼タスク', confidence: 0.99 }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result[0].title).toBe('高信頼タスク');
    expect(result[1].title).toBe('低頻度タスク');
  });

  test('limit を超える件数がある場合 → limit 件に切り詰められること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      freq({ title: 'A' }),
      freq({ title: 'B' }),
      freq({ title: 'C' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 2);

    expect(result).toHaveLength(2);
  });

  test('limit を省略した場合 → デフォルト値 8 が使われること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => freq({ title: `タスク${i}` })),
    );

    const result = await getUnifiedSuggestions(buildPrisma(), 1);

    expect(result).toHaveLength(8);
  });

  test('frequency 提案の description/priority が未設定の場合 → デフォルト値が使われること', async () => {
    mockGetFrequencyBasedSuggestions.mockResolvedValueOnce([
      // HACK(agent): getFrequencyBasedSuggestions の戻り値契約上 description/priority は
      // 常に値を持つが、フォールバック分岐 (`|| ''` / `|| 'medium'`) の防御的コードを
      // カバーするため意図的に falsy 値を注入する。
      freq({ title: 'フォールバック確認', description: '', priority: '' }),
    ]);

    const result = await getUnifiedSuggestions(buildPrisma(), 1, 8);

    expect(result[0].description).toBe('');
    expect(result[0].priority).toBe('medium');
  });
});
