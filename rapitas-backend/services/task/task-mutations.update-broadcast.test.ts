/**
 * task-mutations ユニットテスト（updateTask: SearchMiss解決・SSE通知・カレンダー同期）
 *
 * updateTask 完了時の SearchMiss 解決、リアルタイムSSE配信のイベント種別分岐、
 * dueDate変更時のカレンダー同期を検証する。
 * ユーザー行動記録・サブタスク完了連携は task-mutations.update-effects.test.ts に、
 * フィールドマッピング系は task-mutations.update-fields.test.ts / update-misc.test.ts に
 * 分割している（300行制限のため）。
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

const mockSendTaskUpdate = mock(() => {}) as ReturnType<typeof mock>;
mock.module('../communication/realtime-service', () => ({
  realtimeService: { sendTaskUpdate: mockSendTaskUpdate, broadcast: mock(() => {}) },
  RealtimeService: class {},
}));

const mockSyncTaskToCalendar = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../scheduling/task-calendar-sync', () => ({
  syncTaskToCalendar: mockSyncTaskToCalendar,
  syncCalendarToTask: mock(() => Promise.resolve()),
}));

const mockResolveSearchMissForTask = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../search/search-miss-service', () => ({
  recordSearchMiss: mock(() => Promise.resolve()),
  getTopMissedQueries: mock(() => Promise.resolve([])),
  getRelatedMisses: mock(() => Promise.resolve([])),
  getMissAnalytics: mock(() => Promise.resolve({})),
  linkTaskToMiss: mock(() => Promise.resolve()),
  autoLinkMatchingMisses: mock(() => Promise.resolve()),
  resolveSearchMissForTask: mockResolveSearchMissForTask,
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

function setupFindUnique(
  current: Record<string, unknown> | null,
  updated: Record<string, unknown> | null,
) {
  mockPrisma.task.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(updated);
}

/** Flush the microtask queue so fire-and-forget `.then()/.catch()` chains settle before assertions. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockPrisma = createMockPrisma();
  mockSendTaskUpdate.mockReset();
  mockSyncTaskToCalendar.mockReset();
  mockSyncTaskToCalendar.mockResolvedValue(undefined);
  mockResolveSearchMissForTask.mockReset();
  mockResolveSearchMissForTask.mockResolvedValue(undefined);
});

describe('updateTask — SearchMiss解決', () => {
  test('status=done の場合、resolveSearchMissForTask を呼ぶこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'done', parentId: null });

    await updateTask(mockPrisma as never, 1, { status: 'done' });

    expect(mockResolveSearchMissForTask).toHaveBeenCalledWith(mockPrisma, 1);
  });

  test('status が done 以外の場合、resolveSearchMissForTask を呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { title: 'X' });

    expect(mockResolveSearchMissForTask).not.toHaveBeenCalled();
  });
});

describe('updateTask — SSE通知・カレンダー同期', () => {
  test('status=done の場合、task_completed イベントを送信すること', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'done', parentId: null });

    await updateTask(mockPrisma as never, 1, { status: 'done' });

    expect(mockSendTaskUpdate).toHaveBeenCalledWith(
      1,
      'task_completed',
      expect.objectContaining({ taskId: 1 }),
    );
  });

  test('status が done 以外に変化した場合、task_status_changed イベントを送信すること', async () => {
    setupFindUnique(
      { status: 'todo', parentId: null },
      { id: 1, status: 'in-progress', parentId: null },
    );

    await updateTask(mockPrisma as never, 1, { status: 'in-progress' });

    expect(mockSendTaskUpdate).toHaveBeenCalledWith(1, 'task_status_changed', expect.anything());
  });

  test('status 変更が無い場合、task_updated イベントを送信すること', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { title: 'X' });

    expect(mockSendTaskUpdate).toHaveBeenCalledWith(1, 'task_updated', expect.anything());
  });

  test('dueDate が変更された場合、syncTaskToCalendar を呼ぶこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: null },
      { id: 1, status: 'todo', parentId: null, title: 'T', dueDate: new Date('2026-02-01') },
    );

    await updateTask(mockPrisma as never, 1, { dueDate: '2026-02-01' });

    expect(mockSyncTaskToCalendar).toHaveBeenCalledWith(1, new Date('2026-02-01'), 'T');
  });

  test('dueDate が未変更の場合、syncTaskToCalendar を呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { title: 'X' });

    expect(mockSyncTaskToCalendar).not.toHaveBeenCalled();
  });

  test('カレンダー同期の失敗はログのみで例外にならないこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: null },
      { id: 1, status: 'todo', parentId: null, dueDate: null },
    );
    mockSyncTaskToCalendar.mockRejectedValueOnce(new Error('sync fail'));

    await expect(updateTask(mockPrisma as never, 1, { dueDate: null })).resolves.toBeDefined();
    await flush();
  });

  test('更新後タスクが見つからない場合、SSE通知をスキップすること', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, null);

    const result = await updateTask(mockPrisma as never, 1, { title: 'X' });

    expect(result).toBeNull();
    expect(mockSendTaskUpdate).not.toHaveBeenCalled();
  });
});
