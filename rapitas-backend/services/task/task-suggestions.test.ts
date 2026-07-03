/**
 * task-suggestions ユニットテスト
 *
 * generateAISuggestions の正常系・異常系（APIキー未設定・テーマ未検出・
 * JSONパース失敗・AI呼び出し失敗・キャッシュ失敗）を検証する。
 * task-ai-prompts.ts は純粋関数のためモックせず実実装を使用する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): bun:test の mock.module はプロセスグローバルなため、
// 全エクスポートをミラーしないとバレルが "export not found" をスローする。
const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const mockSendAIMessage = mock(() =>
  Promise.resolve({ content: '{}', tokensUsed: 0 }),
) as ReturnType<typeof mock>;
const mockGetDefaultProvider = mock(() => Promise.resolve('claude')) as ReturnType<typeof mock>;
const mockIsAnyApiKeyConfigured = mock(() => Promise.resolve(true)) as ReturnType<typeof mock>;

mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
  getDefaultProvider: mockGetDefaultProvider,
  isAnyApiKeyConfigured: mockIsAnyApiKeyConfigured,
  sendAIMessageStream: mock(() => Promise.resolve(new ReadableStream())),
  getAuxAiMode: mock(() => 'cli'),
  isValidApiKeyFormat: mock(() => true),
  getApiKeyForProvider: mock(() => Promise.resolve(null)),
  getDefaultModel: mock(() => 'claude-model'),
  getConfiguredProviders: mock(() => Promise.resolve([])),
  getOllamaUrl: mock(() => 'http://localhost:11434'),
  formatApiError: mock(() => 'error'),
  handleApiError: mock(() => ({ content: '', tokensUsed: 0 })),
  callClaude: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callClaudeStream: mock(() => Promise.resolve(new ReadableStream())),
  callClaudeCli: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callClaudeCliStream: mock(() => Promise.resolve(new ReadableStream())),
  isClaudeCliAvailable: mock(() => Promise.resolve(false)),
  callChatGPT: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callChatGPTStream: mock(() => Promise.resolve(new ReadableStream())),
  callGemini: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callGeminiStream: mock(() => Promise.resolve(new ReadableStream())),
  callOllama: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callOllamaStream: mock(() => Promise.resolve(new ReadableStream())),
  checkOllamaConnection: mock(() => Promise.resolve(false)),
  PROVIDER_NAMES: { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', ollama: 'Ollama' },
}));

const { generateAISuggestions, getFrequencyBasedSuggestions } = await import('./task-suggestions');

function createMockPrisma() {
  return {
    theme: {
      findUnique: mock(() => Promise.resolve(null)) as ReturnType<typeof mock>,
    },
    task: {
      findMany: mock(() => Promise.resolve([])) as ReturnType<typeof mock>,
    },
    taskPattern: {
      findMany: mock(() => Promise.resolve([])) as ReturnType<typeof mock>,
    },
    userBehaviorSummary: {
      findFirst: mock(() => Promise.resolve(null)) as ReturnType<typeof mock>,
    },
    taskSuggestionCache: {
      deleteMany: mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>,
      createMany: mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>,
    } as
      | {
          deleteMany: ReturnType<typeof mock>;
          createMany: ReturnType<typeof mock>;
        }
      | undefined,
  };
}

let mockPrisma = createMockPrisma();

const VALID_SUGGESTION_JSON = JSON.stringify({
  analysis: '分析結果',
  suggestions: [
    {
      title: 'タスクA',
      description: '説明A',
      priority: 'high',
      estimatedHours: 2,
      reason: '理由A',
      category: 'new',
      completionCriteria: '完了条件',
      measurableOutcome: '成果',
      dependencies: '依存',
      suggestedApproach: 'アプローチ',
    },
  ],
});

beforeEach(() => {
  mockPrisma = createMockPrisma();
  mockSendAIMessage.mockReset();
  mockSendAIMessage.mockResolvedValue({ content: VALID_SUGGESTION_JSON, tokensUsed: 42 });
  mockGetDefaultProvider.mockReset();
  mockGetDefaultProvider.mockResolvedValue('claude');
  mockIsAnyApiKeyConfigured.mockReset();
  mockIsAnyApiKeyConfigured.mockResolvedValue(true);
});

describe('generateAISuggestions — 前提条件チェック', () => {
  test('APIキー未設定の場合、insufficient_data を返し theme を検索しないこと', async () => {
    mockIsAnyApiKeyConfigured.mockResolvedValueOnce(false);

    const result = await generateAISuggestions(mockPrisma as never, 1, 5);

    expect(result).toEqual({ suggestions: [], source: 'insufficient_data' });
    expect(mockPrisma.theme.findUnique).not.toHaveBeenCalled();
  });

  test('テーマが見つからない場合、source=none を返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce(null);

    const result = await generateAISuggestions(mockPrisma as never, 999, 5);

    expect(result).toEqual({ suggestions: [], source: 'none' });
  });
});

describe('generateAISuggestions — 正常系', () => {
  test('完了タスクがある場合、AI提案を生成しキャッシュすること', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({
      id: 1,
      name: 'テストテーマ',
      description: null,
    });
    mockPrisma.task.findMany
      .mockResolvedValueOnce([
        {
          title: '過去タスク',
          description: null,
          priority: 'medium',
          estimatedHours: 1,
          actualHours: 1,
          completedAt: new Date(),
          taskLabels: [],
        },
      ])
      .mockResolvedValueOnce([{ title: '進行中タスク' }]);

    const result = await generateAISuggestions(mockPrisma as never, 1, 3);

    expect(result.source).toBe('ai');
    expect(result.tokensUsed).toBe(42);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        title: 'タスクA',
        priority: 'high',
        labelIds: [],
        frequency: 0,
      }),
    );
    expect(mockPrisma.taskSuggestionCache!.deleteMany).toHaveBeenCalledWith({
      where: { themeId: 1 },
    });
    expect(mockPrisma.taskSuggestionCache!.createMany).toHaveBeenCalled();
  });

  test('完了タスクが無い場合でも提案を生成すること（初回提案の文言分岐）', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({
      id: 2,
      name: 'New Theme',
      description: null,
    });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await generateAISuggestions(mockPrisma as never, 2, 3);

    expect(result.source).toBe('ai');
    const promptArg = mockSendAIMessage.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    };
    expect(promptArg.messages[0]!.content).toContain('このテーマに関するタスクはまだありません');
  });

  test('limit を超える提案は切り詰められること', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 3, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const manySuggestions = JSON.stringify({
      analysis: 'a',
      suggestions: Array.from({ length: 5 }, (_, i) => ({ title: `T${i}` })),
    });
    mockSendAIMessage.mockResolvedValueOnce({ content: manySuggestions, tokensUsed: 1 });

    const result = await generateAISuggestions(mockPrisma as never, 3, 2);

    expect(result.suggestions).toHaveLength(2);
  });

  test('省略されたフィールドにデフォルト値を適用すること', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 4, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const minimal = JSON.stringify({ suggestions: [{ title: 'Minimal' }] });
    mockSendAIMessage.mockResolvedValueOnce({ content: minimal, tokensUsed: 1 });

    const result = await generateAISuggestions(mockPrisma as never, 4, 5);

    expect(result.suggestions[0]).toEqual({
      title: 'Minimal',
      description: null,
      priority: 'medium',
      estimatedHours: null,
      reason: null,
      category: 'new',
      completionCriteria: null,
      measurableOutcome: null,
      dependencies: null,
      suggestedApproach: null,
      labelIds: [],
      frequency: 0,
    });
    expect(result.analysis).toBeNull();
  });

  test('taskSuggestionCache テーブルが存在しない場合、キャッシュをスキップしても成功すること', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 5, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.taskSuggestionCache = undefined;

    const result = await generateAISuggestions(mockPrisma as never, 5, 5);

    expect(result.source).toBe('ai');
  });

  test('キャッシュ書き込みが失敗しても、提案自体は返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 6, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockPrisma.taskSuggestionCache!.deleteMany.mockRejectedValueOnce(new Error('db fail'));

    const result = await generateAISuggestions(mockPrisma as never, 6, 5);

    expect(result.source).toBe('ai');
    expect(result.suggestions).toHaveLength(1);
  });
});

describe('generateAISuggestions — 異常系', () => {
  test('レスポンスにJSONが含まれない場合、ai_error を返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 7, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockSendAIMessage.mockResolvedValueOnce({ content: 'no json here', tokensUsed: 0 });

    const result = await generateAISuggestions(mockPrisma as never, 7, 5);

    expect(result).toEqual({ suggestions: [], source: 'ai_error' });
  });

  test('suggestions が空配列の場合、ai_error を返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 8, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({ analysis: 'x', suggestions: [] }),
      tokensUsed: 0,
    });

    const result = await generateAISuggestions(mockPrisma as never, 8, 5);

    expect(result.source).toBe('ai_error');
  });

  test('壊れたJSONの場合、例外を捕捉し ai_error を返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 9, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockSendAIMessage.mockResolvedValueOnce({
      content: '{ "suggestions": [ broken',
      tokensUsed: 0,
    });

    const result = await generateAISuggestions(mockPrisma as never, 9, 5);

    expect(result).toEqual({ suggestions: [], source: 'ai_error' });
  });

  test('sendAIMessage が例外を投げた場合、ai_error を返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 10, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockSendAIMessage.mockRejectedValueOnce(new Error('API error'));

    const result = await generateAISuggestions(mockPrisma as never, 10, 5);

    expect(result).toEqual({ suggestions: [], source: 'ai_error' });
  });

  test('getDefaultProvider が例外を投げた場合、ai_error を返すこと', async () => {
    mockPrisma.theme.findUnique.mockResolvedValueOnce({ id: 11, name: 'T', description: null });
    mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockGetDefaultProvider.mockRejectedValueOnce(new Error('provider error'));

    const result = await generateAISuggestions(mockPrisma as never, 11, 5);

    expect(result).toEqual({ suggestions: [], source: 'ai_error' });
  });
});

describe('getFrequencyBasedSuggestions 再エクスポート', () => {
  test('task-frequency-suggestions から re-export されていること', () => {
    expect(typeof getFrequencyBasedSuggestions).toBe('function');
  });
});
