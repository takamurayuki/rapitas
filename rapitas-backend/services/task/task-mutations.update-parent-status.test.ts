/**
 * task-mutations ユニットテスト（updateTask: 親タスクステータス再計算の呼び出し）
 *
 * updateTask がサブタスクのステータス変更時に syncParentStatusFromSubtasks を
 * 正しい条件でのみ呼び出すことを検証する（ルール自体の詳細分岐は
 * task-parent-status-sync.test.ts でカバー）。
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

const syncParentStatusFromSubtasksMock = mock(() => Promise.resolve());
mock.module('./task-parent-status-sync', () => ({
  syncParentStatusFromSubtasks: syncParentStatusFromSubtasksMock,
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
  syncParentStatusFromSubtasksMock.mockClear();
});

describe('updateTask — 親タスクステータス再計算の呼び出し', () => {
  test('サブタスクのステータスが変更された場合、親IDでsyncParentStatusFromSubtasksを呼ぶこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: 100 },
      { id: 5, status: 'in-progress', parentId: 100 },
    );

    await updateTask(mockPrisma as never, 5, { status: 'in-progress' });

    expect(syncParentStatusFromSubtasksMock).toHaveBeenCalledWith(mockPrisma, 100);
  });

  test('status が未指定の場合、呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: 100 }, { id: 5, status: 'todo', parentId: 100 });

    await updateTask(mockPrisma as never, 5, { title: 'X' });

    expect(syncParentStatusFromSubtasksMock).not.toHaveBeenCalled();
  });

  test('親タスク（parentId が無い）の場合、呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'done', parentId: null });

    await updateTask(mockPrisma as never, 1, { status: 'done' });

    expect(syncParentStatusFromSubtasksMock).not.toHaveBeenCalled();
  });
});
