/**
 * auto-run-slot-wait.flap.test.ts
 *
 * task 1535: a theme that cannot select only because other themes hold every global slot
 * must stay `running` — it must never be written to `idle` (which processIdleThemes would
 * resume with a `theme.resumed` event every 12s, an idle⇄running flap with no progress).
 * Ticks are injected, so the 12s cadence is reproduced deterministically.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const logCycleEventMock = mock((..._args: unknown[]) => {});
mock.module('../../observability', () => ({ logCycleEvent: logCycleEventMock }));
mock.module('./dev-restart-on-dry', () => ({ maybeRestartForUpdate: mock(async () => false) }));
mock.module('./open-pr-files-cache', () => ({ getOpenAutoPrsForTheme: mock(async () => []) }));
mock.module('./auto-run-advance-gates', () => ({
  checkResourceContentionGate: mock(async () => false),
  checkCalendarSlotGate: mock(async () => false),
  checkMergeBarrierGate: mock(() => false),
}));
mock.module('./auto-run-advance-scope', () => ({
  buildScopeOverlapContext: mock(async () => undefined),
}));
mock.module('./theme-auto-run-service', () => ({ setCurrentTask: mock(async () => {}) }));
mock.module('./auto-run-lifecycle', () => ({ broadcastAutoRunUpdateImpl: mock(() => {}) }));

let limit = 1;
const noteWaiterMock = mock(async () => {});
mock.module('./auto-run-concurrency', () => ({
  resolveAutoRunMaxConcurrency: mock(async () => ({ limit, source: 'settings' })),
  noteConcurrencyWaiter: noteWaiterMock,
  clearConcurrencyWaiter: mock(() => {}),
  shouldYieldToHigherPriorityTheme: mock(async () => ({ yield: false })),
}));

const selectNextTaskMock = mock(async () => ({ found: false, reason: 'concurrency_limit' }));
mock.module('./auto-run-selection', () => ({
  getGlobalAutoRunActiveCount: mock(async () => 0),
  overlappingFiles: mock(() => []),
  selectNextTask: selectNextTaskMock,
  recentThemeSuccessRate: mock(async () => null),
}));

const enqueueMock = mock(async () => ({ id: 1 }));
mock.module('../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue: enqueueMock }) },
}));

const { selectAndEnqueueNextTask } = await import('./auto-run-advance-select');

const updateManyMock = mock(async () => ({ count: 1 }));
const prisma = {
  themeAutoRun: { updateMany: updateManyMock },
  task: { findMany: mock(async () => []), findUnique: mock(async () => null) },
} as unknown as import('../../../generated/prisma-postgres').PrismaClient;

describe('selectAndEnqueueNextTask — waiting for a slot held by another theme', () => {
  beforeEach(() => {
    updateManyMock.mockClear();
    logCycleEventMock.mockClear();
    selectNextTaskMock.mockClear();
    enqueueMock.mockClear();
    noteWaiterMock.mockClear();
  });

  it.each([1, 2])(
    '上限 %i で全枠が埋まっている間、何 tick 回しても idle へ書かず再開も起きない',
    async (n) => {
      limit = n;
      for (let tick = 0; tick < 10; tick++) {
        await selectAndEnqueueNextTask(prisma, 1, 'priority', n, new Map());
      }
      expect(updateManyMock).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
      expect(noteWaiterMock).toHaveBeenCalledTimes(10);
      const events = logCycleEventMock.mock.calls.map((c) => c[0]);
      expect(events).not.toContain('theme.idle');
      expect(events).not.toContain('theme.resumed');
    },
  );

  it('選定側が concurrency_limit を返しても idle へ落とさない', async () => {
    limit = 2;
    for (let tick = 0; tick < 5; tick++) {
      await selectAndEnqueueNextTask(prisma, 1, 'priority', 1, new Map());
    }
    expect(selectNextTaskMock).toHaveBeenCalledTimes(5);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
