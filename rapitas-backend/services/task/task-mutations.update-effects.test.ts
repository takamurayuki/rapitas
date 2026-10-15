/**
 * task-mutations ユニットテスト（updateTask: ユーザー行動記録・サブタスク完了連携）
 *
 * ユーザー行動記録・完了通知・知識抽出・サブタスク完了連携を検証する。
 * SearchMiss解決・SSE通知・カレンダー同期は task-mutations.update-broadcast.test.ts に、
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

const mockRecordTaskStarted = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
const mockRecordTaskCompleted = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
const mockRecordBehavior = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../../src/services/user-behavior-service', () => ({
  UserBehaviorService: {
    recordTaskCreated: mock(() => Promise.resolve()),
    recordTaskStarted: mockRecordTaskStarted,
    recordTaskCompleted: mockRecordTaskCompleted,
    recordBehavior: mockRecordBehavior,
  },
}));

const mockNotifyTaskCompleted = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
const mockCreateNotification = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;
mock.module('../communication/notification-service', () => ({
  notifyTaskCompleted: mockNotifyTaskCompleted,
  createNotification: mockCreateNotification,
  notifyAgentExecutionCompleted: mock(() => Promise.resolve()),
  notifyApprovalRequested: mock(() => Promise.resolve()),
  notifyAuthenticationFailure: mock(() => Promise.resolve()),
  notifyPomodoroCompleted: mock(() => Promise.resolve()),
  AUTH_FAILURE_NOTIFICATION_TITLE: 'Claude 認証切れ',
}));

const mockOnGeneratedTaskCompleted = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../scheduling/recurring-task-service', () => ({
  calculateNextOccurrence: mock(() => null),
  setTaskRecurrence: mock(() => Promise.resolve({})),
  removeTaskRecurrence: mock(() => Promise.resolve({})),
  generateNextTaskInstance: mock(() => Promise.resolve(null)),
  processAllPendingRecurrences: mock(() => Promise.resolve([])),
  onGeneratedTaskCompleted: mockOnGeneratedTaskCompleted,
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

const mockOnSubtaskCompleted = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../workflow/subtask-completion-handler', () => ({
  isSubtaskFinished: mock(() => false),
  isSubtaskFailed: mock(() => false),
  isSubtaskPassed: mock(() => false),
  isParentFinalizable: mock(() => false),
  onSubtaskCompleted: mockOnSubtaskCompleted,
}));

const mockExtractKnowledgeFromTask = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
mock.module('../memory/task-knowledge-extractor', () => ({
  extractKnowledgeFromTask: mockExtractKnowledgeFromTask,
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
  mockRecordTaskStarted.mockReset();
  mockRecordTaskStarted.mockResolvedValue(undefined);
  mockRecordTaskCompleted.mockReset();
  mockRecordTaskCompleted.mockResolvedValue(undefined);
  mockRecordBehavior.mockReset();
  mockRecordBehavior.mockResolvedValue(undefined);
  mockNotifyTaskCompleted.mockReset();
  mockNotifyTaskCompleted.mockResolvedValue(undefined);
  mockCreateNotification.mockReset();
  mockCreateNotification.mockResolvedValue({ id: 1 });
  mockOnGeneratedTaskCompleted.mockReset();
  mockOnGeneratedTaskCompleted.mockResolvedValue(undefined);
  mockOnSubtaskCompleted.mockReset();
  mockOnSubtaskCompleted.mockResolvedValue(undefined);
  mockExtractKnowledgeFromTask.mockReset();
  mockExtractKnowledgeFromTask.mockResolvedValue([]);
});

describe('updateTask — ユーザー行動記録（親タスクのみ）', () => {
  test('in-progress へ変更時、recordTaskStarted を呼ぶこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: null },
      { id: 1, title: 'T', status: 'in-progress', parentId: null, themeId: null },
    );

    await updateTask(mockPrisma as never, 1, { status: 'in-progress' });

    expect(mockRecordTaskStarted).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'in-progress' }),
    );
  });

  test('done へ変更時、recordTaskCompleted・完了通知・繰り返しタスク生成・知識抽出を呼ぶこと', async () => {
    setupFindUnique(
      { status: 'in-progress', parentId: null },
      { id: 1, title: 'Done Task', status: 'done', parentId: null, themeId: null },
    );

    await updateTask(mockPrisma as never, 1, { status: 'done' });
    await flush();

    expect(mockRecordTaskCompleted).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'done' }),
    );
    expect(mockNotifyTaskCompleted).toHaveBeenCalledWith(1, 'Done Task');
    expect(mockOnGeneratedTaskCompleted).toHaveBeenCalled();
    expect(mockExtractKnowledgeFromTask).toHaveBeenCalledWith(1);
  });

  test('completion notification の失敗はログのみで例外にならないこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: null },
      { id: 1, title: 'T', status: 'done', parentId: null },
    );
    mockNotifyTaskCompleted.mockRejectedValueOnce(new Error('notif fail'));

    await expect(updateTask(mockPrisma as never, 1, { status: 'done' })).resolves.toBeDefined();
    await flush();
  });

  test('status が変化しない場合、行動記録をスキップすること', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { status: 'todo' });

    expect(mockRecordTaskStarted).not.toHaveBeenCalled();
    expect(mockRecordTaskCompleted).not.toHaveBeenCalled();
  });

  test('title/description/priority/themeId 変更時、recordBehavior(task_updated) を呼ぶこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: null },
      { id: 1, status: 'todo', parentId: null, themeId: 5 },
    );

    await updateTask(mockPrisma as never, 1, { title: 'New Title' });

    expect(mockRecordBehavior).toHaveBeenCalledWith(
      'task_updated',
      expect.objectContaining({
        taskId: 1,
        themeId: 5,
        metadata: { changes: { title: true, description: false, priority: false, themeId: false } },
      }),
    );
  });

  test('対象フィールドが未変更の場合、recordBehavior を呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'todo', parentId: null });

    await updateTask(mockPrisma as never, 1, { estimatedHours: 3 });

    expect(mockRecordBehavior).not.toHaveBeenCalled();
  });

  test('サブタスク（parentId あり）は行動記録を一切スキップすること', async () => {
    setupFindUnique(
      { status: 'todo', parentId: 10 },
      { id: 2, status: 'done', parentId: 10, title: 'Sub' },
    );

    await updateTask(mockPrisma as never, 2, { status: 'done', title: 'Sub' });

    expect(mockRecordTaskCompleted).not.toHaveBeenCalled();
    expect(mockRecordBehavior).not.toHaveBeenCalled();
  });
});

describe('updateTask — サブタスク完了連携', () => {
  test('サブタスクが done になった場合、onSubtaskCompleted を呼ぶこと', async () => {
    setupFindUnique(
      { status: 'in-progress', parentId: 10 },
      { id: 2, status: 'done', parentId: 10 },
    );

    await updateTask(mockPrisma as never, 2, { status: 'done' });
    await flush();

    expect(mockOnSubtaskCompleted).toHaveBeenCalledWith(2);
  });

  test('親タスク（parentId 無し）が done になっても onSubtaskCompleted を呼ばないこと', async () => {
    setupFindUnique({ status: 'todo', parentId: null }, { id: 1, status: 'done', parentId: null });

    await updateTask(mockPrisma as never, 1, { status: 'done' });
    await flush();

    expect(mockOnSubtaskCompleted).not.toHaveBeenCalled();
  });

  test('done 以外への変更では onSubtaskCompleted を呼ばないこと', async () => {
    setupFindUnique(
      { status: 'todo', parentId: 10 },
      { id: 2, status: 'in-progress', parentId: 10 },
    );

    await updateTask(mockPrisma as never, 2, { status: 'in-progress' });
    await flush();

    expect(mockOnSubtaskCompleted).not.toHaveBeenCalled();
  });

  test('onSubtaskCompleted 失敗時、system 通知を作成すること', async () => {
    setupFindUnique(
      { status: 'in-progress', parentId: 10 },
      { id: 2, status: 'done', parentId: 10 },
    );
    mockOnSubtaskCompleted.mockRejectedValueOnce(new Error('finalize failed'));

    await updateTask(mockPrisma as never, 2, { status: 'done' });
    await flush();

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        metadata: expect.objectContaining({ taskId: 2, parentId: 10 }),
      }),
    );
  });
});
