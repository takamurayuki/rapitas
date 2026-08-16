/**
 * supervisor-incident-evidence.test
 *
 * Covers the supervisor-evidence I/O boundary: every query maps into the
 * SupervisorEvidence snapshot, the load gates (theme/failure/backstop) skip
 * their dependent queries, the closing-quote dedup match cannot collide across
 * task-id prefixes (585 vs 5850), and safeQuery absorbs BOTH sync throws and
 * async rejections. mock.module is process-global — this file carries the full
 * mirror of every prisma model the module touches.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const taskFindUniqueMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const executionFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const queueItemFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const notificationFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const prFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const activityLogFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const transitionFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const workflowFileFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: taskFindUniqueMock },
    agentExecution: { findFirst: executionFindFirstMock },
    workflowQueueItem: { findFirst: queueItemFindFirstMock },
    notification: { findFirst: notificationFindFirstMock },
    gitHubPullRequest: { findFirst: prFindFirstMock },
    activityLog: { findFirst: activityLogFindFirstMock },
    workflowTransition: { findFirst: transitionFindFirstMock },
    workflowFile: { findFirst: workflowFileFindFirstMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { gatherSupervisorEvidence, parseWorkingDirectory, safeQuery } = await import(
  './supervisor-incident-evidence'
);

const NOW = Date.parse('2026-08-15T12:00:00.000Z');
const task = { id: 580 };

/** Emulates prisma `metadata: { contains }` against fixture notification rows. */
function notificationStore(
  rows: { type: string; metadata: string; createdAt: Date }[],
): (args: unknown) => Promise<unknown> {
  return (args: unknown) => {
    const where = (args as { where: { type: string; metadata: { contains: string } } }).where;
    const hit = rows.find(
      (r) => r.type === where.type && r.metadata.includes(where.metadata.contains),
    );
    return Promise.resolve(hit ? { createdAt: hit.createdAt } : null);
  };
}

beforeEach(() => {
  taskFindUniqueMock.mockReset().mockResolvedValue(null);
  executionFindFirstMock.mockReset().mockResolvedValue(null);
  queueItemFindFirstMock.mockReset().mockResolvedValue(null);
  notificationFindFirstMock.mockReset().mockResolvedValue(null);
  prFindFirstMock.mockReset().mockResolvedValue(null);
  activityLogFindFirstMock.mockReset().mockResolvedValue(null);
  transitionFindFirstMock.mockReset().mockResolvedValue(null);
  workflowFileFindFirstMock.mockReset().mockResolvedValue(null);
});

describe('parseWorkingDirectory', () => {
  test('extracts the claude-code cwd line and returns the raw line', () => {
    const parsed = parseWorkingDirectory(
      '[Claude Code] Starting execution\n[Claude Code] Working directory: C:\\Projects\\rapitas\\rapitas-backend\nmore',
    );
    expect(parsed).toEqual({
      cwd: 'C:\\Projects\\rapitas\\rapitas-backend',
      line: '[Claude Code] Working directory: C:\\Projects\\rapitas\\rapitas-backend',
    });
  });

  test('is provider-agnostic (any bracketed prefix)', () => {
    expect(parseWorkingDirectory('[Codex] Working directory: /home/x/repo')?.cwd).toBe(
      '/home/x/repo',
    );
  });

  test('returns null for null / empty / line-less output', () => {
    expect(parseWorkingDirectory(null)).toBeNull();
    expect(parseWorkingDirectory('')).toBeNull();
    expect(parseWorkingDirectory('[Claude Code] Starting execution')).toBeNull();
  });
});

describe('safeQuery', () => {
  test('returns the fallback on an async rejection', async () => {
    expect(await safeQuery(() => Promise.reject(new Error('db down')), 'fb')).toBe('fb');
  });

  test('returns the fallback on a SYNCHRONOUS throw (missing model)', async () => {
    const missingModel = undefined as unknown as { findFirst: () => Promise<null> };
    expect(await safeQuery(() => missingModel.findFirst(), null)).toBeNull();
  });
});

