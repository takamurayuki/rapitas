/**
 * Task Suggestion Routes テスト
 * 検索・頻度/AI/知識/統合サジェスト・AIキャッシュ取得/削除のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

interface TaskSuggestionCacheMock {
  findMany: ReturnType<typeof mock>;
  deleteMany: ReturnType<typeof mock>;
}

const mockPrisma: {
  task: { findMany: ReturnType<typeof mock> };
  taskSuggestionCache: TaskSuggestionCacheMock | undefined;
} = {
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  taskSuggestionCache: {
    findMany: mock(() => Promise.resolve([])),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
};

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
  getBackendLogFilePath: () => 'backend-test.log',
}));
mock.module('../../../services/task/task-service', () => ({
  getFrequencyBasedSuggestions: mock(() => Promise.resolve([])),
  generateAISuggestions: mock(() => Promise.resolve({ suggestions: [], source: 'ai' })),
}));
mock.module('../../../services/task/task-knowledge-suggestions', () => ({
  getKnowledgeBasedSuggestions: mock(() => Promise.resolve([])),
}));
mock.module('../../../services/task/task-unified-suggestions', () => ({
  getUnifiedSuggestions: mock(() => Promise.resolve([])),
}));

const { taskSuggestionRoutes } = await import('../../../routes/tasks/task-suggestions');
const { getFrequencyBasedSuggestions, generateAISuggestions } =
  await import('../../../services/task/task-service');
const { getKnowledgeBasedSuggestions } =
  await import('../../../services/task/task-knowledge-suggestions');
const { getUnifiedSuggestions } = await import('../../../services/task/task-unified-suggestions');

function resetAllMocks() {
  mockPrisma.task.findMany.mockReset();
  mockPrisma.taskSuggestionCache = {
    findMany: mock(() => Promise.resolve([])),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  };
  (getFrequencyBasedSuggestions as ReturnType<typeof mock>).mockReset();
  (getFrequencyBasedSuggestions as ReturnType<typeof mock>).mockResolvedValue([]);
  (generateAISuggestions as ReturnType<typeof mock>).mockReset();
  (generateAISuggestions as ReturnType<typeof mock>).mockResolvedValue({
    suggestions: [],
    source: 'ai',
  });
  (getKnowledgeBasedSuggestions as ReturnType<typeof mock>).mockReset();
  (getKnowledgeBasedSuggestions as ReturnType<typeof mock>).mockResolvedValue([]);
  (getUnifiedSuggestions as ReturnType<typeof mock>).mockReset();
  (getUnifiedSuggestions as ReturnType<typeof mock>).mockResolvedValue([]);
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') {
        set.status = 422;
        return { error: 'Validation error' };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Server error' };
    })
    .use(taskSuggestionRoutes);
}

describe('GET /tasks/search', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('空クエリで空配列を返しPrismaを呼ばないこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/search?q='));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  test('単語検索でタイトル一致条件を組み立てること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 1, title: 'Test Task' }]);

    const res = await app.handle(new Request('http://localhost/tasks/search?q=Test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([{ id: 1, title: 'Test Task' }]);
    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { AND: { OR: { title?: { contains: string } } }[] };
    };
    expect(call.where.AND[0]!.OR[0]!.title?.contains).toBe('Test');
  });

  test('searchDescription=trueで説明文条件も追加すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks/search?q=foo&searchDescription=true'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { AND: { OR: unknown[] }[] };
    };
    expect(call.where.AND[0]!.OR.length).toBe(2);
  });

  test('themeId・projectId・statusフィルタを適用すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(
      new Request('http://localhost/tasks/search?q=foo&themeId=3&projectId=7&status=todo,blocked'),
    );

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { themeId?: number; projectId?: number; status?: { in: string[] } };
    };
    expect(call.where.themeId).toBe(3);
    expect(call.where.projectId).toBe(7);
    expect(call.where.status?.in).toEqual(['todo', 'blocked']);
  });

  test('複数単語クエリを関連度スコアで並び替えること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 1, title: 'irrelevant', description: null },
      { id: 2, title: 'foo bar exact match', description: null },
    ]);

    const res = await app.handle(new Request('http://localhost/tasks/search?q=foo%20bar'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].id).toBe(2);
    expect(body[0].relevanceScore).toBeUndefined();
  });

  test('limitパラメータを20件で上限にすること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks/search?q=foo&limit=1000'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as { take: number };
    expect(call.take).toBe(20);
  });
});

describe('GET /tasks/suggestions/unified', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeId無しで空のsuggestionsを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/suggestions/unified'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
    expect(getUnifiedSuggestions).not.toHaveBeenCalled();
  });

  test('themeId指定でgetUnifiedSuggestionsを呼び出すこと', async () => {
    (getUnifiedSuggestions as ReturnType<typeof mock>).mockResolvedValue([
      { title: 'Suggested Task' },
    ]);

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/unified?themeId=2&limit=5'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.suggestions).toEqual([{ title: 'Suggested Task' }]);
    expect(getUnifiedSuggestions).toHaveBeenCalledWith(mockPrisma, 2, 5);
  });

  test('limit未指定時は既定値8を使うこと', async () => {
    await app.handle(new Request('http://localhost/tasks/suggestions/unified?themeId=2'));

    expect(getUnifiedSuggestions).toHaveBeenCalledWith(mockPrisma, 2, 8);
  });
});

describe('GET /tasks/suggestions', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeId無しで空のsuggestionsを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/suggestions'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
    expect(getFrequencyBasedSuggestions).not.toHaveBeenCalled();
  });

  test('themeId指定で頻度ベースサジェストを返すこと', async () => {
    (getFrequencyBasedSuggestions as ReturnType<typeof mock>).mockResolvedValue([
      { title: 'Frequent Task' },
    ]);

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions?themeId=4&limit=100'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.suggestions).toEqual([{ title: 'Frequent Task' }]);
    // limit is capped at 20
    expect(getFrequencyBasedSuggestions).toHaveBeenCalledWith(mockPrisma, 4, 20);
  });
});

describe('GET /tasks/suggestions/knowledge', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeId無しで空のsuggestionsを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/suggestions/knowledge'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [] });
    expect(getKnowledgeBasedSuggestions).not.toHaveBeenCalled();
  });

  test('themeId指定で知識ベースサジェストを返すこと', async () => {
    (getKnowledgeBasedSuggestions as ReturnType<typeof mock>).mockResolvedValue([
      { title: 'Knowledge Task' },
    ]);

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/knowledge?themeId=6'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.suggestions).toEqual([{ title: 'Knowledge Task' }]);
    expect(getKnowledgeBasedSuggestions).toHaveBeenCalledWith(mockPrisma, 6, 5);
  });
});

describe('GET /tasks/suggestions/ai', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeId無しでnoneソースを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/suggestions/ai'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [], source: 'none' });
    expect(generateAISuggestions).not.toHaveBeenCalled();
  });

  test('themeId指定でAIサジェストを生成すること', async () => {
    (generateAISuggestions as ReturnType<typeof mock>).mockResolvedValue({
      suggestions: [{ title: 'AI Task' }],
      source: 'ai',
    });

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai?themeId=1&limit=50'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.suggestions).toEqual([{ title: 'AI Task' }]);
    // limit is capped at 10
    expect(generateAISuggestions).toHaveBeenCalledWith(mockPrisma, 1, 10);
  });

  test('AIサービスがエラーを投げた場合は500を返すこと', async () => {
    (generateAISuggestions as ReturnType<typeof mock>).mockRejectedValue(
      new Error('AI provider unavailable'),
    );

    const res = await app.handle(new Request('http://localhost/tasks/suggestions/ai?themeId=1'));

    expect(res.status).toBe(500);
  });
});

describe('GET /tasks/suggestions/ai/cache', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeId無しでnoneソースを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/suggestions/ai/cache'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [], analysis: null, source: 'none' });
  });

  test('taskSuggestionCacheモデルが無い場合noneソースを返すこと', async () => {
    mockPrisma.taskSuggestionCache = undefined;

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai/cache?themeId=1'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [], analysis: null, source: 'none' });
  });

  test('キャッシュが空ならnoneソースを返すこと', async () => {
    mockPrisma.taskSuggestionCache!.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai/cache?themeId=1'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('none');
  });

  test('キャッシュ済みサジェストをパースして返すこと', async () => {
    mockPrisma.taskSuggestionCache!.findMany.mockResolvedValue([
      {
        title: 'Cached Task',
        description: 'desc',
        priority: 'high',
        estimatedHours: 3,
        reason: 'reason',
        category: 'dev',
        labelIds: '[1,2]',
        analysis: 'summary',
        completionCriteria: null,
        measurableOutcome: null,
        dependencies: null,
        suggestedApproach: null,
      },
    ]);

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai/cache?themeId=1'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('cache');
    expect(body.analysis).toBe('summary');
    expect(body.suggestions[0].title).toBe('Cached Task');
    expect(body.suggestions[0].labelIds).toEqual([1, 2]);
    expect(body.suggestions[0].frequency).toBe(0);
  });
});

describe('DELETE /tasks/suggestions/ai/cache', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('themeId無しで失敗レスポンスを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai/cache', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toBe('themeId is required');
  });

  test('taskSuggestionCacheモデルが無い場合失敗レスポンスを返すこと', async () => {
    mockPrisma.taskSuggestionCache = undefined;

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai/cache?themeId=1', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
  });

  test('themeIdのキャッシュを削除して件数を返すこと', async () => {
    mockPrisma.taskSuggestionCache!.deleteMany.mockResolvedValue({ count: 3 });

    const res = await app.handle(
      new Request('http://localhost/tasks/suggestions/ai/cache?themeId=1', { method: 'DELETE' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(3);
    expect(mockPrisma.taskSuggestionCache!.deleteMany).toHaveBeenCalledWith({
      where: { themeId: 1 },
    });
  });
});
