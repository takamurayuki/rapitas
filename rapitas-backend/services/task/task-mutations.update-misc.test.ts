/**
 * task-mutations ユニットテスト（updateTask: ラベル更新・actualHours再計算）
 *
 * updateTask のラベル一括更新と、サブタスク actualHours 変更時の
 * 親タスク actualHours 再計算ロジックを検証する。
 * フィールドマッピング系は task-mutations.update-fields.test.ts に分割している
 * （300行制限のため）。
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

mock.module('../../src/services/user-behavior-service', () => ({
  UserBehaviorService: {
    recordTaskCreated: mock(() => Promise.resolve()),
    recordTaskStarted: mock(() => Promise.resolve()),
    recordTaskCompleted: mock(() => Promise.resolve()),
    recordBehavior: mock(() => Promise.resolve()),
  },
}));

mock.module('../communication/notification-service', () => ({
  notifyTaskCompleted: mock(() => Promise.resolve()),
  createNotification: mock(() => Promise.resolve({ id: 1 })),
  notifyAgentExecutionCompleted: mock(() => Promise.resolve()),
  notifyApprovalRequested: mock(() => Promise.resolve()),
  notifyAuthenticationFailure: mock(() => Promise.resolve()),
  notifyPomodoroCompleted: mock(() => Promise.resolve()),
  AUTH_FAILURE_NOTIFICATION_TITLE: 'Claude 認証切れ',
}));

mock.module('../scheduling/recurring-task-service', () => ({
  calculateNextOccurrence: mock(() => null),
  setTaskRecurrence: mock(() => Promise.resolve({})),
  removeTaskRecurrence: mock(() => Promise.resolve({})),
  generateNextTaskInstance: mock(() => Promise.resolve(null)),
  processAllPendingRecurrences: mock(() => Promise.resolve([])),
  onGeneratedTaskCompleted: mock(() => Promise.resolve()),
  getUpcomingOccurrences: mock(() => []),
  getGeneratedTasks: mock(() => Promise.resolve([])),
  RECURRENCE_PRESETS: {},
}));

mock.module('./task-create-helpers', () => ({
  createSubtask: mock(() => Promise.resolve(null)),
  createParentTask: mock(() => Promise.resolve(null)),
}));

mock.module('../communication/realtime-service', () => ({
  realtimeService: { sendTaskUpdate: mock(() => {}), broadcast: mock(() => {}) },
  RealtimeService: class {},
}));

mock.module('../scheduling/task-calendar-sync', () => ({
  syncTaskToCalendar: mock(() => Promise.resolve()),
  syncCalendarToTask: mock(() => Promise.resolve()),
}));

mock.module('../search/search-miss-service', () => ({
  recordSearchMiss: mock(() => Promise.resolve()),
  getTopMissedQueries: mock(() => Promise.resolve([])),
  getRelatedMisses: mock(() => Promise.resolve([])),
  getMissAnalytics: mock(() => Promise.resolve({})),
  linkTaskToMiss: mock(() => Promise.resolve()),
  autoLinkMatchingMisses: mock(() => Promise.resolve()),
  resolveSearchMissForTask: mock(() => Promise.resolve()),
}));

mock.module('../workflow/subtask-completion-handler', () => ({
  isSubtaskFinished: mock(() => false),
  isSubtaskFailed: mock(() => false),
  isSubtaskPassed: mock(() => false),
  isParentFinalizable: mock(() => false),
  onSubtaskCompleted: mock(() => Promise.resolve()),
}));

mock.module('../memory/task-knowledge-extractor', () => ({
  extractKnowledgeFromTask: mock(() => Promise.resolve([])),
  reflectOnFailure: mock(() => Promise.resolve([])),
  findRelatedKnowledge: mock(() => Promise.resolve([])),
  searchCrossProjectKnowledge: mock(() => Promise.resolve([])),
}));

const { updateTask } = await import('./task-mutations');

function createMockPrisma() {
  return {
    task: {
      findUnique: mock(() => Promise.resolve(null)) as ReturnType<typeof mock>,
      update: mock(() => Promise.resolve({})) as ReturnType<typeof mock>,
      findMany: mock(() => Promise.resolve([])) as ReturnType<typeof mock>,
    },
    taskLabel: {
      deleteMany: mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>,
      createMany: mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>,
    },
    studyStreak: {
      upsert: mock(() => Promise.resolve({})) as ReturnType<typeof mock>,
    },
  };
}

let mockPrisma = createMockPrisma();

/** Queues the two sequential `task.findUnique` calls (current-state fetch, then post-update fetch). */
function setupFindUnique(
  current: Record<string, unknown> | null,
  updated: Record<string, unknown> | null,
) {
  mockPrisma.task.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
}

