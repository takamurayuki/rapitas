/**
 * task-mutations ユニットテスト（createTask）
 *
 * createTask の正常系・異常系・副作用（SSE通知・通知作成・SearchMiss連携）を検証する。
 * updateTask のテストは task-mutations.update-fields.test.ts /
 * task-mutations.update-effects.test.ts に分割している（300行制限のため）。
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

const mockCreateSubtask = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const mockCreateParentTask = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
mock.module('./task-create-helpers', () => ({
  createSubtask: mockCreateSubtask,
  createParentTask: mockCreateParentTask,
}));

const mockSendTaskUpdate = mock(() => {}) as ReturnType<typeof mock>;
mock.module('../communication/realtime-service', () => ({
  realtimeService: { sendTaskUpdate: mockSendTaskUpdate, broadcast: mock(() => {}) },
  RealtimeService: class {},
}));

mock.module('../scheduling/task-calendar-sync', () => ({
  syncTaskToCalendar: mock(() => Promise.resolve()),
  syncCalendarToTask: mock(() => Promise.resolve()),
}));

const mockLinkTaskToMiss = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
const mockAutoLinkMatchingMisses = mock(() => Promise.resolve()) as ReturnType<typeof mock>;
mock.module('../search/search-miss-service', () => ({
  recordSearchMiss: mock(() => Promise.resolve()),
  getTopMissedQueries: mock(() => Promise.resolve([])),
  getRelatedMisses: mock(() => Promise.resolve([])),
  getMissAnalytics: mock(() => Promise.resolve({})),
  linkTaskToMiss: mockLinkTaskToMiss,
  autoLinkMatchingMisses: mockAutoLinkMatchingMisses,
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

const { createTask } = await import('./task-mutations');

const mockNotificationCreate = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;

function createMockPrisma() {
  return {
    notification: { create: mockNotificationCreate },
  };
}

let mockPrisma = createMockPrisma();

beforeEach(() => {
  mockCreateSubtask.mockReset();
  mockCreateSubtask.mockResolvedValue(null);
  mockCreateParentTask.mockReset();
  mockCreateParentTask.mockResolvedValue(null);
  mockSendTaskUpdate.mockReset();
  mockLinkTaskToMiss.mockReset();
  mockLinkTaskToMiss.mockResolvedValue(undefined);
  mockAutoLinkMatchingMisses.mockReset();
  mockAutoLinkMatchingMisses.mockResolvedValue(undefined);
  mockNotificationCreate.mockReset();
  mockNotificationCreate.mockResolvedValue({ id: 1 });
  mockPrisma = createMockPrisma();
});

describe('createTask', () => {
  test('parentId が無い場合、createParentTask を呼び出すこと', async () => {
    const createdTask = { id: 1, title: 'Parent Task', status: 'todo', parentId: null };
    mockCreateParentTask.mockResolvedValueOnce(createdTask);

    const result = await createTask(mockPrisma as never, { title: 'Parent Task' });

    expect(result).toEqual(createdTask);
    expect(mockCreateParentTask).toHaveBeenCalledWith(mockPrisma, 'Parent Task', undefined, {});
    expect(mockCreateSubtask).not.toHaveBeenCalled();
  });

  test('parentId がある場合、createSubtask を呼び出すこと', async () => {
    const createdTask = { id: 2, title: 'Sub Task', status: 'todo', parentId: 1 };
    mockCreateSubtask.mockResolvedValueOnce(createdTask);

    const result = await createTask(mockPrisma as never, { title: 'Sub Task', parentId: 1 });

    expect(result).toEqual(createdTask);
    expect(mockCreateSubtask).toHaveBeenCalledWith(mockPrisma, 1, 'Sub Task', undefined, {});
    expect(mockCreateParentTask).not.toHaveBeenCalled();
  });

  test('labelIds が渡された場合、createParentTask に渡すこと', async () => {
    mockCreateParentTask.mockResolvedValueOnce({ id: 3, title: 'X', parentId: null });

    await createTask(mockPrisma as never, { title: 'X', labelIds: [1, 2] });

    expect(mockCreateParentTask).toHaveBeenCalledWith(mockPrisma, 'X', [1, 2], {});
  });

  test('searchMissId がある場合、linkTaskToMiss を呼び autoLinkMatchingMisses は呼ばないこと', async () => {
    const createdTask = { id: 4, title: 'X', parentId: null };
    mockCreateParentTask.mockResolvedValueOnce(createdTask);

    await createTask(mockPrisma as never, { title: 'X', searchMissId: 99 });

    expect(mockLinkTaskToMiss).toHaveBeenCalledWith(mockPrisma, 99, 4);
    expect(mockAutoLinkMatchingMisses).not.toHaveBeenCalled();
  });

  test('searchMissId が無い場合、autoLinkMatchingMisses を呼ぶこと', async () => {
    const createdTask = { id: 5, title: 'Match Me', parentId: null };
    mockCreateParentTask.mockResolvedValueOnce(createdTask);

    await createTask(mockPrisma as never, { title: 'Match Me' });

    expect(mockAutoLinkMatchingMisses).toHaveBeenCalledWith(mockPrisma, 5, 'Match Me');
    expect(mockLinkTaskToMiss).not.toHaveBeenCalled();
  });

  test('SearchMiss連携が失敗しても createTask は失敗しないこと', async () => {
    mockCreateParentTask.mockResolvedValueOnce({ id: 6, title: 'X', parentId: null });
    mockAutoLinkMatchingMisses.mockRejectedValueOnce(new Error('link failed'));

    await expect(createTask(mockPrisma as never, { title: 'X' })).resolves.toEqual({
      id: 6,
      title: 'X',
      parentId: null,
    });
  });

  test('task 作成後に SSE で task_created イベントを送信すること', async () => {
    const createdTask = { id: 7, title: 'SSE Task', status: 'todo', parentId: null };
    mockCreateParentTask.mockResolvedValueOnce(createdTask);

    await createTask(mockPrisma as never, { title: 'SSE Task' });

    expect(mockSendTaskUpdate).toHaveBeenCalledWith(
      7,
      'task_created',
      expect.objectContaining({ taskId: 7, title: 'SSE Task', status: 'todo', parentId: null }),
    );
  });

  test('親タスク作成時、通知タイトルが「タスクを作成しました」であること', async () => {
    mockCreateParentTask.mockResolvedValueOnce({ id: 8, title: 'X', parentId: null });

    await createTask(mockPrisma as never, { title: 'X' });

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'タスクを作成しました', link: '/tasks/8' }),
      }),
    );
  });

  test('サブタスク作成時、通知タイトルが「サブタスクを作成しました」であること', async () => {
    mockCreateSubtask.mockResolvedValueOnce({ id: 9, title: 'X', parentId: 1 });

    await createTask(mockPrisma as never, { title: 'X', parentId: 1 });

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'サブタスクを作成しました' }),
      }),
    );
  });

  test('通知作成が失敗しても createTask は失敗しないこと', async () => {
    mockCreateParentTask.mockResolvedValueOnce({ id: 10, title: 'X', parentId: null });
    mockNotificationCreate.mockRejectedValueOnce(new Error('notif failed'));

    await expect(createTask(mockPrisma as never, { title: 'X' })).resolves.toEqual({
      id: 10,
      title: 'X',
      parentId: null,
    });
  });

  test('task が falsy の場合、SSE 送信・通知作成をスキップし null を返すこと', async () => {
    mockCreateParentTask.mockResolvedValueOnce(null);

    const result = await createTask(mockPrisma as never, { title: 'X' });

    expect(result).toBeNull();
    expect(mockSendTaskUpdate).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
    expect(mockLinkTaskToMiss).not.toHaveBeenCalled();
    expect(mockAutoLinkMatchingMisses).not.toHaveBeenCalled();
  });
});
