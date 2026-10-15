/**
 * auto-run-advance-select.test.ts
 *
 * Verifies that the task.deferred cycle-event's prNumbers field is exactly
 * whatever getOpenAutoPrsForTheme returns — so a PR excluded there (e.g. an
 * exhausted, head-unchanged auto-PR — task 1061) never resurfaces in the
 * deferral observability event, even though it once contributed to the
 * scope-overlap deferral.
 */
import { describe, it, expect, mock } from 'bun:test';

const logCycleEventMock = mock(() => {});

// Fixed set the mocked getOpenAutoPrsForTheme returns — this stands in for the
// ALREADY-FILTERED result (task 1061's exclusion happens inside
// open-pr-files-cache.ts, covered by its own unit tests). Only PR 501 survives
// exclusion; PR 999 represents an exhausted+head-matched PR that must never
// appear downstream.
const SURVIVING_PR_NUMBERS = [501];
const EXCLUDED_PR_NUMBER = 999;

mock.module('./open-pr-files-cache', () => ({
  getOpenAutoPrsForTheme: mock(async () =>
    SURVIVING_PR_NUMBERS.map((prNumber) => ({ prNumber, linkedTaskId: 1, createdAt: null })),
  ),
}));

mock.module('./dev-restart-on-dry', () => ({
  maybeRestartForUpdate: mock(async () => false),
}));

mock.module('./auto-run-advance-gates', () => ({
  checkResourceContentionGate: mock(async () => false),
  checkMergeBarrierGate: mock(() => false),
}));

mock.module('./auto-run-selection', () => ({
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY: 1,
  overlappingFiles: mock(() => ['services/overlap.ts']),
  selectNextTask: mock(async () => ({ found: true, taskId: 42, deferred: [43] })),
  recentThemeSuccessRate: mock(async () => null),
}));

mock.module('./auto-run-advance-scope', () => ({
  buildScopeOverlapContext: mock(async () => ({
    openPrFiles: ['services/overlap.ts'],
    getPlanFiles: async () => ['services/overlap.ts'],
  })),
}));

mock.module('../../observability', () => ({
  logCycleEvent: logCycleEventMock,
}));

mock.module('./theme-auto-run-service', () => ({
  setCurrentTask: mock(async () => {}),
}));

mock.module('../workflow-queue', () => ({
  WorkflowQueueService: {
    getInstance: () => ({
      enqueue: mock(async () => ({ id: 1 })),
    }),
  },
}));

mock.module('./auto-run-lifecycle', () => ({
  broadcastAutoRunUpdateImpl: mock(() => {}),
}));

const { selectAndEnqueueNextTask } = await import('./auto-run-advance-select');

describe('selectAndEnqueueNextTask — task.deferred prNumbers', () => {
  it('reports only the surviving (non-excluded) PR numbers in task.deferred', async () => {
    logCycleEventMock.mockClear();

    const prisma = {
      task: {
        findMany: mock(async () => []),
        findUnique: mock(async () => ({ workflowStatus: 'todo' })),
      },
    } as unknown as import('../../../generated/prisma-postgres').PrismaClient;

    await selectAndEnqueueNextTask(prisma, 7, 'priority', 0, new Map());

    const deferredCalls = logCycleEventMock.mock.calls.filter(([evt]) => evt === 'task.deferred');
    expect(deferredCalls.length).toBe(1);
    const [, fields] = deferredCalls[0]!;
    expect(fields.prNumbers).toEqual(SURVIVING_PR_NUMBERS);
    expect(fields.prNumbers).not.toContain(EXCLUDED_PR_NUMBER);
  });
});
