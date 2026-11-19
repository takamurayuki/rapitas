/**
 * task-mutations.notes-stage1.test
 *
 * The two notes stage-1 hooks in updateTask: a theme change starts the
 * deliverable follow (design §2.2 contract 5), and a manual completion
 * carries its deliverable completion record in the same batch transaction,
 * with one time for completedAt / updatedAt / the record (§3.3). The rest of
 * updateTask is stubbed exactly as in task-mutations.update-fields.test.ts.
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

const followed: number[] = [];
const entries: { taskId: number; mode: string; opts: Record<string, unknown> }[] = [];
const recordOpsFor: { taskId: number; completedAt: Date }[] = [];

const order: string[] = [];

// Mirrors every export of note-follow (Bun replaces the whole module).
mock.module('../notes/placement/note-follow', () => ({
  followOne: mock(() => Promise.resolve(false)),
  followTaskThemeChange: mock(() => Promise.resolve(0)),
  followIfEffectiveThemeChanged: mock(() => Promise.resolve(0)),
  followTaskThemeChangeInBackground: mock(() => {}),
  prepareThemeFollow: async (_db: unknown, taskId: number, themeSent: boolean) => {
    order.push(`prepare:${themeSent}`);
    return () => {
      if (themeSent) followed.push(taskId);
    };
  },
  resetPlacementToTask: mock(() => Promise.resolve({ ok: false, status: 404, error: 'x' })),
}));

// Mirrors every export of deliverable-completion.
mock.module('../notes/deliverables/deliverable-completion', () => ({
  COMPLETION_MODES: ['manual'],
  recordTaskCompletionTx: mock(() => Promise.resolve()),
  completionRecordBatchOps: (
    _db: unknown,
    taskId: number,
    _ws: unknown,
    _mode: string,
    at: Date,
  ) => {
    recordOpsFor.push({ taskId, completedAt: at });
    return ['record-delete', 'record-create'];
  },
  completeWithRecord: mock(() => Promise.resolve(true)),
  onTaskCompleted: (taskId: number, mode: string, opts: Record<string, unknown>) => {
    entries.push({ taskId, mode, opts });
  },
}));

const { updateTask } = await import('./task-mutations');

function createPrisma(current: Record<string, unknown>) {
  const batches: unknown[][] = [];
  const prisma = {
    task: {
      findUnique: mock()
        .mockResolvedValueOnce({ updatedAt: new Date(0), workspaceId: null, ...current })
        .mockResolvedValueOnce({ id: 1, title: 't', parentId: 1, themeId: null }),
      update: mock((args: unknown) => {
        order.push('write');
        return args;
      }),
      updateMany: mock(() => Promise.resolve({ count: 1 })),
      findMany: mock(() => Promise.resolve([])),
    },
    themeAutoRun: { updateMany: mock(() => 'release') },
    taskDeliverableCompletion: {},
    $transaction: mock((ops: unknown[]) => {
      batches.push(ops);
      return Promise.resolve(ops);
    }),
  };
  return { prisma, batches };
}

beforeEach(() => {
  followed.length = 0;
  order.length = 0;
  entries.length = 0;
  recordOpsFor.length = 0;
});

describe('updateTask — notes stage 1 hooks', () => {
  test('a theme change starts the deliverable follow', async () => {
    const { prisma } = createPrisma({ status: 'todo', parentId: 1 });
    await updateTask(prisma as never, 1, { themeId: 4 });
    expect(followed).toEqual([1]);
    // The effective theme is read before the write, so the follow can compare (must-fix 5).
    expect(order.indexOf('prepare:true')).toBeLessThan(order.indexOf('write'));
  });

  test('an update without a theme change does not', async () => {
    const { prisma } = createPrisma({ status: 'todo', parentId: 1 });
    await updateTask(prisma as never, 1, { title: 'x' });
    expect(followed).toEqual([]);
  });

  test('a manual completion puts the record in the same batch, with one time', async () => {
    const { prisma, batches } = createPrisma({ status: 'in-progress', parentId: 1 });
    await updateTask(prisma as never, 1, { status: 'done' });
    expect(batches[0]).toHaveLength(4);
    expect(batches[0]?.slice(2)).toEqual(['record-delete', 'record-create']);
    const data = (batches[0]?.[0] as { data: { completedAt: Date; updatedAt: Date } }).data;
    expect(data.updatedAt).toBe(data.completedAt);
    expect(recordOpsFor[0]?.completedAt).toBe(data.completedAt);
    expect(entries).toEqual([
      { taskId: 1, mode: 'manual', opts: expect.objectContaining({ recorded: true }) },
    ]);
  });

  test('marking an already-done task done again is not a completion', async () => {
    const { prisma, batches } = createPrisma({ status: 'done', parentId: 1 });
    await updateTask(prisma as never, 1, { status: 'done' });
    expect(batches[0]).toHaveLength(2);
    expect(entries).toEqual([]);
  });
});
