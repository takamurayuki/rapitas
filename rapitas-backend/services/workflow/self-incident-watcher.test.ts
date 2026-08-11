/**
 * self-incident-watcher.test
 *
 * Orchestrator tests over a mocked prisma + submitConcern: detections file
 * dedup-keyed concerns, clean tasks file nothing, one task's failure never
 * stops the scan, and the 5-minute throttle skips back-to-back passes.
 * NOTE: `lastRunMs` is module state — every test advances `nowMs` past the
 * interval instead of resetting the module, so ordering stays irrelevant.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const taskFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const transitionFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const sessionFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const executionFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const queueItemFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const submitConcernMock = mock((_input: unknown) => Promise.resolve(1));

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    task: { findMany: taskFindManyMock },
    workflowTransition: { findMany: transitionFindManyMock },
    agentSession: { findFirst: sessionFindFirstMock },
    agentExecution: { findFirst: executionFindFirstMock },
    workflowQueueItem: { findFirst: queueItemFindFirstMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));

const { runSelfIncidentWatch, shouldRunIncidentWatch, WATCH_INTERVAL_MS } =
  await import('./self-incident-watcher');

// Monotonic clock: each test starts a fresh pass safely past the throttle.
let clockMs = Date.parse('2026-08-11T00:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

function stagnantTask(now: number, over: Record<string, unknown> = {}) {
  return {
    id: 546,
    title: '停滞するタスク',
    status: 'in-progress',
    workflowStatus: 'in_progress',
    updatedAt: new Date(now - 40 * 60 * 1000),
    ...over,
  };
}

describe('shouldRunIncidentWatch', () => {
  test('false below the interval, true at and above it (>= boundary)', () => {
    const last = 1_000_000;
    expect(shouldRunIncidentWatch(last, last + WATCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRunIncidentWatch(last, last + WATCH_INTERVAL_MS)).toBe(true);
    expect(shouldRunIncidentWatch(last, last + WATCH_INTERVAL_MS + 1)).toBe(true);
  });

  test('honors a custom interval override', () => {
    expect(shouldRunIncidentWatch(0, 999, 1_000)).toBe(false);
    expect(shouldRunIncidentWatch(0, 1_000, 1_000)).toBe(true);
  });
});

describe('runSelfIncidentWatch', () => {
  beforeEach(() => {
    taskFindManyMock.mockReset().mockResolvedValue([]);
    transitionFindManyMock.mockReset().mockResolvedValue([]);
    sessionFindFirstMock.mockReset().mockResolvedValue(null);
    executionFindFirstMock.mockReset().mockResolvedValue(null);
    queueItemFindFirstMock.mockReset().mockResolvedValue(null);
    submitConcernMock.mockReset().mockResolvedValue(1);
  });

  test('files a stagnation concern with dedupKey / source / originTaskId', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([stagnantTask(now)]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:stagnation:546');
    expect(input.source).toBe('self_incident_watch');
    expect(input.originTaskId).toBe(546);
    expect(input.type).toBe('bug');
    expect(input.severity).toBe('medium');
    expect(String(input.detail)).toContain('## 直近の遷移タイムライン(最大10件)');
    expect(String(input.detail)).toContain('## 検出条件');
  });

  test('files a tri-state desync concern for todo × advanced workflow', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, {
        id: 541,
        status: 'todo',
        workflowStatus: 'plan_created',
        updatedAt: new Date(now - 60_000), // fresh → stagnation must NOT fire
      }),
    ]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:tristate-desync:todo-workflow-advanced:541');
    expect(input.severity).toBe('high');
  });

  test('files a repeat-loop concern keyed by the looping cause', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, { id: 99, updatedAt: new Date(now - 60_000) }),
    ]);
    // Timeline query (no createdAt filter) → []; windowed query → 3× ci_repair.
    transitionFindManyMock.mockImplementation((args: unknown) => {
      const where = (args as { where: { createdAt?: unknown } }).where;
      if (!where.createdAt) return Promise.resolve([]);
      return Promise.resolve([
        { cause: 'ci_repair', createdAt: new Date(now - 5 * 60 * 1000) },
        { cause: 'ci_repair', createdAt: new Date(now - 10 * 60 * 1000) },
        { cause: 'ci_repair', createdAt: new Date(now - 15 * 60 * 1000) },
      ]);
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:repeat-loop:ci_repair:99');
    expect(String(input.title)).toContain('反復ループ');
  });

  test('a clean task files nothing', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, { updatedAt: new Date(now - 60_000) }), // fresh, consistent
    ]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('a stagnant task with a live execution files nothing', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([stagnantTask(now)]);
    executionFindFirstMock.mockResolvedValue({ id: 1 });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('one task submitConcern failure does not stop the remaining tasks', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, { id: 101 }),
      stagnantTask(now, { id: 102 }),
    ]);
    submitConcernMock.mockRejectedValueOnce(new Error('backlog down')).mockResolvedValueOnce(2);

    const filed = await runSelfIncidentWatch(now);

    // Task 101's filing failed (counted 0) but task 102 still filed.
    expect(filed).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(2);
    const second = submitConcernMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(second.dedupKey).toBe('self-incident:stagnation:102');
  });

  test('a second call inside the throttle interval is skipped entirely', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([stagnantTask(now)]);

    const first = await runSelfIncidentWatch(now);
    const second = await runSelfIncidentWatch(now + 1_000);

    expect(first).toBe(1);
    expect(second).toBe(0);
    // The throttled call never queried nor filed.
    expect(taskFindManyMock).toHaveBeenCalledTimes(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
  });

  test('scans oldest-first within the 24h lookback with the defensive cap', async () => {
    const now = nextPassTime();
    await runSelfIncidentWatch(now);

    const query = taskFindManyMock.mock.calls[0]?.[0] as {
      where: { parentId: null; updatedAt: { gte: Date } };
      orderBy: { updatedAt: string };
      take: number;
    };
    expect(query.where.parentId).toBeNull();
    expect(now - query.where.updatedAt.gte.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(query.orderBy).toEqual({ updatedAt: 'asc' });
    expect(query.take).toBe(200);
  });
});