beforeEach(() => {
  mockPrisma = createMockPrisma();
});

describe('updateTask — ラベル更新', () => {
  test('labelIds が指定された場合、既存ラベルを削除し新規作成すること', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { labelIds: [2, 3] });

    expect(mockPrisma.taskLabel.deleteMany).toHaveBeenCalledWith({ where: { taskId: 1 } });
    expect(mockPrisma.taskLabel.createMany).toHaveBeenCalledWith({
      data: [
        { taskId: 1, labelId: 2 },
        { taskId: 1, labelId: 3 },
      ],
    });
  });

  test('labelIds が空配列の場合、削除のみで作成は呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { labelIds: [] });

    expect(mockPrisma.taskLabel.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.taskLabel.createMany).not.toHaveBeenCalled();
  });

  test('labelIds が未指定の場合、ラベル操作を一切呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { title: 'X' });

    expect(mockPrisma.taskLabel.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.taskLabel.createMany).not.toHaveBeenCalled();
  });
});

describe('updateTask — 親タスク actualHours 再計算', () => {
  test('サブタスクの actualHours 更新時、兄弟タスクの合計で親を更新すること', async () => {
    setupFindUnique(
      { status: 'todo', parentId: 100 },
      { id: 5, status: 'todo', parentId: 100, actualHours: 3 },
    );
    mockPrisma.task.findMany.mockResolvedValueOnce([{ actualHours: 3 }, { actualHours: 2 }]);

    await updateTask(mockPrisma as never, 5, { actualHours: 3 });

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
      where: { parentId: 100 },
      select: { actualHours: true },
    });
    const parentUpdateCall = mockPrisma.task.update.mock.calls.find(
      (c) => (c[0] as { where: { id: number } }).where.id === 100,
    );
    expect(parentUpdateCall).toBeDefined();
    expect((parentUpdateCall![0] as { data: { actualHours: number } }).data.actualHours).toBe(5);
  });

  test('兄弟タスクの合計が 0 の場合、親の actualHours を null にすること', async () => {
    setupFindUnique(
      { status: 'todo', parentId: 100 },
      { id: 5, status: 'todo', parentId: 100, actualHours: null },
    );
    mockPrisma.task.findMany.mockResolvedValueOnce([{ actualHours: null }, { actualHours: 0 }]);

    await updateTask(mockPrisma as never, 5, { actualHours: null });

    const parentUpdateCall = mockPrisma.task.update.mock.calls.find(
      (c) => (c[0] as { where: { id: number } }).where.id === 100,
    );
    expect(
      (parentUpdateCall![0] as { data: { actualHours: number | null } }).data.actualHours,
    ).toBeNull();
  });

  test('actualHours が未指定の場合、再計算をスキップすること', async () => {
    setupFindUnique({ status: 'todo', parentId: 100 }, { id: 5, status: 'todo', parentId: 100 });

    await updateTask(mockPrisma as never, 5, { title: 'X' });

    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });

  test('親タスク（parentId が無い）の場合、actualHours を更新しても再計算をスキップすること', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { actualHours: 5 });

    expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
  });
});
