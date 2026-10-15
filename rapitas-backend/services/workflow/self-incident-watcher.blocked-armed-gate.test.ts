/**
 * self-incident-watcher.blocked-armed-gate.test
 *
 * Watcher-level integration coverage for the blocked-task-pipeline-armed gate
 * (task 977), added as a new file rather than growing self-incident-watcher.
 * test.ts past the component size limit. Verifies the watcher resolves each
 * `blocked` candidate's armed-theme membership via
 * resolveArmedThemeIds/ThemeAutoRun and suppresses stagnation ONLY for
 * blocked tasks in armed themes — non-blocked and non-armed cases still file.
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
const themeFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const userSettingsFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const submitConcernMock = mock((_input: unknown) => Promise.resolve(1));
const notifyIntakeQuestionPendingMock = mock((_input: unknown) =>
  Promise.resolve<unknown>({ id: 1 }),
);

/**
 * The watcher calls prisma.themeAutoRun.findMany twice per pass with
 * different `where.enabled` values: resolveDisabledAutoRunThemeIds queries
 * `enabled:false`, resolveArmedThemeIds queries `enabled:true,
 * status:'running'`. A single discriminating mock keeps this test isolated
 * to the armed-set outcome instead of both queries' interaction.
 */
let armedThemeIdRows: { themeId: number }[] = [];
const themeAutoRunFindManyMock = mock((args: { where?: { enabled?: boolean } }) => {
  if (args?.where?.enabled === true) return Promise.resolve(armedThemeIdRows);
  return Promise.resolve([] as { themeId: number }[]);
});

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
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
    themeAutoRun: { findMany: themeAutoRunFindManyMock },
    theme: { findMany: themeFindManyMock },
    userSettings: { findFirst: userSettingsFindFirstMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));
mock.module('../communication/notification-service', () => ({
  notifyIntakeQuestionPending: notifyIntakeQuestionPendingMock,
}));

const { runSelfIncidentWatch, WATCH_INTERVAL_MS } = await import('./self-incident-watcher');

let clockMs = Date.parse('2026-09-19T00:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

// A blocked, stale, execution/queue-free task — the shape requeueOrphanTasks
// (task 977) now hands off to the blocked-task pipeline instead of leaving it
// as a permanently-detected orphan.
function blockedTask(now: number, over: Record<string, unknown> = {}) {
  return {
    id: 968,
    title: '停滞タスク',
    status: 'blocked',
    workflowStatus: 'research_done',
    updatedAt: new Date(now - 60 * 60 * 1000),
    themeId: 40,
    ...over,
  };
}

describe('blocked-task-pipeline-armed gate for stagnation (task 977)', () => {
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
    themeAutoRunFindManyMock.mockClear();
    armedThemeIdRows = [];
    themeFindManyMock.mockReset().mockResolvedValue([]);
    userSettingsFindFirstMock.mockReset().mockResolvedValue(null);
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
  });

  test('does NOT file stagnation for a blocked task in an armed theme (enabled+running)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now)]);
    armedThemeIdRows = [{ themeId: 40 }];

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('still files stagnation for a blocked task in an UNARMED theme (paused, not running)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now, { id: 969 })]);
    armedThemeIdRows = []; // theme 40 not armed (e.g. paused)

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:stagnation');
  });

  test('still files stagnation for a blocked, unthemed task (fail open — pipeline never sees it)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now, { id: 970, themeId: null })]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
  });

  test('a non-blocked stale in-progress task in the SAME armed theme still files (gate is blocked-only)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now, { id: 971, status: 'in-progress' })]);
    armedThemeIdRows = [{ themeId: 40 }];

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
  });
});
