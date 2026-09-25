/**
 * task-mutations.terminal-release.test
 *
 * Task 1009: updateTask releases the theme's currentTaskId when a task is moved
 * to done/cancelled, leaves it alone otherwise, and never fails the update if
 * the release itself fails.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

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

function createPrisma(themeUpdateMany: ReturnType<typeof mock>) {
  const findUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
  return {
    findUnique,
    prisma: {
      task: {
        findUnique,
        update: mock(() => Promise.resolve({})),
        findMany: mock(() => Promise.resolve([])),
      },
      taskLabel: { deleteMany: mock(() => Promise.resolve({ count: 0 })), createMany: mock() },
      studyStreak: { upsert: mock(() => Promise.resolve({})) },
      themeAutoRun: { updateMany: themeUpdateMany },
    },
  };
}

function seed(findUnique: ReturnType<typeof mock>, status: string) {
  findUnique
    .mockResolvedValueOnce({ status: 'in-progress', parentId: null, updatedAt: new Date() })
    .mockResolvedValueOnce({ id: 1008, title: 'T', status, parentId: null, themeId: 1 });
}

describe('updateTask — theme currentTaskId release (task 1009)', () => {
  let themeUpdateMany: ReturnType<typeof mock>;
  beforeEach(() => {
    themeUpdateMany = mock(() => Promise.resolve({ count: 1 })) as ReturnType<typeof mock>;
  });

  test('status=cancelled releases the theme currentTaskId (CAS on the task id)', async () => {
    const { prisma, findUnique } = createPrisma(themeUpdateMany);
    seed(findUnique, 'cancelled');
    await updateTask(prisma as never, 1008, { status: 'cancelled' });
    expect(themeUpdateMany).toHaveBeenCalledWith({
      where: { currentTaskId: 1008 },
      data: { currentTaskId: null },
    });
  });

  test('uses one $transaction for the status update and the release when available', async () => {
    const { prisma, findUnique } = createPrisma(themeUpdateMany);
    const $transaction = mock((ops: unknown[]) => Promise.all(ops));
    (prisma as Record<string, unknown>).$transaction = $transaction;
    seed(findUnique, 'cancelled');
    await updateTask(prisma as never, 1008, { status: 'cancelled' });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect((($transaction.mock.calls[0] as unknown[])[0] as unknown[]).length).toBe(2);
    expect(themeUpdateMany).toHaveBeenCalledTimes(1);
  });

  test('$transaction path is atomic: a failing release rejects the whole update', async () => {
    const { prisma, findUnique } = createPrisma(themeUpdateMany);
    (prisma as Record<string, unknown>).$transaction = mock(() =>
      Promise.reject(new Error('release failed')),
    );
    seed(findUnique, 'cancelled');
    await expect(updateTask(prisma as never, 1008, { status: 'cancelled' })).rejects.toThrow(
      'release failed',
    );
  });

  test('status=in-progress does not touch the theme', async () => {
    const { prisma, findUnique } = createPrisma(themeUpdateMany);
    seed(findUnique, 'in-progress');
    await updateTask(prisma as never, 1008, { status: 'in-progress' });
    expect(themeUpdateMany).not.toHaveBeenCalled();
  });

  test('a failing release does not fail the status update', async () => {
    themeUpdateMany = mock(() => Promise.reject(new Error('db'))) as ReturnType<typeof mock>;
    const { prisma, findUnique } = createPrisma(themeUpdateMany);
    seed(findUnique, 'cancelled');
    await expect(updateTask(prisma as never, 1008, { status: 'cancelled' })).resolves.toBeDefined();
  });
});
