/**
 * blocked-retry-handoff.test
 *
 * Proves settleStrandedRetryDrafts re-dispatches a draft stranded by a failed
 * blocked_auto_retry re-dispatch, and hands it to blocked after a bounded number
 * of unselected attempts (task 1262: #1237 sat todo/draft for 590 minutes).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const recordTransition = mock(async (_input: Record<string, unknown>) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));

const { settleStrandedRetryDrafts } = await import('./blocked-retry-handoff');
const { MAX_RETRY_REDISPATCH, RETRY_REDISPATCH_GRACE_MS, BLOCKED_RETRY_HANDOFF_CAUSE } =
  await import('./blocked-task-policy');

const NOW = 1_800_000_000_000;
const OLD = new Date(NOW - RETRY_REDISPATCH_GRACE_MS - 60_000);

type Candidate = { id: number; themeId: number | null; updatedAt: Date };
let candidates: Candidate[];
let latestCause: string | null;
let latestCreatedAt: Date;
let redispatchCount: number;
let liveExecution: boolean;
let queueItem: boolean;
let theme: { enabled: boolean; status: string; currentTaskId: number | null; order: string } | null;
let updateManyCount: number;
const updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> =
  [];
const selectCalls: number[] = [];
let selectTakesTask = false;

const fakePrisma = {
  task: {
    findMany: () => Promise.resolve(candidates),
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updateManyCalls.push(args);
      return Promise.resolve({ count: updateManyCount });
    },
  },
  workflowTransition: {
    findFirst: (args: { where: { cause?: string } }) =>
      Promise.resolve(
        args.where.cause === 'blocked_retry_redispatch'
          ? redispatchCount > 0
            ? { metadata: JSON.stringify({ n: redispatchCount }) }
            : null
          : args.where.cause
            ? { createdAt: new Date(NOW - 3_600_000) }
            : latestCause
              ? { cause: latestCause, createdAt: latestCreatedAt }
              : null,
      ),
  },
  agentExecution: { findFirst: () => Promise.resolve(liveExecution ? { id: 1 } : null) },
  workflowQueueItem: { findFirst: () => Promise.resolve(queueItem ? { id: 1 } : null) },
  themeAutoRun: {
    findUnique: () => Promise.resolve(theme ? { ...theme } : null),
    count: () => Promise.resolve(0),
  },
};

const deps = {
  select: async (_p: unknown, themeId: number) => {
    selectCalls.push(themeId);
    if (selectTakesTask && theme) theme.currentTaskId = 1237;
  },
};

const run = () => settleStrandedRetryDrafts(fakePrisma as never, NOW, deps);
const causes = () => recordTransition.mock.calls.map((c) => c[0].cause);

describe('settleStrandedRetryDrafts (task 1262)', () => {
  beforeEach(() => {
    candidates = [{ id: 1237, themeId: 34, updatedAt: OLD }];
    latestCause = 'blocked_auto_retry';
    latestCreatedAt = OLD;
    redispatchCount = 0;
    liveExecution = false;
    queueItem = false;
    theme = { enabled: true, status: 'running', currentTaskId: null, order: 'priority' };
    updateManyCount = 1;
    updateManyCalls.length = 0;
    selectCalls.length = 0;
    selectTakesTask = false;
    recordTransition.mockClear();
  });

  test('not_selected が上限未満なら再投入を試みるだけで blocked にしない', async () => {
    redispatchCount = MAX_RETRY_REDISPATCH - 2; // this attempt is n = MAX - 1

    await run();

    expect(selectCalls).toEqual([34]);
    expect(causes()).toEqual(['blocked_retry_redispatch']);
    // updatedAt must stay untouched so the stagnation detector's clock is not reset.
    expect(updateManyCalls.length).toBe(0);
  });

  test('not_selected が上限に達したら blocked + blocked_retry_handoff に引き渡す', async () => {
    redispatchCount = MAX_RETRY_REDISPATCH - 1; // this attempt is n = MAX

    expect(await run()).toBe(1);

    expect(BLOCKED_RETRY_HANDOFF_CAUSE).toBe('blocked_retry_handoff');
    expect(causes()).toEqual(['blocked_retry_redispatch', BLOCKED_RETRY_HANDOFF_CAUSE]);
    const handoff = updateManyCalls.find((c) => c.data.status === 'blocked');
    expect(handoff?.where).toMatchObject({ id: 1237, status: 'todo', workflowStatus: 'draft' });
    expect(handoff?.data.workflowStatus).toBeUndefined();
    expect(recordTransition.mock.calls[1][0].metadata).toMatchObject({
      statusFrom: 'todo',
      statusTo: 'blocked',
    });
  });

  test('themeId が null なら再投入せず即時に引き渡す', async () => {
    candidates = [{ id: 1237, themeId: null, updatedAt: OLD }];

    await run();

    expect(selectCalls.length).toBe(0);
    expect(causes()).toEqual([BLOCKED_RETRY_HANDOFF_CAUSE]);
  });

  test('kicked は redispatch を記録するだけで blocked にしない', async () => {
    selectTakesTask = true;
    redispatchCount = MAX_RETRY_REDISPATCH - 1;

    await run();

    expect(causes()).toEqual(['blocked_retry_redispatch']);
    expect(updateManyCalls.some((c) => c.data.status === 'blocked')).toBe(false);
  });

  test('slot_busy は計数も記録もしない', async () => {
    theme!.currentTaskId = 999;
    redispatchCount = MAX_RETRY_REDISPATCH - 1;

    await run();

    expect(recordTransition.mock.calls.length).toBe(0);
    expect(updateManyCalls.length).toBe(0);
  });

  test('テーマが未稼働(存在する)なら計数せず待機する', async () => {
    theme!.status = 'paused_user';
    redispatchCount = MAX_RETRY_REDISPATCH - 1;

    await run();

    expect(recordTransition.mock.calls.length).toBe(0);
    expect(updateManyCalls.length).toBe(0);
  });

  test('猶予内・実行中・キュー項目あり・別経路の draft は対象外', async () => {
    latestCreatedAt = new Date(NOW - 60_000);
    await run();
    latestCreatedAt = OLD;
    liveExecution = true;
    candidates = [{ id: 1237, themeId: 34, updatedAt: OLD }];
    await run();
    liveExecution = false;
    queueItem = true;
    await run();
    queueItem = false;
    latestCause = 'artifact_reuse_fastforward';
    await run();

    expect(selectCalls.length).toBe(0);
    expect(recordTransition.mock.calls.length).toBe(0);
  });

  test('条件付き更新が 0 件なら引き渡し遷移を記録しない', async () => {
    candidates = [{ id: 1237, themeId: null, updatedAt: OLD }];
    updateManyCount = 0;

    expect(await run()).toBe(0);

    expect(recordTransition.mock.calls.length).toBe(0);
  });
});
