/**
 * task-knowledge-suggestions ユニットテスト
 *
 * getKnowledgeBasedSuggestions の分岐（テーマ未検出・知識0件・AI応答不正・
 * 例外送出・関連知識IDのマッチング・件数上限）を検証する。
 *
 * prisma は関数引数として渡されるため mock.module は不要。sendAIMessage /
 * createLogger のみモジュールモックが必要。
 *
 * HACK(agent): bun:test の mock.module はプロセスグローバルなため、
 * ../../utils/ai-client と ../../config の全エクスポートをミラーする
 * （他ファイルが同一プロセス内で本物のエクスポートを要求しても壊れないように）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';

const mockSendAIMessage = mock(() => Promise.resolve({ content: '[]' })) as ReturnType<typeof mock>;

mock.module('../../utils/ai-client', () => ({
  PROVIDER_NAMES: { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', ollama: 'Ollama' },
  isValidApiKeyFormat: () => true,
  getApiKeyForProvider: () => null,
  getDefaultModel: () => 'stub-model',
  getDefaultProvider: () => 'ollama',
  isAnyApiKeyConfigured: () => false,
  getConfiguredProviders: () => [],
  getOllamaUrl: () => 'http://localhost:11434',
  formatApiError: (err: unknown) => String(err),
  handleApiError: () => {
    throw new Error('handleApiError stub should not be called');
  },
  callClaude: () => Promise.reject(new Error('not implemented in test')),
  callClaudeStream: () => Promise.reject(new Error('not implemented in test')),
  callClaudeCli: () => Promise.reject(new Error('not implemented in test')),
  callClaudeCliStream: () => Promise.reject(new Error('not implemented in test')),
  isClaudeCliAvailable: () => Promise.resolve(false),
  callChatGPT: () => Promise.reject(new Error('not implemented in test')),
  callChatGPTStream: () => Promise.reject(new Error('not implemented in test')),
  callGemini: () => Promise.reject(new Error('not implemented in test')),
  callGeminiStream: () => Promise.reject(new Error('not implemented in test')),
  callOllama: () => Promise.reject(new Error('not implemented in test')),
  callOllamaStream: () => Promise.reject(new Error('not implemented in test')),
  checkOllamaConnection: () => Promise.resolve(false),
  getAuxAiMode: () => 'off',
  sendAIMessage: mockSendAIMessage,
  sendAIMessageStream: () => Promise.reject(new Error('not implemented in test')),
}));

mock.module('../../config', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    prisma: {},
    ensureDatabaseConnection: () => Promise.resolve(),
    logger: noopLogger,
    createLogger: () => noopLogger,
    getDbProvider: () => 'postgresql',
    getInsensitiveMode: () => ({ mode: 'insensitive' }),
    getProjectRoot: () => '/tmp/project-root',
  };
});

const { getKnowledgeBasedSuggestions } = await import('./task-knowledge-suggestions');

interface FakeKnowledgeEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  sourceType: string;
  validationStatus: string;
  tags: string | null;
}

const themeFindUnique = mock(() =>
  Promise.resolve({ name: 'テストテーマ', description: 'テーマ説明' }),
) as ReturnType<typeof mock>;
const knowledgeFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

function buildPrisma(): PrismaClient {
  return {
    theme: { findUnique: themeFindUnique },
    knowledgeEntry: { findMany: knowledgeFindMany },
  } as unknown as PrismaClient;
}

function makeEntry(overrides: Partial<FakeKnowledgeEntry> = {}): FakeKnowledgeEntry {
  return {
    id: 1,
    title: 'デフォルトタイトル',
    content: 'デフォルト内容',
    category: 'general',
    confidence: 0.8,
    sourceType: 'manual',
    validationStatus: 'validated',
    tags: null,
    ...overrides,
  };
}

beforeEach(() => {
  themeFindUnique.mockReset();
  themeFindUnique.mockResolvedValue({ name: 'テストテーマ', description: 'テーマ説明' });
  knowledgeFindMany.mockReset();
  knowledgeFindMany.mockResolvedValue([]);
  mockSendAIMessage.mockReset();
  mockSendAIMessage.mockResolvedValue({ content: '[]' });
});

describe('getKnowledgeBasedSuggestions', () => {
  test('テーマが存在しない場合 → 空配列を返し、知識取得もAI呼び出しも行わないこと', async () => {
    themeFindUnique.mockResolvedValueOnce(null);

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 999);

    expect(result).toEqual([]);
    expect(knowledgeFindMany).not.toHaveBeenCalled();
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('知識エントリが0件の場合 → 空配列を返し、AI呼び出しを行わないこと', async () => {
    knowledgeFindMany.mockResolvedValueOnce([]);

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result).toEqual([]);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('theme.findUnique が例外を投げた場合 → 例外を握りつぶし空配列を返すこと', async () => {
    themeFindUnique.mockRejectedValueOnce(new Error('DB error'));

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result).toEqual([]);
  });

  test('AI応答が有効なJSON配列でない場合 → 空配列を返すこと', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry()]);
    mockSendAIMessage.mockResolvedValueOnce({ content: 'これはJSONではありません' });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result).toEqual([]);
  });

  test('正常系: AI応答を提案リストに変換し、priority/source/confidenceの既定値を補完すること', async () => {
    knowledgeFindMany.mockResolvedValueOnce([
      makeEntry({ id: 10, title: 'ログ改善タスク', confidence: 0.9 }),
    ]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify([
        {
          title: 'ログ改善タスク拡張',
          description: '説明文',
          priority: '',
          source: '',
          confidence: 0,
        },
      ]),
    });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 5);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('ログ改善タスク拡張');
    expect(result[0].priority).toBe('medium');
    expect(result[0].source).toBe('knowledge-followup');
    expect(result[0].relatedKnowledgeIds).toEqual([10]);
  });

  test('limit を超えるAI提案がある場合 → limit件に切り詰められること', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry({ id: 1, title: 'A' })]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify([
        { title: 'A', description: '', priority: 'low', source: 'knowledge-gap', confidence: 0.5 },
        { title: 'B', description: '', priority: 'low', source: 'knowledge-gap', confidence: 0.5 },
        { title: 'C', description: '', priority: 'low', source: 'knowledge-gap', confidence: 0.5 },
      ]),
    });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1, 2);

    expect(result).toHaveLength(2);
  });

  test('デフォルトlimit(5)が渡された場合 → 6件のAI提案は5件に切り詰められること', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry({ id: 1, title: 'X' })]);
    const suggestions = Array.from({ length: 6 }, (_, i) => ({
      title: `提案${i}`,
      description: '',
      priority: 'low',
      source: 'knowledge-gap',
      confidence: 0.5,
    }));
    mockSendAIMessage.mockResolvedValueOnce({ content: JSON.stringify(suggestions) });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result).toHaveLength(5);
  });

  test('タイトルが一致しない場合 → relatedKnowledgeIdsは空配列になること', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry({ id: 1, title: '無関係な知識タイトル' })]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify([
        {
          title: '全く別件のタスク',
          description: '',
          priority: 'high',
          source: 'knowledge-gap',
          confidence: 0.6,
        },
      ]),
    });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result[0].relatedKnowledgeIds).toEqual([]);
  });

  test('distilled_procedure / 低信頼度 / conflict の知識が混在する場合 → 例外なく処理されること', async () => {
    knowledgeFindMany.mockResolvedValueOnce([
      makeEntry({ id: 1, title: '手順A', sourceType: 'distilled_procedure' }),
      makeEntry({ id: 2, title: '低信頼知識', confidence: 0.3 }),
      makeEntry({ id: 3, title: '矛盾知識', validationStatus: 'conflict' }),
    ]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify([
        {
          title: '手順Aの見直し',
          description: '',
          priority: 'medium',
          source: 'knowledge-pattern',
          confidence: 0.8,
        },
      ]),
    });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result).toHaveLength(1);
    expect(mockSendAIMessage).toHaveBeenCalledTimes(1);
  });

  test('sendAIMessage が例外を投げた場合 → 例外を握りつぶし空配列を返すこと', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry()]);
    mockSendAIMessage.mockRejectedValueOnce(new Error('AI provider error'));

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result).toEqual([]);
  });

  test('confidenceが明示的に0の場合 → 0.7に上書きされず0のまま保持されること（バグ修正の回帰確認）', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry({ id: 1, title: 'ゼロ信頼度タスク' })]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify([
        {
          title: 'ゼロ信頼度タスク対応',
          description: '',
          priority: 'low',
          source: 'knowledge-gap',
          confidence: 0,
        },
      ]),
    });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result[0].confidence).toBe(0);
  });

  test('confidenceが未指定の場合 → 既定値0.7が使われること', async () => {
    knowledgeFindMany.mockResolvedValueOnce([makeEntry({ id: 1, title: 'A' })]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify([
        { title: 'A対応', description: '', priority: 'low', source: 'knowledge-gap' },
      ]),
    });

    const result = await getKnowledgeBasedSuggestions(buildPrisma(), 1);

    expect(result[0].confidence).toBe(0.7);
  });
});
