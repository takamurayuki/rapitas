/**
 * auto-run-advance-select.test.ts
 *
 * Verifies that scope-overlap deferral logging wires straight from
 * getOpenAutoPrsForTheme's result: a PR excluded there (e.g. an
 * auto_merge_exhausted PR with an unchanged head, task #931) never appears
 * in the `task.deferred` cycle event's prNumbers, because the logged list is
 * the same array getOpenAutoPrsForTheme returned. This test does not
 * re-verify the exclusion logic itself (see open-pr-files-cache.test.ts) —
 * only that the already-excluded result is what reaches the log.
 */
import { describe, it, expect, mock } from 'bun:test';

const openAutoPrs = [{ prNumber: 632, linkedTaskId: 559, createdAt: null }];

const cycleEvents: Array<{ event: string; payload: unknown }> = [];

mock.module('./open-pr-files-cache', () => ({
  getOpenAutoPrsForTheme: mock(async () => openAutoPrs),
}));

mock.module('./auto-run-advance-gates', () => ({
  checkResourceContentionGate: mock(async () => false),
  checkMergeBarrierGate: mock(() => false),
}));

mock.module('./auto-run-advance-scope', () => ({
  buildScopeOverlapContext: mock(async () => ({
    openPrFiles: ['services/shared.ts'],
    getPlanFiles: async (taskId: number) =>
      taskId === 2 ? ['services/shared.ts'] : ['services/unrelated.ts'],
  })),
}));

mock.module('./auto-run-selection', () => ({
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY: 10,
  overlappingFiles: (planFiles: string[], openPrFiles: string[]) =>
    planFiles.filter((f) => openPrFiles.includes(f)),
  selectNextTask: mock(async () => ({ found: true, taskId: 1, deferred: [2] })),
  recentThemeSuccessRate: mock(async () => null),
}));

mock.module('./backlog-task-promoter', () => ({
  promoteBacklogForTheme: mock(async () => 0),
}));

mock.module('./dev-restart-on-dry', () => ({
  maybeRestartForUpdate: mock(async () => false),
}));

mock.module('../../observability', () => ({
  logCycleEvent: mock((event: string, payload: unknown) => {
    cycleEvents.push({ event, payload });
  }),
}));

mock.module('./theme-auto-run-service', () => ({
  setCurrentTask: mock(async () => {}),
}));

mock.module('./auto-run-idle-timer', () => ({
  getIdleStopMinutes: mock(async () => 0),
  getSelfRefillWindowStart: mock(async () => null),
  isWithinSelfRefillWindow: mock(() => false),
  shouldRefillBacklogNow: mock(async () => false),
  markSelfRefillSucceeded: mock(async () => {}),
}));

mock.module('./auto-run-notifications', () => ({
  notifyAllDone: mock(async () => {}),
  notifyAllBlocked: mock(async () => {}),
}));

mock.module('../blocked-task-escalation', () => ({
  countEscalatedBlocked: mock(async () => 0),
}));

mock.module('./auto-run-lifecycle', () => ({
  broadcastAutoRunUpdateImpl: mock(() => {}),
}));

mock.module('../transition-recorder', () => ({
  recordTransition: mock(async () => {}),
}));

mock.module('../workflow-queue', () => ({
  WorkflowQueueService: {
    getInstance: () => ({
      enqueue: mock(async () => {}),
    }),
  },
}));

const { selectAndEnqueueNextTask } = await import('./auto-run-advance-select');

describe('selectAndEnqueueNextTask — scope-overlap deferral logging', () => {
  it("task.deferred prNumbers exactly match getOpenAutoPrsForTheme's (already-excluded) result", async () => {
    cycleEvents.length = 0;
    const prisma = {
      task: {
        findMany: mock(async () => []), // blockedTasks lookup
        findUnique: mock(async () => ({ workflowStatus: 'draft' })),
      },
    } as unknown as import('../../../generated/prisma-postgres').PrismaClient;

    await selectAndEnqueueNextTask(prisma, 7, 'priority', 0, new Map());

    const deferredEvent = cycleEvents.find((e) => e.event === 'task.deferred');
    expect(deferredEvent).toBeDefined();
    const payload = deferredEvent!.payload as { prNumbers: number[] };
    expect(payload.prNumbers).toEqual(openAutoPrs.map((p) => p.prNumber));
    // The stale/excluded PR (e.g. a parked auto_merge_exhausted PR) must never
    // appear — it was never in getOpenAutoPrsForTheme's returned array.
    expect(payload.prNumbers).not.toContain(999);
  });
});
