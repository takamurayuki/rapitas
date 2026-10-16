/**
 * 承認済み再開条件が次回実行の再試行判定に反映されることの統合テスト
 *
 * 受入2: 承認前は skip、承認後は blocked_auto_retry 対象、期限切れ後は再び skip。
 * 受入4: 状態変化で resume_condition_revoked が1回だけ記録される。
 * 同期: requeueBlockedTasks と classifyBlockedExclusion が同じ解除集合で一致する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface Row {
  id: number;
  taskId: number;
  cause: string;
  createdAt: Date;
  metadata: string | null;
}
let rows: Row[] = [];
let rowClock = 0;
let nextId = 1;
let taskStatus = 'blocked';
const MAX_RETRY_PLACEHOLDER = { value: 99 };

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    findUnique: mock(() =>
      Promise.resolve({ id: 700, status: taskStatus, workflowStatus: 'draft' } as unknown),
    ),
  },
  agentExecution: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  workflowTransition: {
    count: mock((args: unknown) => {
      const w = (args as { where: { cause: string } }).where;
      return Promise.resolve(w.cause === 'blocked_auto_retry' ? MAX_RETRY_PLACEHOLDER.value : 0);
    }),
    findFirst: mock((args: unknown) => {
      const { where } = args as { where: { cause?: string | { notIn: string[] } } };
      const hit = [...rows]
        .reverse()
        .find((r) =>
          typeof where.cause === 'string'
            ? r.cause === where.cause
            : !where.cause?.notIn.includes(r.cause),
        );
      return Promise.resolve(hit ?? null);
    }),
    findMany: mock((args: unknown) => {
      const { where } = args as { where: { cause: string | { in: string[] }; taskId?: number } };
      const causes = typeof where.cause === 'string' ? [where.cause] : where.cause.in;
      const hit = rows.filter(
        (r) => causes.includes(r.cause) && (where.taskId == null || r.taskId === where.taskId),
      );
      return Promise.resolve(hit);
    }),
    create: mock((args: unknown) => {
      const { data } = args as { data: Omit<Row, 'id' | 'createdAt'> };
      rows.push({ ...data, id: nextId++, createdAt: new Date(rowClock) });
      return Promise.resolve({});
    }),
  },
  themeAutoRun: { findMany: mock(() => Promise.resolve([{ themeId: 1 }] as unknown[])) },
  userSettings: { findFirst: mock(() => Promise.resolve(null as unknown)) },
  activityLog: { findFirst: mock(() => Promise.resolve(null as unknown)) },
};
const recordTransition = mock(() => Promise.resolve());
const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));
// NOTE: Mirror ALL real exports of automation-policy (bun mock.module is process-global).
mock.module('../../services/workflow/automation-policy', () => ({
  resolveAutomationPolicy: mock(async () => ({ autoMergePR: false })),
  resolveLandingMode: () => 'none',
  isStagedCompletionEnabled: () => true,
}));

const { requeueBlockedTasks } = await import('../../services/workflow/workflow-reconciler-requeue');
const { classifyBlockedExclusion, MAX_BLOCKED_RETRY } =
  await import('../../services/workflow/blocked-task-policy');
const { approveCondition, loadResumeReleases, sweepResumeConditions, RESUME_CONDITION_TTL_MS } =
  await import('../../services/workflow/resume-condition');

const NOW = 1_800_000_000_000;
const OLD = new Date(NOW - 60 * 60 * 1000);
const TASK = { id: 700, status: 'blocked', workflowStatus: 'draft' };

function approveRetryCap(at: number) {
  rowClock = at;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HACK(agent): structural fake of the Prisma client
  return approveCondition(mockPrisma as any, {
    task: TASK,
    questionId: 'rq-700-retry_cap_exhausted-1',
    reason: 'retry_cap_exhausted',
    spec: { kind: 'boolean', value: true },
    stopMarkerId: 1,
    nowMs: at,
    source: 'ui',
  });
}

beforeEach(() => {
  MAX_RETRY_PLACEHOLDER.value = MAX_BLOCKED_RETRY;
  taskStatus = 'blocked';
  nextId = 1;
  rowClock = NOW - 1000;
  // Stop marker: the escalation row that identified this stop (id 1).
  rows = [
    {
      id: nextId++,
      taskId: 700,
      cause: 'blocked_escalated',
      createdAt: new Date(NOW - 2000),
      metadata: JSON.stringify({ reason: 'retry_cap_exhausted' }),
    },
  ];
  mockPrisma.task.findMany
    .mockReset()
    .mockResolvedValue([{ id: 700, workflowStatus: 'draft', themeId: 1, updatedAt: OLD }]);
  mockPrisma.task.update.mockReset().mockResolvedValue({});
  recordTransition.mockReset().mockResolvedValue(undefined);
});

describe('承認済み再開条件の再試行判定への反映（受入2）', () => {
  test('承認前は retry_cap_exhausted で skip、承認後は blocked_auto_retry される', async () => {
    expect(await requeueBlockedTasks(NOW)).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();

    await approveRetryCap(NOW);

    expect(await requeueBlockedTasks(NOW)).toBe(1);
    const causes = recordTransition.mock.calls.map((c) => (c[0] as { cause: string }).cause);
    expect(causes).toContain('blocked_auto_retry');
  });

  test('承認から24時間後は再び skip され、失効が revoke として1回だけ記録される', async () => {
    await approveRetryCap(NOW);
    const later = NOW + RESUME_CONDITION_TTL_MS;
    rowClock = later;

    expect(await requeueBlockedTasks(later)).toBe(0);
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    const revokes = () => rows.filter((r) => r.cause === 'resume_condition_revoked');
    expect(revokes()).toHaveLength(1);
    expect(JSON.parse(revokes()[0].metadata ?? '{}').revokedBy).toBe('expired');

    // 2回目の掃除では増えない（冪等）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HACK(agent): structural fake of the Prisma client
    expect(await sweepResumeConditions(mockPrisma as any, later)).toBe(0);
    expect(revokes()).toHaveLength(1);
  });

  test('タスクの状態が blocked でなくなると失効し revoke(state_changed) が記録される', async () => {
    await approveRetryCap(NOW);
    taskStatus = 'todo';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HACK(agent): structural fake of the Prisma client
    expect(await sweepResumeConditions(mockPrisma as any, NOW + 1)).toBe(1);
    const revoke = rows.find((r) => r.cause === 'resume_condition_revoked');
    expect(JSON.parse(revoke?.metadata ?? '{}').revokedBy).toBe('state_changed');
  });

  test('解除対象外の理由では skip のまま（pr_recovery の条件で retry_cap は解除されない）', async () => {
    rowClock = NOW;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HACK(agent): structural fake of the Prisma client
    await approveCondition(mockPrisma as any, {
      task: TASK,
      questionId: 'rq-700-pr_recovery_exhausted-1',
      reason: 'pr_recovery_exhausted',
      spec: { kind: 'boolean', value: true },
      stopMarkerId: 1,
      nowMs: NOW,
      source: 'ui',
    });
    expect(await requeueBlockedTasks(NOW)).toBe(0);
  });
});

describe('requeue と分類の同期', () => {
  test('同じ解除集合で、requeue が対象にするとき分類も retryable になる', async () => {
    const base = {
      workflowStatus: 'draft',
      ageMs: 60 * 60 * 1000,
      repairs: 0,
      verifyRepairLimit: 3,
      attempts: MAX_BLOCKED_RETRY,
    };
    expect(classifyBlockedExclusion(base)).toBe('retry_cap_exhausted');

    await approveRetryCap(NOW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HACK(agent): structural fake of the Prisma client
    const releases = await loadResumeReleases(mockPrisma as any, TASK, NOW);
    expect(classifyBlockedExclusion({ ...base, resumeReleases: releases })).toBe('retryable');
    expect(await requeueBlockedTasks(NOW)).toBe(1);
  });

  test('解除されても awaiting_question / 検証不能 / 手動是正 / 古さは除外のまま', () => {
    const base = {
      workflowStatus: 'draft',
      ageMs: 1000,
      repairs: 0,
      verifyRepairLimit: 3,
      attempts: 0,
    };
    const all = [
      'awaiting_question',
      'verification_unverifiable',
      'manual_correction_pending',
      'abandoned_old',
      'retry_cap_exhausted',
      'pr_recovery_exhausted',
      'verify_repair_exhausted',
      'verify_no_convergence',
    ] as const;
    expect(
      classifyBlockedExclusion({
        ...base,
        workflowStatus: 'awaiting_question',
        resumeReleases: all,
      }),
    ).toBe('awaiting_question');
    expect(classifyBlockedExclusion({ ...base, unverifiableHeld: true, resumeReleases: all })).toBe(
      'verification_unverifiable',
    );
    expect(
      classifyBlockedExclusion({ ...base, manualCorrectionPending: true, resumeReleases: all }),
    ).toBe('manual_correction_pending');
    expect(classifyBlockedExclusion({ ...base, ageMs: 1e12, resumeReleases: all })).toBe(
      'abandoned_old',
    );
  });
});
