/**
 * Task Routes テスト
 * タスクCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
    count: mock(() => Promise.resolve(0)),
  },
  taskLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
  },
  studyStreak: {
    upsert: mock(() => Promise.resolve({})),
  },
  taskSuggestionCache: {
    findMany: mock(() => Promise.resolve([])),
    deleteMany: mock(() => Promise.resolve({ count: 0 })),
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  theme: {
    findUnique: mock(() => Promise.resolve(null)),
  },
  taskPattern: {
    findMany: mock(() => Promise.resolve([])),
  },
  userBehaviorSummary: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  activityLog: {
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  notification: {
    create: mock(() => Promise.resolve({ id: 1 })),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  workflowTransition: {
    findMany: mock(() => Promise.resolve([])),
  },
  agentExecution: {
    findMany: mock(() => Promise.resolve([])),
  },
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
};

mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../services/achievement-checker', () => ({
  checkAchievements: mock(() => Promise.resolve()),
}));
mock.module('../../../services/communication/notification-service', () => ({
  createNotification: mock(() => Promise.resolve({ id: 1 })),
  notifyTaskCompleted: mock(() => Promise.resolve()),
  notifyAgentExecutionCompleted: mock(() => Promise.resolve()),
  notifyApprovalRequested: mock(() => Promise.resolve()),
  AUTH_FAILURE_NOTIFICATION_TITLE: 'Claude 認証切れ',
  notifyAuthenticationFailure: mock(() => Promise.resolve()),
  notifyPomodoroCompleted: mock(() => Promise.resolve()),
}));
mock.module('../../../src/services/user-behavior-service', () => ({
  UserBehaviorService: {
    recordTaskCreated: mock(() => Promise.resolve()),
    recordTaskStarted: mock(() => Promise.resolve()),
    recordTaskCompleted: mock(() => Promise.resolve()),
    recordBehavior: mock(() => Promise.resolve()),
  },
}));
mock.module('../../../services/scheduling/recurring-task-service', () => ({
  onGeneratedTaskCompleted: mock(() => Promise.resolve()),
}));
mock.module('../../../services/communication/realtime-service', () => ({
  realtimeService: {
    sendTaskUpdate: mock(() => {}),
    notifyTaskUpdate: mock(() => {}),
    notifyTaskCreated: mock(() => {}),
    notifyTaskDeleted: mock(() => {}),
  },
}));
mock.module('../../../services/scheduling/task-calendar-sync', () => ({
  syncTaskToCalendar: mock(() => Promise.resolve()),
}));
mock.module('../../../services/workflow/complexity-analyzer', () => ({
  analyzeTaskComplexityWithLearning: mock(() =>
    Promise.resolve({
      complexity: 'low',
      suggestedMode: 'manual',
      confidence: 90,
      factors: [],
    }),
  ),
}));
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: mock(() => Promise.resolve({ content: '{}', tokensUsed: 0 })),
  getDefaultProvider: mock(() => Promise.resolve('openai')),
  isAnyApiKeyConfigured: mock(() => Promise.resolve(false)),
}));
mock.module('../../../routes/agents/approvals', () => ({
  orchestrator: { execute: mock(() => Promise.resolve()) },
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
}));

const { tasksRoutes } = await import('../../../routes/tasks/tasks');
const { taskSuggestionRoutes } = await import('../../../routes/tasks/task-suggestions');
const { AppError } = await import('../../../middleware/error-handler');

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'object' && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === 'function' && 'mockReset' in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  // Restore default for $transaction
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockPrisma),
  );
  // createTask chains `notification.create(...).catch(...)`; a reset
  // (undefined-returning) mock would throw on `.catch` of undefined → 500.
  mockPrisma.notification.create.mockResolvedValue({ id: 1 });
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
    .use(tasksRoutes)
    .use(taskSuggestionRoutes);
}

describe('GET /tasks', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('全タスクを返すこと', async () => {
    const tasks = [
      { id: 1, title: 'Task 1', status: 'todo', parentId: null },
      { id: 2, title: 'Task 2', status: 'done', parentId: null },
    ];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(new Request('http://localhost/tasks'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(tasks);
  });

  test('projectIdフィルタを適用すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks?projectId=5'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { projectId?: number };
    };
    expect(call.where.projectId).toBe(5);
  });

  test('sinceパラメータでincremental fetchすること', async () => {
    const since = '2026-03-01T00:00:00.000Z';
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.count.mockResolvedValue(10);

    const res = await app.handle(new Request(`http://localhost/tasks?since=${since}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.incremental).toBe(true);
    expect(body.totalCount).toBe(10);
    expect(body.since).toBe(since);
  });

  test('不正なsinceパラメータで400を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks?since=invalid'));
    expect(res.status).toBe(400);
  });

  test('blockedタスクにWorkflowTransitionの最新causeを1クエリで付与すること', async () => {
    const tasks = [
      { id: 1, title: 'Task 1', status: 'todo', parentId: null },
      { id: 2, title: 'Task 2', status: 'blocked', parentId: null },
    ];
    mockPrisma.task.findMany.mockResolvedValue(tasks);
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { taskId: 2, cause: 'verify_pr_not_created' },
    ]);

    const res = await app.handle(new Request('http://localhost/tasks'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.workflowTransition.findMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.workflowTransition.findMany.mock.calls[0]![0] as {
      where: { taskId: { in: number[] } };
    };
    expect(call.where.taskId.in).toEqual([2]);
    expect(body[0].blockedCause).toBeUndefined();
    expect(body[1].blockedCause).toBe('verify_pr_not_created');
  });

  test('blockedタスクが無ければWorkflowTransitionへ問い合わせないこと', async () => {
    const tasks = [{ id: 1, title: 'Task 1', status: 'todo', parentId: null }];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    await app.handle(new Request('http://localhost/tasks'));

    expect(mockPrisma.workflowTransition.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /tasks/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('IDでタスクを取得すること', async () => {
    const task = {
      id: 1,
      title: 'Test Task',
      status: 'todo',
      subtasks: [],
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [],
    };
    mockPrisma.task.findUnique.mockResolvedValue(task);

    const res = await app.handle(new Request('http://localhost/tasks/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.title).toBe('Test Task');
  });

  test('無効なIDでValidationErrorを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/abc'));
    expect(res.status).toBe(400);
  });

  test('activeTimeMs / wallClockMs / phaseBreakdown を実行行の集計から付与すること', async () => {
    const task = { id: 1, title: 'Test Task', status: 'in-progress', subtasks: [] };
    mockPrisma.task.findUnique.mockResolvedValue(task);
    const t0 = new Date('2026-08-12T00:00:00.000Z').getTime();
    mockPrisma.agentExecution.findMany.mockResolvedValue([
      {
        startedAt: new Date(t0),
        completedAt: new Date(t0 + 10 * 60_000),
        status: 'completed',
        session: { mode: 'workflow-researcher' },
      },
      {
        startedAt: new Date(t0 + 12 * 60_000),
        completedAt: new Date(t0 + 42 * 60_000),
        status: 'completed',
        session: { mode: 'workflow-implementer' },
      },
    ]);

    const res = await app.handle(new Request('http://localhost/tasks/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    // 既存フィールドは不変（後方互換）
    expect(body.id).toBe(1);
    expect(body.title).toBe('Test Task');
    // 追加フィールド: 全完了実行の (completedAt - startedAt) 合計
    expect(body.activeTimeMs).toBe(40 * 60_000);
    expect(body.wallClockMs).toBe(42 * 60_000);
    expect(body.phaseBreakdown).toEqual([
      { role: 'researcher', execCount: 1, activeTimeMs: 10 * 60_000 },
      { role: 'implementer', execCount: 1, activeTimeMs: 30 * 60_000 },
    ]);
  });

  test('集計が失敗してもタスク本体は返すこと（best-effort）', async () => {
    const task = { id: 1, title: 'Test Task', status: 'todo', subtasks: [] };
    mockPrisma.task.findUnique.mockResolvedValue(task);
    mockPrisma.agentExecution.findMany.mockRejectedValue(new Error('DB down'));

    const res = await app.handle(new Request('http://localhost/tasks/1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.activeTimeMs).toBeUndefined();
  });
});

describe('POST /tasks', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('基本的なタスクを作成すること', async () => {
    const created = { id: 1, title: 'New Task', status: 'todo' };
    mockPrisma.task.create.mockResolvedValue(created);
    mockPrisma.task.findUnique.mockResolvedValue({
      ...created,
      subtasks: [],
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [],
      themeId: null,
      parentId: null,
    });

    const res = await app.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Task' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('New Task');
    expect(mockPrisma.task.create).toHaveBeenCalledTimes(1);
  });

  test('labelIds付きでタスクを作成すること', async () => {
    const created = { id: 1, title: 'Labeled Task' };
    mockPrisma.task.create.mockResolvedValue(created);
    mockPrisma.task.findUnique.mockResolvedValue({
      ...created,
      subtasks: [],
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [{ labelId: 1, label: { id: 1, name: 'Bug' } }],
      themeId: null,
      parentId: null,
    });

    const res = await app.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Labeled Task', labelIds: [1, 2] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.taskLabel.createMany).toHaveBeenCalledTimes(1);
    const labelCall = mockPrisma.taskLabel.createMany.mock.calls[0]![0] as {
      data: { taskId: number; labelId: number }[];
    };
    expect(labelCall.data.length).toBe(2);
  });

  test('サブタスク作成時にトランザクションを使用すること', async () => {
    const parent = { id: 10 };
    const subtask = {
      id: 11,
      title: 'Subtask',
      parentId: 10,
      subtasks: [],
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [],
    };
    mockPrisma.task.findUnique.mockResolvedValue(parent);
    mockPrisma.task.findFirst.mockResolvedValue(null); // no duplicate
    mockPrisma.task.create.mockResolvedValue({ id: 11 });
    // For the findUnique inside transaction (created task fetch)
    mockPrisma.task.findUnique
      .mockResolvedValueOnce(parent) // parent check
      .mockResolvedValueOnce(subtask); // created subtask fetch

    const res = await app.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Subtask', parentId: 10 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test('タイトルなしでバリデーションエラーを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe('PATCH /tasks/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('タスクのタイトルを更新すること', async () => {
    const current = { status: 'todo', parentId: null };
    const updated = {
      id: 1,
      title: 'Updated',
      status: 'todo',
      themeId: null,
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [],
    };
    mockPrisma.task.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    mockPrisma.task.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/tasks/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Updated');
  });

  test('ステータスをdoneに変更時にstudyStreakをupsertすること', async () => {
    const current = { status: 'in_progress', parentId: null };
    const updated = {
      id: 1,
      title: 'Task',
      status: 'done',
      themeId: 1,
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [],
    };
    mockPrisma.task.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    mockPrisma.task.update.mockResolvedValue(updated);

    // Mock the fetch for achievement check
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response('ok'))) as typeof fetch;

    const res = await app.handle(
      new Request('http://localhost/tasks/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.studyStreak.upsert).toHaveBeenCalledTimes(1);

    globalThis.fetch = originalFetch;
  });

  test('labelIds更新時に既存ラベルを削除して新規作成すること', async () => {
    const current = { status: 'todo', parentId: null };
    const updated = {
      id: 1,
      title: 'Task',
      status: 'todo',
      themeId: null,
      theme: null,
      project: null,
      milestone: null,
      examGoal: null,
      taskLabels: [],
    };
    mockPrisma.task.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
    mockPrisma.task.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request('http://localhost/tasks/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds: [3, 4] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.taskLabel.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 1 },
    });
    expect(mockPrisma.taskLabel.createMany).toHaveBeenCalledTimes(1);
  });

  test('無効なIDでValidationErrorを返すこと', async () => {
    const res = await app.handle(
      new Request('http://localhost/tasks/abc', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'test' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('タスクを削除すること', async () => {
    mockPrisma.task.delete.mockResolvedValue({ id: 1, title: 'Deleted' });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  test('無効なIDでValidationErrorを返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/abc', { method: 'DELETE' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks/search', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('空のクエリで空配列を返すこと', async () => {
    const res = await app.handle(new Request('http://localhost/tasks/search?q='));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  test('クエリで検索結果を返すこと', async () => {
    const results = [{ id: 1, title: 'Test Task', priority: 'medium', status: 'todo' }];
    mockPrisma.task.findMany.mockResolvedValue(results);

    const res = await app.handle(new Request('http://localhost/tasks/search?q=Test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(results);
  });

  test('themeIdフィルタを適用すること', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await app.handle(new Request('http://localhost/tasks/search?q=test&themeId=3'));

    const call = mockPrisma.task.findMany.mock.calls[0]![0] as {
      where: { themeId?: number };
    };
    expect(call.where.themeId).toBe(3);
  });
});

describe('POST /tasks/:id/retry', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    // resetAllMocks clears the default implementations too — the retry route
    // chains .catch() on these, so they must resolve (undefined.catch throws).
    mockPrisma.activityLog.create.mockResolvedValue({ id: 1 });
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
    app = createApp();
  });

  test('blocked タスクを todo に戻すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ status: 'blocked' });
    mockPrisma.task.update.mockResolvedValue({ id: 5, status: 'todo' });

    const res = await app.handle(new Request('http://localhost/tasks/5/retry', { method: 'POST' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('todo');
    const updateArg = mockPrisma.task.update.mock.calls[0]![0] as {
      where: { id: number };
      data: { status: string };
    };
    expect(updateArg.where.id).toBe(5);
    expect(updateArg.data.status).toBe('todo');
  });

  test('スキップ通知を既読化して再発時の通知抑止を解除すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ status: 'failed' });
    mockPrisma.task.update.mockResolvedValue({ id: 5, status: 'todo' });

    await app.handle(new Request('http://localhost/tasks/5/retry', { method: 'POST' }));

    const notifArg = mockPrisma.notification.updateMany.mock.calls[0]![0] as {
      where: { type: string; metadata: { contains: string } };
      data: { isRead: boolean };
    };
    expect(notifArg.where.type).toBe('auto_run_task_skipped');
    expect(notifArg.where.metadata.contains).toContain('auto_run_task_skipped:5');
    expect(notifArg.data.isRead).toBe(true);
  });

  test('blocked / failed 以外は 400 を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ status: 'in-progress' });

    const res = await app.handle(new Request('http://localhost/tasks/5/retry', { method: 'POST' }));

    expect(res.status).toBe(400);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('存在しないタスクは 404 を返すこと', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks/999/retry', { method: 'POST' }),
    );

    expect(res.status).toBe(404);
  });
});
