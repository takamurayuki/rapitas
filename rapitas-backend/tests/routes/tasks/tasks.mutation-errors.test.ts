/**
 * tasks.ts の変更系エンドポイントにおけるエラー処理テスト
 *
 * task-routes.test.ts が正常系のみをカバーしているため、POST /tasks の
 * エラー変換分岐と DELETE /tasks/:id の保護ガード・worktree クリーンアップ
 * 分岐を対象とする。createTask/updateTask は実装をそのまま使い、モックは
 * 末端の依存モジュールのみに留める（task-service を差し替えると他ファイル
 * の実装本体のテストと衝突しうるため）。
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
  agentSession: {
    findMany: mock(() => Promise.resolve([])),
    update: mock(() => Promise.resolve({})),
  },
  notification: {
    create: mock(() => Promise.resolve({ id: 1 })),
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
mock.module('../../../services/agents/orchestrator/git-operations/worktree-ops', () => ({
  rmDirWithRetry: mock(() => Promise.resolve(true)),
  createWorktree: mock(() => Promise.resolve('/wt')),
  removeWorktree: mock(() => Promise.resolve()),
  cleanupStaleWorktrees: mock(() => Promise.resolve(0)),
  cleanupOrphanedWorktrees: mock(() => Promise.resolve(0)),
  ensureGitRepository: mock(() => Promise.resolve(true)),
  validateAndSetupRemote: mock(() => Promise.resolve(true)),
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
const { AppError } = await import('../../../middleware/error-handler');
const worktreeOps =
  await import('../../../services/agents/orchestrator/git-operations/worktree-ops');
const removeWorktree = worktreeOps.removeWorktree as ReturnType<typeof mock>;

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
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(mockPrisma),
  );
  mockPrisma.notification.create.mockResolvedValue({ id: 1 });
  removeWorktree.mockReset();
  removeWorktree.mockResolvedValue(undefined);
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
    .use(tasksRoutes);
}

describe('POST /tasks エラー変換', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('親タスクが見つからない場合は400に変換されること', async () => {
    // createSubtask looks up the parent before entering any transaction;
    // a null result throws Error(`親タスク(ID: ...)が見つかりません`).
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Orphan subtask', parentId: 999 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('見つかりません');
  });

  test('予期しないエラーは500・固定メッセージに変換されること', async () => {
    mockPrisma.task.create.mockRejectedValue(new Error('DB write failed'));

    const res = await app.handle(
      new Request('http://localhost/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Task' }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('タスクの作成に失敗しました');
  });
});

describe('DELETE /tasks/:id 保護ガードとworktreeクリーンアップ', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test('保護されたタスクは409で削除を拒否すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValueOnce({ isProtected: true });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('保護されたタスクは削除できません');
    expect(mockPrisma.task.delete).not.toHaveBeenCalled();
  });

  test('worktreeを持つセッションをクリーンアップしてから削除すること', async () => {
    mockPrisma.task.findUnique
      .mockResolvedValueOnce({ isProtected: false }) // guard check
      .mockResolvedValueOnce({ workingDirectory: '/repo/task' }); // cleanup lookup
    mockPrisma.agentSession.findMany.mockResolvedValue([
      { id: 5, worktreePath: '/repo/.worktrees/task-1' },
    ]);
    mockPrisma.task.delete.mockResolvedValue({ id: 1, title: 'Deleted' });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(removeWorktree).toHaveBeenCalledWith('/repo/task', '/repo/.worktrees/task-1');
    expect(mockPrisma.agentSession.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { worktreePath: null },
    });
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  test('worktree削除に失敗しても本体の削除は続行すること', async () => {
    mockPrisma.task.findUnique
      .mockResolvedValueOnce({ isProtected: false })
      .mockResolvedValueOnce({ workingDirectory: '/repo/task' });
    mockPrisma.agentSession.findMany.mockResolvedValue([
      { id: 5, worktreePath: '/repo/.worktrees/task-1' },
    ]);
    removeWorktree.mockRejectedValue(new Error('EBUSY'));
    mockPrisma.task.delete.mockResolvedValue({ id: 1 });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    // The failed removeWorktree short-circuits the per-session try block, so
    // the DB pointer is never cleared for this session.
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  test('クリーンアップ自体が例外を投げても削除は続行すること', async () => {
    mockPrisma.task.findUnique
      .mockResolvedValueOnce({ isProtected: false })
      .mockRejectedValueOnce(new Error('lookup failed'));
    mockPrisma.task.delete.mockResolvedValue({ id: 1 });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
