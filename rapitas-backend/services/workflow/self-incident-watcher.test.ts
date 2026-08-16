/**
 * self-incident-watcher.test
 *
 * Orchestrator tests over a mocked prisma + submitConcern + notification
 * helper: detections file dedup-keyed concerns, stale unanswered intake
 * questions re-notify (never file concerns), clean tasks file nothing, one
 * task's failure never stops the scan, and the 5-minute throttle skips
 * back-to-back passes.
 * NOTE: `lastRunMs` is module state — every test advances `nowMs` past the
 * interval instead of resetting the module, so ordering stays irrelevant.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const taskFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const taskFindUniqueMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const transitionFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const transitionFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const sessionFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const executionFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const queueItemFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const notificationFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const prFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const activityLogFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const workflowFileFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const submitConcernMock = mock((_input: unknown) => Promise.resolve(1));
const notifyIntakeQuestionPendingMock = mock((_input: unknown) =>
  Promise.resolve<unknown>({ id: 1 }),
);

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
// Full mirror of every prisma model the watcher + BOTH evidence gatherers
// touch — a missing model would sync-throw inside gatherSupervisorEvidence.
mock.module('../../config/database', () => ({
  prisma: {
    task: { findMany: taskFindManyMock, findUnique: taskFindUniqueMock },
    workflowTransition: { findMany: transitionFindManyMock, findFirst: transitionFindFirstMock },
    agentSession: { findFirst: sessionFindFirstMock },
    agentExecution: { findFirst: executionFindFirstMock },
    workflowQueueItem: { findFirst: queueItemFindFirstMock },
    notification: { findFirst: notificationFindFirstMock },
    gitHubPullRequest: { findFirst: prFindFirstMock },
    activityLog: { findFirst: activityLogFindFirstMock },
    workflowFile: { findFirst: workflowFileFindFirstMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));
mock.module('../communication/notification-service', () => ({
  notifyIntakeQuestionPending: notifyIntakeQuestionPendingMock,
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
    taskFindUniqueMock.mockReset().mockResolvedValue(null);
    transitionFindManyMock.mockReset().mockResolvedValue([]);
    transitionFindFirstMock.mockReset().mockResolvedValue(null);
    sessionFindFirstMock.mockReset().mockResolvedValue(null);
    executionFindFirstMock.mockReset().mockResolvedValue(null);
    queueItemFindFirstMock.mockReset().mockResolvedValue(null);
    notificationFindFirstMock.mockReset().mockResolvedValue(null);
    prFindFirstMock.mockReset().mockResolvedValue(null);
    activityLogFindFirstMock.mockReset().mockResolvedValue(null);
    workflowFileFindFirstMock.mockReset().mockResolvedValue(null);
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
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
        { cause: 'ci_repair', createdAt: new Date(now - 5 * 60 * 1000), actor: 'system' },
        { cause: 'ci_repair', createdAt: new Date(now - 10 * 60 * 1000), actor: 'system' },
        { cause: 'ci_repair', createdAt: new Date(now - 15 * 60 * 1000), actor: 'system' },
      ]);
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:repeat-loop:ci_repair:99');
    expect(String(input.title)).toContain('反復ループ');
  });

  // 受入(a): a never-started todo backlog item files nothing however stale it is.
  test('a stale never-started todo task (draft workflow, no history) files nothing', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, {
        id: 553,
        status: 'todo',
        workflowStatus: 'draft',
        updatedAt: new Date(now - 34 * 60 * 1000),
      }),
    ]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  // 受入(b): operator manual recovery (actor=user) is not a repeat loop.
  test('a repeat made solely of actor=user manual transitions files nothing', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, { id: 551, updatedAt: new Date(now - 60_000) }), // fresh → no stagnation
    ]);
    transitionFindManyMock.mockImplementation((args: unknown) => {
      const where = (args as { where: { createdAt?: unknown } }).where;
      if (!where.createdAt) return Promise.resolve([]);
      return Promise.resolve([
        { cause: 'manual_status_change', createdAt: new Date(now - 5 * 60 * 1000), actor: 'user' },
        { cause: 'manual_status_change', createdAt: new Date(now - 10 * 60 * 1000), actor: 'user' },
        { cause: 'manual_status_change', createdAt: new Date(now - 15 * 60 * 1000), actor: 'user' },
      ]);
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
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
    // The throttled call never queried nor filed (2 queries per pass: main
    // candidates + the dedicated awaiting_question scan).
    expect(taskFindManyMock).toHaveBeenCalledTimes(2);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
  });

  // 受入基準3: the supervisor cwd-mismatch signature files a concern whose
  // detail carries the same evidence a human supervisor read (both paths + line).
  test('files a supervisor cwd-mismatch concern with path evidence in the detail', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, { id: 580, updatedAt: new Date(now - 60_000) }), // fresh → no stagnation
    ]);
    taskFindUniqueMock.mockResolvedValue({
      theme: { workingDirectory: 'C:\\Projects\\ime-live-converter' },
    });
    // gatherTaskState probes executions with select:{id}; the supervisor
    // gatherer asks for select:{output} — dispatch on the requested field.
    executionFindFirstMock.mockImplementation((args: unknown) => {
      const select = (args as { select?: { output?: boolean } }).select;
      if (select?.output) {
        return Promise.resolve({
          output: '[Claude Code] Working directory: C:\\Projects\\rapitas\\rapitas-backend\n…',
        });
      }
      return Promise.resolve(null);
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:supervisor-cwd-mismatch:580');
    expect(input.severity).toBe('high');
    const detail = String(input.detail);
    expect(detail).toContain('## 検出証拠');
    expect(detail).toContain('実行cwd: C:\\Projects\\rapitas\\rapitas-backend');
    expect(detail).toContain('テーマ作業ディレクトリ: C:\\Projects\\ime-live-converter');
    expect(detail).toContain(
      '該当行: [Claude Code] Working directory: C:\\Projects\\rapitas\\rapitas-backend',
    );
  });

  // 受入基準3: the false-failure signature carries the gap seconds + artifact ref.
  test('files a supervisor false-failure concern with the 57s gap in the detail', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      stagnantTask(now, { id: 581, updatedAt: new Date(now - 60_000) }),
    ]);
    // Serves BOTH the active-queue probe (treated as active → no stagnation)
    // and the supervisor failure-mark lookup (completedAt of the failed item).
    queueItemFindFirstMock.mockResolvedValue({
      id: 7,
      completedAt: new Date(now - 120_000),
      status: 'failed',
    });
    prFindFirstMock.mockResolvedValue({
      createdAt: new Date(now - 120_000 + 57_000),
      prNumber: 7,
      url: 'https://github.com/takamurayuki/ime-live-converter/pull/7',
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:supervisor-false-failure:581');
    const detail = String(input.detail);
    expect(detail).toContain('## 検出証拠');
    expect(detail).toContain('時刻差: 57秒');
    expect(detail).toContain('PR #7 (https://github.com/takamurayuki/ime-live-converter/pull/7)');
  });

  test('the kill switch disables the supervisor pass without touching its queries', async () => {
    process.env.RAPITAS_SUPERVISOR_INCIDENT_DISABLED = '1';
    try {
      const now = nextPassTime();
      taskFindManyMock.mockResolvedValue([
        stagnantTask(now, { id: 582, updatedAt: new Date(now - 60_000) }),
      ]);
      taskFindUniqueMock.mockResolvedValue({
        theme: { workingDirectory: 'C:\\Projects\\ime-live-converter' },
      });

      const filed = await runSelfIncidentWatch(now);

      expect(filed).toBe(0);
      expect(submitConcernMock).not.toHaveBeenCalled();
      expect(taskFindUniqueMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.RAPITAS_SUPERVISOR_INCIDENT_DISABLED;
    }
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

describe('runSelfIncidentWatch — awaiting_question re-notification', () => {
  // #578/#579 shape: question raised, then 4 days of silence — updatedAt froze
  // at the raise, so the task is far outside the main 24h candidate lookback.
  const STALE_MS = 4 * 24 * 60 * 60 * 1000;

  function awaitingTask(over: Record<string, unknown> = {}) {
    return {
      id: 578,
      title: '質問待ちのタスク',
      status: 'awaiting_question',
      workflowStatus: 'awaiting_question',
      updatedAt: new Date(0), // frozen long ago — irrelevant to the wait clock
      ...over,
    };
  }

  /** Routes the two task queries: main lookback vs the dedicated awaiting scan. */
  function mockTaskQueues(main: unknown[], awaiting: unknown[]) {
    taskFindManyMock.mockImplementation((args: unknown) => {
      const where = (args as { where: { workflowStatus?: string } }).where;
      return Promise.resolve(where.workflowStatus === 'awaiting_question' ? awaiting : main);
    });
  }

  /** Routes the two transition lookups: raise time vs the answered guard. */
  function mockTransitions(raisedAtMs: number | null, answered: boolean) {
    transitionFindFirstMock.mockImplementation((args: unknown) => {
      const where = (args as { where: { toStatus?: string; cause?: string } }).where;
      if (where.toStatus === 'awaiting_question') {
        return Promise.resolve(raisedAtMs === null ? null : { createdAt: new Date(raisedAtMs) });
      }
      if (where.cause === 'intake_question_answered') {
        return Promise.resolve(answered ? { id: 7 } : null);
      }
      return Promise.resolve(null);
    });
  }

  beforeEach(() => {
    // Shared mocks are reset by the outer describe's pattern — repeat here
    // because bun runs each describe's beforeEach independently.
    taskFindManyMock.mockReset().mockResolvedValue([]);
    transitionFindManyMock.mockReset().mockResolvedValue([]);
    transitionFindFirstMock.mockReset().mockResolvedValue(null);
    sessionFindFirstMock.mockReset().mockResolvedValue(null);
    executionFindFirstMock.mockReset().mockResolvedValue(null);
    queueItemFindFirstMock.mockReset().mockResolvedValue(null);
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
  });

  // 受入基準3(発火例): the #578/#579 shape must be caught by the dedicated scan.
  test('re-notifies a 4-day stale unanswered question via notification, never a concern', async () => {
    const now = nextPassTime();
    mockTaskQueues([], [awaitingTask()]);
    mockTransitions(now - STALE_MS, false);

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(1);
    expect(notifyIntakeQuestionPendingMock).toHaveBeenCalledTimes(1);
    expect(notifyIntakeQuestionPendingMock).toHaveBeenCalledWith({
      taskId: 578,
      taskTitle: '質問待ちのタスク',
      nowMs: now,
    });
    // Re-notification must NOT go through the concern pipeline (task 587 shape).
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('uses a dedicated no-lookback query filtered to awaiting_question', async () => {
    const now = nextPassTime();
    await runSelfIncidentWatch(now);

    const query = taskFindManyMock.mock.calls[1]?.[0] as {
      where: { parentId: null; workflowStatus: string; updatedAt?: unknown };
      orderBy: { updatedAt: string };
      take: number;
    };
    expect(query.where.workflowStatus).toBe('awaiting_question');
    // No lookback — a frozen updatedAt must never age the task out of scope.
    expect(query.where.updatedAt).toBeUndefined();
    expect(query.where.parentId).toBeNull();
    expect(query.take).toBe(200);
  });

  // 受入基準4: an answered task must never re-notify.
  test('does NOT re-notify when an intake_question_answered transition exists', async () => {
    const now = nextPassTime();
    mockTaskQueues([], [awaitingTask()]);
    mockTransitions(now - STALE_MS, true);

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(0);
    expect(notifyIntakeQuestionPendingMock).not.toHaveBeenCalled();
  });

  // 受入基準3(非発火正常例): a same-day question is a legitimate wait.
  test('does NOT re-notify a question raised below the threshold', async () => {
    const now = nextPassTime();
    mockTaskQueues([], [awaitingTask()]);
    mockTransitions(now - 60 * 60 * 1000, false); // 1h ago

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(0);
    expect(notifyIntakeQuestionPendingMock).not.toHaveBeenCalled();
  });

  test('does NOT re-notify when no awaiting_question transition is on record', async () => {
    const now = nextPassTime();
    mockTaskQueues([], [awaitingTask()]);
    mockTransitions(null, false);

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(0);
    expect(notifyIntakeQuestionPendingMock).not.toHaveBeenCalled();
  });

  test('counts a dedup-suppressed re-notification (helper returns null) as zero', async () => {
    const now = nextPassTime();
    mockTaskQueues([], [awaitingTask()]);
    mockTransitions(now - STALE_MS, false);
    notifyIntakeQuestionPendingMock.mockResolvedValue(null); // inside dedup window

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(0);
    expect(notifyIntakeQuestionPendingMock).toHaveBeenCalledTimes(1);
  });

  test('one task notification failure does not stop the remaining awaiting tasks', async () => {
    const now = nextPassTime();
    mockTaskQueues([], [awaitingTask(), awaitingTask({ id: 579, title: 'もう一つの質問待ち' })]);
    mockTransitions(now - STALE_MS, false);
    notifyIntakeQuestionPendingMock
      .mockRejectedValueOnce(new Error('notification down'))
      .mockResolvedValueOnce({ id: 2 });

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(1);
    expect(notifyIntakeQuestionPendingMock).toHaveBeenCalledTimes(2);
  });

  test('concern findings and question re-notifications sum in the return value', async () => {
    const now = nextPassTime();
    mockTaskQueues(
      [
        {
          id: 546,
          title: '停滞するタスク',
          status: 'in-progress',
          workflowStatus: 'in_progress',
          updatedAt: new Date(now - 40 * 60 * 1000),
        },
      ],
      [awaitingTask()],
    );
    mockTransitions(now - STALE_MS, false);

    const surfaced = await runSelfIncidentWatch(now);

    expect(surfaced).toBe(2);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
    expect(notifyIntakeQuestionPendingMock).toHaveBeenCalledTimes(1);
  });
});
