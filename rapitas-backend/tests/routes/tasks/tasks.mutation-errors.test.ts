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
    // NOTE(#1330): cleanUpTaskWorktrees groups sessions by worktreePath and
    // clears them with updateMany — several sessions can share one directory.
    updateMany: mock(() => Promise.resolve({ count: 0 })),
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
  notifyKnowledgeExtracted: mock(() => Promise.resolve()),
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
mock.module('../../../services/agents/orchestrator/git-operations/worktree/worktree-ops', () => ({
  rmDirWithRetry: mock(() => Promise.resolve(true)),
  createWorktree: mock(() => Promise.resolve('/wt')),
  removeWorktree: mock(() => Promise.resolve(true)),
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
const { getProjectRoot } = await import('../../../config');
const worktreeOps =
  await import('../../../services/agents/orchestrator/git-operations/worktree/worktree-ops');
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
  // NOTE: removeWorktree now returns Promise<boolean> (実際に削除できたか) —
  // tasks.ts DELETE ハンドラは `if (!removed) continue;` で偽値ならDB更新を
  // スキップするようになった。既定は成功(true)にしないと、後続の
  // agentSession.updateMany 呼び出しが一切発生しない。
  removeWorktree.mockResolvedValue(true);
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
    expect(mockPrisma.agentSession.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [5] } },
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
    expect(mockPrisma.agentSession.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.task.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  test('task.workingDirectoryが無い場合はtheme.workingDirectoryをbaseDirにすること', async () => {
    mockPrisma.task.findUnique
      .mockResolvedValueOnce({ isProtected: false }) // guard check
      .mockResolvedValueOnce({
        workingDirectory: null,
        theme: { workingDirectory: '/repo/theme-dir' },
      }); // cleanup lookup
    mockPrisma.agentSession.findMany.mockResolvedValue([
      { id: 5, worktreePath: '/repo/theme-dir/.worktrees/task-1' },
    ]);
    mockPrisma.task.delete.mockResolvedValue({ id: 1 });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(removeWorktree).toHaveBeenCalledWith(
      '/repo/theme-dir',
      '/repo/theme-dir/.worktrees/task-1',
    );
  });

  test('task.workingDirectoryもtheme.workingDirectoryも無い場合はgetProjectRoot()にフォールバックすること', async () => {
    mockPrisma.task.findUnique
      .mockResolvedValueOnce({ isProtected: false }) // guard check
      .mockResolvedValueOnce({ workingDirectory: null, theme: null }); // cleanup lookup
    mockPrisma.agentSession.findMany.mockResolvedValue([
      { id: 5, worktreePath: `${getProjectRoot()}/.worktrees/task-1` },
    ]);
    mockPrisma.task.delete.mockResolvedValue({ id: 1 });

    const res = await app.handle(new Request('http://localhost/tasks/1', { method: 'DELETE' }));

    expect(res.status).toBe(200);
    expect(removeWorktree).toHaveBeenCalledWith(
      getProjectRoot(),
      `${getProjectRoot()}/.worktrees/task-1`,
    );
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

// #1349 の最初のPR。レビュー指摘: GET を 400 にしても、変更操作群は依然
// parseInt の切り捨てで別の行に届く。`DELETE /tasks/5abc` は parseInt が 5 を
// 返すため、非保護タスクなら **ID 5 の削除処理へ進む**。
//
// ステータスだけでは不十分（#1346 で 404 を観測して欠陥を固定した前例がある）。
// このブロックは「DBに触れていないこと」を assert する。
describe('変更操作は数字以外を含むidで行5に届かないこと (#1349)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
    // 行5が実在し、非保護である状況を作る。これが無いと findUnique が null を
    // 返して 404 で止まり、「行5が削除される」という本題が再現できない
    // （最初に書いた版はこれを欠いており、400ではなく404を観測していた）。
    mockPrisma.task.findUnique.mockResolvedValue({ id: 5, title: 'row five', isProtected: false });
    mockPrisma.task.delete.mockResolvedValue({ id: 5, title: 'row five' });
    mockPrisma.task.update.mockResolvedValue({ id: 5, title: 'row five' });
    mockPrisma.task.findMany.mockResolvedValue([]);
  });

  /** parseInt が 5 / 0 / 不正な整数へ切り詰めていた入力。 */
  const TRUNCATED = ['5abc', '5e2', '5.9', '0x10', '-3', '0', '99999999999999999999'];

  describe.each(TRUNCATED)('id=%p', (raw) => {
    test('DELETE /tasks/:id は削除せず400を返すこと', async () => {
      const res = await app.handle(
        new Request(`http://localhost/tasks/${raw}`, { method: 'DELETE' }),
      );

      expect(res.status).toBe(400);
      // 最重要: 行5の削除処理に入っていないこと。
      expect(mockPrisma.task.delete).not.toHaveBeenCalled();
      expect(mockPrisma.task.findUnique).not.toHaveBeenCalled();
    });

    test('PATCH /tasks/:id は更新せず400を返すこと', async () => {
      const res = await app.handle(
        new Request(`http://localhost/tasks/${raw}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'hijacked' }),
        }),
      );

      expect(res.status).toBe(400);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    test('DELETE /tasks/:id/subtasks は削除せず400を返すこと', async () => {
      const res = await app.handle(
        new Request(`http://localhost/tasks/${raw}/subtasks`, { method: 'DELETE' }),
      );

      expect(res.status).toBe(400);
      expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.task.delete).not.toHaveBeenCalled();
    });

    test('POST /tasks/:id/subtasks/delete-selected は削除せず400を返すこと', async () => {
      const res = await app.handle(
        new Request(`http://localhost/tasks/${raw}/subtasks/delete-selected`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtaskIds: [1, 2] }),
        }),
      );

      expect(res.status).toBe(400);
      expect(mockPrisma.task.delete).not.toHaveBeenCalled();
    });

    test('POST /tasks/:id/cleanup-duplicates は削除せず400を返すこと', async () => {
      const res = await app.handle(
        new Request(`http://localhost/tasks/${raw}/cleanup-duplicates`, { method: 'POST' }),
      );

      expect(res.status).toBe(400);
      expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
    });

    test('POST /tasks/:id/retry は400を返すこと', async () => {
      const res = await app.handle(
        new Request(`http://localhost/tasks/${raw}/retry`, { method: 'POST' }),
      );

      expect(res.status).toBe(400);
    });
  });

  // 過剰修正のガードは、このファイル既存の DELETE テスト群が担っている
  // （`worktreeを持つセッションをクリアしてから削除すること` 等が id=1 で
  // 200 と `task.delete({ where: { id: 1 } })` を assert している）。
  // ここで重ねて書くと choke point のモックを二重に用意することになり、
  // 実際に 500 になって「何を検証しているのか」が曖昧になった。
});
