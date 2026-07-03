/**
 * task-spec-deriver ユニットテスト
 *
 * deriveTaskSpec / generateIntakeQuestions / generateIntakeGoalOptions の
 * 正常系・異常系・境界値を検証する。AI クライアントは mock.module でスタブ化する。
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

const mockSendAIMessage = mock(() => Promise.resolve({ content: '{}' }));
const mockGetDefaultProvider = mock(() => Promise.resolve('claude'));
const mockIsAnyApiKeyConfigured = mock(() => Promise.resolve(true));

mock.module('../../utils/ai-client', () => ({
  PROVIDER_NAMES: { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' },
  isValidApiKeyFormat: mock(() => true),
  getApiKeyForProvider: mock(() => Promise.resolve(null)),
  getDefaultModel: mock(() => Promise.resolve('claude-sonnet')),
  getDefaultProvider: mockGetDefaultProvider,
  isAnyApiKeyConfigured: mockIsAnyApiKeyConfigured,
  getConfiguredProviders: mock(() => Promise.resolve([])),
  getOllamaUrl: mock(() => 'http://localhost:11434'),
  formatApiError: mock(() => 'error'),
  handleApiError: mock(() => {
    throw new Error('handled');
  }),
  callClaude: mock(() => Promise.resolve({ content: '' })),
  callClaudeStream: mock(() => Promise.resolve(new ReadableStream())),
  callClaudeCli: mock(() => Promise.resolve({ content: '' })),
  callClaudeCliStream: mock(() => Promise.resolve(new ReadableStream())),
  isClaudeCliAvailable: mock(() => Promise.resolve(false)),
  callChatGPT: mock(() => Promise.resolve({ content: '' })),
  callChatGPTStream: mock(() => Promise.resolve(new ReadableStream())),
  callGemini: mock(() => Promise.resolve({ content: '' })),
  callGeminiStream: mock(() => Promise.resolve(new ReadableStream())),
  callOllama: mock(() => Promise.resolve({ content: '' })),
  callOllamaStream: mock(() => Promise.resolve(new ReadableStream())),
  checkOllamaConnection: mock(() => Promise.resolve(false)),
  getAuxAiMode: mock(() => 'cli'),
  sendAIMessage: mockSendAIMessage,
  sendAIMessageStream: mock(() => Promise.resolve(new ReadableStream())),
}));

const { deriveTaskSpec, generateIntakeQuestions, generateIntakeGoalOptions } =
  await import('./task-spec-deriver');

beforeEach(() => {
  mockSendAIMessage.mockReset();
  mockSendAIMessage.mockResolvedValue({ content: '{}' });
  mockGetDefaultProvider.mockReset();
  mockGetDefaultProvider.mockResolvedValue('claude');
  mockIsAnyApiKeyConfigured.mockReset();
  mockIsAnyApiKeyConfigured.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// deriveTaskSpec
// ---------------------------------------------------------------------------
describe('deriveTaskSpec', () => {
  test('空文字の説明 → source=empty を返し AI を呼ばないこと', async () => {
    const result = await deriveTaskSpec('');
    expect(result).toEqual({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'empty',
    });
    expect(mockIsAnyApiKeyConfigured).not.toHaveBeenCalled();
  });

  test('空白のみの説明 → source=empty を返すこと', async () => {
    const result = await deriveTaskSpec('   \n\t  ');
    expect(result.source).toBe('empty');
  });

  test('APIキー未設定 → source=no_ai を返し AI を呼ばないこと', async () => {
    mockIsAnyApiKeyConfigured.mockResolvedValueOnce(false);

    const result = await deriveTaskSpec('タスクの説明');

    expect(result).toEqual({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'no_ai',
    });
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('AI が有効なJSONを返した場合 → 抽出結果を返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        goals: ['ゴール1', 'ゴール2'],
        constraints: ['制約1'],
        acceptanceCriteria: ['基準1'],
      }),
    });

    const result = await deriveTaskSpec('タスクの説明');

    expect(result).toEqual({
      spec: {
        goals: ['ゴール1', 'ゴール2'],
        constraints: ['制約1'],
        acceptanceCriteria: ['基準1'],
      },
      source: 'ai',
    });
  });

  test('AI 呼び出しに provider/systemPrompt/description が渡されること', async () => {
    mockGetDefaultProvider.mockResolvedValueOnce('gemini');

    await deriveTaskSpec('  トリムされる説明  ');

    expect(mockGetDefaultProvider).toHaveBeenCalledTimes(1);
    const callArgs = mockSendAIMessage.mock.calls[0][0] as {
      provider: string;
      messages: { role: string; content: string }[];
      systemPrompt: string;
      maxTokens: number;
    };
    expect(callArgs.provider).toBe('gemini');
    expect(callArgs.messages[0].content).toBe('トリムされる説明');
    expect(callArgs.systemPrompt).toContain('goals');
    expect(callArgs.maxTokens).toBe(1024);
  });

  test('AI の応答にJSONが含まれない場合 → source=ai だが空specを返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'すみません、わかりません' });

    const result = await deriveTaskSpec('タスクの説明');

    expect(result).toEqual({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'ai',
    });
  });

  test('AI の応答が不正なJSONの場合 → source=ai だが空specを返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: '{goals: [unquoted]}' });

    const result = await deriveTaskSpec('タスクの説明');

    expect(result.source).toBe('ai');
    expect(result.spec).toEqual({ goals: [], constraints: [], acceptanceCriteria: [] });
  });

  test('AI 呼び出しが例外を投げた場合 → source=ai_error を返すこと', async () => {
    mockSendAIMessage.mockRejectedValueOnce(new Error('API down'));

    const result = await deriveTaskSpec('タスクの説明');

    expect(result).toEqual({
      spec: { goals: [], constraints: [], acceptanceCriteria: [] },
      source: 'ai_error',
    });
  });

  test('goals/constraints/acceptanceCriteria の非文字列・空白のみ要素はフィルタされること', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        goals: ['有効', 42, '', '   ', null, '  トリム対象  '],
        constraints: 'not-an-array',
        acceptanceCriteria: [],
      }),
    });

    const result = await deriveTaskSpec('説明');

    expect(result.spec.goals).toEqual(['有効', 'トリム対象']);
    expect(result.spec.constraints).toEqual([]);
    expect(result.spec.acceptanceCriteria).toEqual([]);
  });

  test('7件以上の配列は先頭6件に切り詰められること', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `項目${i}`);
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({ goals: many, constraints: [], acceptanceCriteria: [] }),
    });

    const result = await deriveTaskSpec('説明');

    expect(result.spec.goals).toHaveLength(6);
    expect(result.spec.goals).toEqual(many.slice(0, 6));
  });
});

// ---------------------------------------------------------------------------
// generateIntakeQuestions
// ---------------------------------------------------------------------------
describe('generateIntakeQuestions', () => {
  test('missingFields が空の場合 → [] を返し AI 設定チェックすら行わないこと', async () => {
    const result = await generateIntakeQuestions('title', 'desc', []);

    expect(result).toEqual([]);
    expect(mockIsAnyApiKeyConfigured).not.toHaveBeenCalled();
  });

  test('APIキー未設定の場合 → [] を返すこと', async () => {
    mockIsAnyApiKeyConfigured.mockResolvedValueOnce(false);

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result).toEqual([]);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('AI が有効なJSONを返した場合 → IntakeQuestion 配列を返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        questions: [
          { field: 'goals', question: '何を達成したいですか？', options: ['A', 'B'] },
          { field: 'constraints', question: '制約は？', options: ['C', 'D', 'E'] },
        ],
      }),
    });

    const result = await generateIntakeQuestions('title', 'desc', ['goals', 'constraints']);

    expect(result).toEqual([
      { field: 'goals', question: '何を達成したいですか？', options: ['A', 'B'] },
      { field: 'constraints', question: '制約は？', options: ['C', 'D', 'E'] },
    ]);
  });

  test('question が空文字の項目は除外されること', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        questions: [
          { field: 'goals', question: '  ', options: ['A'] },
          { field: 'goals', question: '有効な質問', options: ['A'] },
        ],
      }),
    });

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result).toEqual([{ field: 'goals', question: '有効な質問', options: ['A'] }]);
  });

  test('field が文字列でない場合 → goals にフォールバックすること', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        questions: [{ field: 123, question: '質問', options: [] }],
      }),
    });

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result[0].field).toBe('goals');
  });

  test('options は4件までに切り詰められること', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({
        questions: [{ field: 'goals', question: '質問', options: ['1', '2', '3', '4', '5'] }],
      }),
    });

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result[0].options).toEqual(['1', '2', '3', '4']);
  });

  test('questions が5件以上の場合 → 4件までに切り詰められること', async () => {
    const questions = Array.from({ length: 6 }, (_, i) => ({
      field: 'goals',
      question: `質問${i}`,
      options: [],
    }));
    mockSendAIMessage.mockResolvedValueOnce({ content: JSON.stringify({ questions }) });

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result).toHaveLength(4);
  });

  test('AI 応答にJSONが含まれない場合 → [] を返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'no json here' });

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result).toEqual([]);
  });

  test('parsed.questions が配列でない場合 → [] を返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: JSON.stringify({ questions: 'x' }) });

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result).toEqual([]);
  });

  test('AI 呼び出しが例外を投げた場合 → [] を返すこと', async () => {
    mockSendAIMessage.mockRejectedValueOnce(new Error('API down'));

    const result = await generateIntakeQuestions('title', 'desc', ['goals']);

    expect(result).toEqual([]);
  });

  test('description が空文字の場合 → basis に "(説明なし)" が含まれること', async () => {
    await generateIntakeQuestions('title', '', ['goals']);

    const callArgs = mockSendAIMessage.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(callArgs.messages[0].content).toContain('(説明なし)');
  });
});

// ---------------------------------------------------------------------------
// generateIntakeGoalOptions
// ---------------------------------------------------------------------------
describe('generateIntakeGoalOptions', () => {
  test('APIキー未設定の場合 → [] を返すこと', async () => {
    mockIsAnyApiKeyConfigured.mockResolvedValueOnce(false);

    const result = await generateIntakeGoalOptions('title', 'desc');

    expect(result).toEqual([]);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('AI が有効なJSONを返した場合 → options を返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({ options: ['方向性A', '方向性B'] }),
    });

    const result = await generateIntakeGoalOptions('title', 'desc');

    expect(result).toEqual(['方向性A', '方向性B']);
  });

  test('options が5件以上の場合 → 4件までに切り詰められること', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: JSON.stringify({ options: ['1', '2', '3', '4', '5'] }),
    });

    const result = await generateIntakeGoalOptions('title', 'desc');

    expect(result).toEqual(['1', '2', '3', '4']);
  });

  test('AI 応答にJSONが含まれない場合 → [] を返すこと', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'no json' });

    const result = await generateIntakeGoalOptions('title', 'desc');

    expect(result).toEqual([]);
  });

  test('AI 呼び出しが例外を投げた場合 → [] を返すこと', async () => {
    mockSendAIMessage.mockRejectedValueOnce(new Error('API down'));

    const result = await generateIntakeGoalOptions('title', 'desc');

    expect(result).toEqual([]);
  });

  test('description が undefined でも "(説明なし)" を含めて呼び出せること', async () => {
    await generateIntakeGoalOptions('title', undefined as unknown as string);

    const callArgs = mockSendAIMessage.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    expect(callArgs.messages[0].content).toContain('(説明なし)');
  });
});
