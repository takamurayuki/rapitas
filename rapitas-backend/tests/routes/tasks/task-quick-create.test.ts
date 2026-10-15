/**
 * Task Quick-Create Route テスト
 * NL解析→AIタイトル→タスク作成→複雑度分析→サブタスク生成→実行手順のNDJSONパイプラインのテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    update: mock(() => Promise.resolve({})),
  },
};

const mockCreateTask = mock(() => Promise.resolve({ id: 1, title: 'Task' }));
const mockParseNaturalLanguageTask = mock(() => ({ title: 'Parsed Title' }));
const mockAnalyzeTask = mock(() =>
  Promise.resolve({
    result: { suggestedSubtasks: [] as unknown[] },
    tokensUsed: 0,
  }),
);
const mockGenerateExecutionInstructions = mock(() =>
  Promise.resolve({ instructions: '', tokensUsed: 0 }),
);
const mockAnalyzeTaskComplexity = mock(() => ({ complexityScore: 0 }));
const mockGetDefaultProvider = mock(() => Promise.resolve('claude'));
const mockGenerateTaskTitle = mock(() => Promise.resolve({ title: '' }));

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    child: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
  },
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../../services/task/task-service', () => ({
  TASK_FULL_INCLUDE: {},
  createTask: mockCreateTask,
  updateTask: mock(() => Promise.resolve({})),
  getFrequencyBasedSuggestions: mock(() => Promise.resolve([])),
  generateAISuggestions: mock(() => Promise.resolve([])),
  cleanupDuplicateSubtasks: mock(() => Promise.resolve(0)),
  cleanupAllDuplicateSubtasks: mock(() => Promise.resolve(0)),
  attachBlockedCauses: mock(() => Promise.resolve([])),
}));
mock.module('../../../services/ai/natural-language-parser', () => ({
  parseNaturalLanguageTask: mockParseNaturalLanguageTask,
}));
mock.module('../../../services/claude-agent/task-analyzer', () => ({
  analyzeTask: mockAnalyzeTask,
  generateExecutionInstructions: mockGenerateExecutionInstructions,
}));
mock.module('../../../services/workflow/complexity-analyzer', () => ({
  analyzeKeywords: mock(() => ({})),
  analyzeEstimatedTime: mock(() => ({})),
  analyzePriority: mock(() => ({})),
  analyzeLabels: mock(() => ({})),
  analyzeScope: mock(() => ({})),
  getRecommendedMode: mock(() => 'manual'),
  calculateEstimatedExecutionTime: mock(() => 0),
  calculateConfidence: mock(() => 0),
  analyzeTaskComplexity: mockAnalyzeTaskComplexity,
  analyzeBatchComplexity: mock(() => []),
  getWorkflowModeConfig: mock(() => ({})),
  analyzeTaskComplexityWithLearning: mock(() =>
    Promise.resolve({ complexity: 'low', suggestedMode: 'manual', confidence: 90, factors: [] }),
  ),
}));
mock.module('../../../utils/ai-client', () => ({
  PROVIDER_NAMES: {},
  isValidApiKeyFormat: mock(() => true),
  getApiKeyForProvider: mock(() => undefined),
  getDefaultModel: mock(() => 'default'),
  getDefaultProvider: mockGetDefaultProvider,
  isAnyApiKeyConfigured: mock(() => Promise.resolve(false)),
  getConfiguredProviders: mock(() => []),
  getOllamaUrl: mock(() => 'http://localhost:11434'),
  formatApiError: mock(() => ''),
  handleApiError: mock(() => {}),
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
  getAuxAiMode: mock(() => 'off'),
  sendAIMessage: mock(() => Promise.resolve({ content: '{}', tokensUsed: 0 })),
  sendAIMessageStream: mock(() => Promise.resolve(new ReadableStream())),
}));
mock.module('../../../services/claude-agent/naming-service', () => ({
  cleanGeneratedTitle: mock((s: string) => s),
  generateBranchName: mock(() => Promise.resolve({ branchName: 'feature/test' })),
  generateTaskTitle: mockGenerateTaskTitle,
}));

const { taskQuickCreateRoutes } = await import('../../../routes/tasks/task-quick-create');
const { AppError } = await import('../../../middleware/error-handler');

function resetAllMocks() {
  mockPrisma.task.update.mockReset();
  mockPrisma.task.update.mockResolvedValue({});
  mockCreateTask.mockReset();
  mockCreateTask.mockResolvedValue({ id: 1, title: 'Task' });
  mockParseNaturalLanguageTask.mockReset();
  mockParseNaturalLanguageTask.mockReturnValue({ title: 'Parsed Title' });
  mockAnalyzeTask.mockReset();
  mockAnalyzeTask.mockResolvedValue({ result: { suggestedSubtasks: [] }, tokensUsed: 0 });
  mockGenerateExecutionInstructions.mockReset();
  mockGenerateExecutionInstructions.mockResolvedValue({ instructions: '', tokensUsed: 0 });
  mockAnalyzeTaskComplexity.mockReset();
  mockAnalyzeTaskComplexity.mockReturnValue({ complexityScore: 0 });
  mockGetDefaultProvider.mockReset();
  mockGetDefaultProvider.mockResolvedValue('claude');
  mockGenerateTaskTitle.mockReset();
  mockGenerateTaskTitle.mockResolvedValue({ title: '' });
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
      }
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    })
    .use(taskQuickCreateRoutes);
}

/** Reads an NDJSON stream response and returns the parsed line objects in order. */
async function readNdjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('POST /tasks/quick-create', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('パイプライン全体が正常に完了すること', async () => {
    mockParseNaturalLanguageTask.mockReturnValue({
      title: 'Parsed Title',
      priority: 'high',
      estimatedHours: 2,
    });
    mockGenerateTaskTitle.mockResolvedValue({ title: 'AI Title' });
    mockCreateTask.mockImplementation((_prisma: unknown, input: { parentId?: number }) =>
      Promise.resolve(
        input.parentId
          ? { id: 2, title: 'Sub1', parentId: input.parentId }
          : { id: 1, title: 'AI Title', description: null, priority: 'high', themeId: null },
      ),
    );
    mockAnalyzeTaskComplexity.mockReturnValue({ complexityScore: 42 });
    mockAnalyzeTask.mockResolvedValue({
      result: {
        suggestedSubtasks: [{ title: 'Sub1', description: 'do it', priority: 'medium' }],
      },
      tokensUsed: 10,
    });
    mockGenerateExecutionInstructions.mockResolvedValue({
      instructions: '1. Do X',
      tokensUsed: 5,
    });

    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'レポート提出 重要 2時間' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson');

    const lines = await readNdjson(res);
    const steps = lines.map((l) => l.step);
    expect(steps).toEqual([
      'parsing',
      'parsing',
      'summarizing',
      'summarizing',
      'creating',
      'creating',
      'analyzing',
      'analyzing',
      'generating_subtasks',
      'generating_subtasks',
      'generating_instructions',
      'generating_instructions',
      'complete',
    ]);

    const summarizingDone = lines.find((l) => l.step === 'summarizing' && l.status === 'done');
    expect((summarizingDone?.data as { title: string }).title).toBe('AI Title');

    const analyzingDone = lines.find((l) => l.step === 'analyzing' && l.status === 'done');
    expect((analyzingDone?.data as { score: number }).score).toBe(42);
    expect((analyzingDone?.data as { subtaskCount: number }).subtaskCount).toBe(1);

    const complete = lines[lines.length - 1];
    expect(complete?.status).toBe('done');
    expect(complete?.taskId).toBe(1);

    expect(mockCreateTask).toHaveBeenCalledTimes(2);
    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
  });

  test('AIタイトル生成が失敗した場合、パースされたタイトルにフォールバックすること', async () => {
    mockParseNaturalLanguageTask.mockReturnValue({ title: 'Fallback Title' });
    mockGenerateTaskTitle.mockImplementation(() => Promise.reject(new Error('AI down')));
    mockCreateTask.mockResolvedValue({ id: 3, title: 'Fallback Title' });

    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'テストタスク' }),
      }),
    );

    const lines = await readNdjson(res);
    const summarizingDone = lines.find((l) => l.step === 'summarizing' && l.status === 'done');
    expect((summarizingDone?.data as { title: string }).title).toBe('Fallback Title');

    const errorStep = lines.find((l) => l.step === 'error');
    expect(errorStep).toBeUndefined();
  });

  test('タスク作成に失敗した場合、エラーステップを送信すること', async () => {
    mockCreateTask.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'テストタスク' }),
      }),
    );

    expect(res.status).toBe(200);
    const lines = await readNdjson(res);
    const last = lines[lines.length - 1];
    expect(last?.step).toBe('error');
    expect(last?.status).toBe('error');
    expect(last?.message).toBe('Failed to create task');
  });

  test('複雑度分析中に例外が発生した場合、エラーステップを送信すること', async () => {
    mockCreateTask.mockResolvedValue({ id: 4, title: 'Task', themeId: null });
    mockAnalyzeTask.mockImplementation(() => Promise.reject(new Error('AI API error')));

    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'テストタスク' }),
      }),
    );

    const lines = await readNdjson(res);
    const last = lines[lines.length - 1];
    expect(last?.step).toBe('error');
    expect(last?.message).toBe('AI API error');

    const steps = lines.map((l) => l.step);
    expect(steps).not.toContain('generating_subtasks');
  });

  test('themeIdをタスク作成とサブタスク作成の両方に伝播すること', async () => {
    mockCreateTask.mockImplementation((_prisma: unknown, input: { parentId?: number }) =>
      Promise.resolve(
        input.parentId ? { id: 20, parentId: input.parentId } : { id: 10, themeId: 7 },
      ),
    );
    mockAnalyzeTask.mockResolvedValue({
      result: { suggestedSubtasks: [{ title: 'Sub', description: 'd' }] },
      tokensUsed: 0,
    });

    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'テストタスク', themeId: 7 }),
      }),
    );
    // Consume the NDJSON stream so the async pipeline inside it fully runs
    // before asserting on mock call counts (handle() resolves as soon as
    // headers are ready, not once the stream body finishes).
    await res.text();

    const parentCallInput = mockCreateTask.mock.calls[0]![1] as { themeId?: number };
    expect(parentCallInput.themeId).toBe(7);

    const subtaskCallInput = mockCreateTask.mock.calls[1]![1] as { themeId?: number };
    expect(subtaskCallInput.themeId).toBe(7);
  });

  test('textが空文字の場合バリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      }),
    );

    expect(res.status).toBe(422);
  });

  test('textが欠けている場合バリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/quick-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});