describe('gatherSupervisorEvidence', () => {
  test('maps every query into the snapshot (real 2026-08-15 incident values)', async () => {
    taskFindUniqueMock.mockResolvedValue({
      theme: { workingDirectory: 'C:\\Projects\\ime-live-converter' },
    });
    executionFindFirstMock.mockResolvedValue({
      output: '[Claude Code] Working directory: C:\\Projects\\rapitas\\rapitas-backend\nlog…',
    });
    queueItemFindFirstMock.mockResolvedValue({ completedAt: new Date(NOW), status: 'failed' });
    notificationFindFirstMock.mockImplementation(
      notificationStore([
        {
          type: 'auto_run_hang_backstop',
          metadata: '{"dedupKey":"auto_run_hang_backstop:580","themeId":3,"taskId":580}',
          createdAt: new Date(NOW - 30_000),
        },
      ]),
    );
    // PR created 57 seconds after the failure mark (task 580 / PR #7).
    prFindFirstMock.mockResolvedValue({
      createdAt: new Date(NOW + 57_000),
      prNumber: 7,
      url: 'https://github.com/takamurayuki/ime-live-converter/pull/7',
    });
    // phase_completed 8s before the backstop notification.
    transitionFindFirstMock.mockResolvedValue({
      createdAt: new Date(NOW - 38_000),
      cause: 'phase_completed:implementer',
    });
    workflowFileFindFirstMock.mockResolvedValue({
      content: '- ❌ 対象コードなし\n- ❌ 該当なし\n- ❌ 対象ファイルなし\n- [x] lint',
    });

    const ev = await gatherSupervisorEvidence(task);

    expect(ev.themeWorkingDirectory).toBe('C:\\Projects\\ime-live-converter');
    expect(ev.executionCwd).toBe('C:\\Projects\\rapitas\\rapitas-backend');
    expect(ev.executionCwdLine).toBe(
      '[Claude Code] Working directory: C:\\Projects\\rapitas\\rapitas-backend',
    );
    // Failure mark = max(queue completedAt NOW, backstop NOW-30s) = NOW.
    expect(ev.failureMarkedAtMs).toBe(NOW);
    expect(ev.failureMarkSource).toBe('WorkflowQueueItem(failed).completedAt');
    expect(ev.successArtifactAtMs).toBe(NOW + 57_000);
    expect(ev.successArtifactRef).toBe(
      'PR #7 (https://github.com/takamurayuki/ime-live-converter/pull/7)',
    );
    expect(ev.backstopAtMs).toBe(NOW - 30_000);
    expect(ev.lastProgressAtMs).toBe(NOW - 38_000);
    expect(ev.lastProgressCause).toBe('phase_completed:implementer');
    expect(ev.verifyChecklist).toEqual({
      total: 4,
      noTargetCount: 3,
      samples: ['- ❌ 対象コードなし', '- ❌ 該当なし', '- ❌ 対象ファイルなし'],
    });
  });

  test('an empty DB yields the all-null snapshot', async () => {
    const ev = await gatherSupervisorEvidence(task);
    expect(ev).toEqual({
      themeWorkingDirectory: null,
      executionCwd: null,
      executionCwdLine: null,
      failureMarkedAtMs: null,
      failureMarkSource: null,
      successArtifactAtMs: null,
      successArtifactRef: null,
      backstopAtMs: null,
      lastProgressAtMs: null,
      lastProgressCause: null,
      verifyChecklist: { total: 0, noTargetCount: 0, samples: [] },
    });
  });

  test('gate A: no theme working directory → the execution output is never fetched', async () => {
    taskFindUniqueMock.mockResolvedValue({ theme: { workingDirectory: null } });
    const ev = await gatherSupervisorEvidence(task);
    expect(executionFindFirstMock).not.toHaveBeenCalled();
    expect(ev.executionCwd).toBeNull();
  });

  test('gate A: the cwd line beyond the 4000-char head is ignored', async () => {
    taskFindUniqueMock.mockResolvedValue({
      theme: { workingDirectory: 'C:\\Projects\\ime-live-converter' },
    });
    executionFindFirstMock.mockResolvedValue({
      output: 'x'.repeat(4000) + '\n[Claude Code] Working directory: C:\\elsewhere',
    });
    const ev = await gatherSupervisorEvidence(task);
    expect(ev.executionCwd).toBeNull();
  });

  test('gate B: no failure mark → success-artifact queries are never run', async () => {
    const ev = await gatherSupervisorEvidence(task);
    expect(prFindFirstMock).not.toHaveBeenCalled();
    expect(activityLogFindFirstMock).not.toHaveBeenCalled();
    expect(ev.successArtifactAtMs).toBeNull();
  });

  test('gate C: no backstop notification → the progress transition is never queried', async () => {
    queueItemFindFirstMock.mockResolvedValue({ completedAt: new Date(NOW), status: 'failed' });
    const ev = await gatherSupervisorEvidence(task);
    expect(transitionFindFirstMock).not.toHaveBeenCalled();
    expect(ev.lastProgressAtMs).toBeNull();
  });

  // プレモーテム2: the closing quote is what stops task 585 matching task 5850.
  test('backstop dedup match is quote-anchored: task 585 does NOT match a task-5850 notification', async () => {
    notificationFindFirstMock.mockImplementation(
      notificationStore([
        {
          type: 'auto_run_hang_backstop',
          metadata: '{"dedupKey":"auto_run_hang_backstop:5850","themeId":3,"taskId":5850}',
          createdAt: new Date(NOW),
        },
      ]),
    );
    const ev585 = await gatherSupervisorEvidence({ id: 585 });
    expect(ev585.backstopAtMs).toBeNull();

    const ev5850 = await gatherSupervisorEvidence({ id: 5850 });
    expect(ev5850.backstopAtMs).toBe(NOW);
  });

  test('falls back to the auto_pr_created activity log when no PR row is linked', async () => {
    queueItemFindFirstMock.mockResolvedValue({ completedAt: new Date(NOW), status: 'cancelled' });
    activityLogFindFirstMock.mockResolvedValue({ createdAt: new Date(NOW + 45_000) });
    const ev = await gatherSupervisorEvidence(task);
    expect(ev.failureMarkSource).toBe('WorkflowQueueItem(cancelled).completedAt');
    expect(ev.successArtifactAtMs).toBe(NOW + 45_000);
    expect(ev.successArtifactRef).toBe('ActivityLog(auto_pr_created)');
  });

  test('a notification-only failure mark resolves its source label', async () => {
    notificationFindFirstMock.mockImplementation(
      notificationStore([
        {
          type: 'auto_run_task_skipped',
          metadata: '{"dedupKey":"auto_run_task_skipped:580","themeId":3,"taskId":580}',
          createdAt: new Date(NOW),
        },
      ]),
    );
    const ev = await gatherSupervisorEvidence(task);
    expect(ev.failureMarkedAtMs).toBe(NOW);
    expect(ev.failureMarkSource).toBe('Notification(auto_run_task_skipped)');
  });

  test('one failing query degrades to partial evidence without aborting the rest', async () => {
    // task.findUnique throws SYNCHRONOUSLY (worst case: missing model member).
    taskFindUniqueMock.mockImplementation(() => {
      throw new Error('model missing');
    });
    queueItemFindFirstMock.mockResolvedValue({ completedAt: new Date(NOW), status: 'failed' });
    const ev = await gatherSupervisorEvidence(task);
    expect(ev.themeWorkingDirectory).toBeNull();
    // The queue-item query still contributed its failure mark.
    expect(ev.failureMarkedAtMs).toBe(NOW);
  });
});
