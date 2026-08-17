/**
 * blocked-task-escalation テスト
 *
 * 1回限りエスカレーション（受入基準5）: 初回は通知+concern+遷移記録を行い、
 * blocked_escalated 遷移が既にあれば通知ゼロでスキップすること、
 * awaiting_question は通知のみ（concern 化しない）ことを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';

const recordTransition = mock(() => Promise.resolve());
const submitConcern = mock(() => Promise.resolve(1));
const resolveSelfDevelopmentThemeId = mock(() => Promise.resolve<number | null>(9));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../../services/memory/concern-backlog-service', () => ({ submitConcern }));
mock.module('../../services/workflow/self-development-theme', () => ({
  resolveSelfDevelopmentThemeId,
}));

const { escalateBlockedTask, countEscalatedBlocked } =
  await import('../../services/workflow/blocked-task-escalation');

const mockPrisma = {
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    findMany: mock(() => Promise.resolve([] as unknown[])),
  },
  task: { count: mock(() => Promise.resolve(0)) },
  notification: { create: mock(() => Promise.resolve({ id: 1 })) },
};
const createNotification = mockPrisma.notification.create;
const prisma = mockPrisma as unknown as InstanceType<typeof PrismaClient>;

const NOW = 1_800_000_000_000;
const task = { id: 597, title: 'テストタスク', themeId: 1 };

describe('escalateBlockedTask', () => {
  beforeEach(() => {
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    mockPrisma.workflowTransition.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.count.mockReset().mockResolvedValue(0);
    mockPrisma.notification.create.mockReset().mockResolvedValue({ id: 1 });
    recordTransition.mockReset().mockResolvedValue(undefined);
    submitConcern.mockReset().mockResolvedValue(1);
    resolveSelfDevelopmentThemeId.mockReset().mockResolvedValue(9);
  });

  test('初回: 通知 + concern + blocked_escalated 遷移を記録し true', async () => {
    const did = await escalateBlockedTask(prisma, task, 'verify_repair_exhausted', NOW);

    expect(did).toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(submitConcern).toHaveBeenCalledTimes(1);
    const concern = submitConcern.mock.calls[0][0] as {
      themeId: number;
      dedupKey: string;
      originTaskId: number;
    };
    expect(concern.themeId).toBe(9); // 自己開発テーマ行き
    expect(concern.dedupKey).toBe('blocked-escalation:verify_repair_exhausted:597');
    expect(concern.originTaskId).toBe(597);
    const rt = recordTransition.mock.calls[0][0] as {
      cause: string;
      metadata: { reason: string };
    };
    expect(rt.cause).toBe('blocked_escalated');
    expect(rt.metadata.reason).toBe('verify_repair_exhausted');
  });

  test('2回目: blocked_escalated 遷移が既にある → 通知ゼロで false', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(1);

    const did = await escalateBlockedTask(prisma, task, 'retry_cap_exhausted', NOW);

    expect(did).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
    expect(submitConcern).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('awaiting_question: 通知のみ（人間の回答が必要 — concern 化しない）', async () => {
    const did = await escalateBlockedTask(prisma, task, 'awaiting_question', NOW);

    expect(did).toBe(true);
    expect(submitConcern).not.toHaveBeenCalled();
    const n = createNotification.mock.calls[0][0] as {
      data: { type: string; message: string };
    };
    expect(n.data.type).toBe('blocked_escalation_needs_answer');
    expect(n.data.message).toContain('回答');
    expect(recordTransition).toHaveBeenCalledTimes(1);
  });

  test('verify_no_convergence + detail: 通知 message に「どの基準が何回」を含む（task 619 受入基準5）', async () => {
    const detail =
      '受入基準1が2回の差し戻しで一度も対応されていません。タスク分割または仕様の見直しが必要です。';

    const did = await escalateBlockedTask(prisma, task, 'verify_no_convergence', NOW, detail);

    expect(did).toBe(true);
    const n = createNotification.mock.calls[0][0] as {
      data: { type: string; message: string };
    };
    expect(n.data.type).toBe('blocked_escalation');
    expect(n.data.message).toContain('受入基準1');
    expect(n.data.message).toContain('2回');
    expect(n.data.message).toContain('タスク分割または仕様の見直し');
    // concern 側 detail にも同じ根拠が入ること
    expect(submitConcern).toHaveBeenCalledTimes(1);
    const concern = submitConcern.mock.calls[0][0] as { detail: string; dedupKey: string };
    expect(concern.detail).toContain('受入基準1');
    expect(concern.detail).toContain('2回');
    expect(concern.dedupKey).toBe('blocked-escalation:verify_no_convergence:597');
    const rt = recordTransition.mock.calls[0][0] as { metadata: { reason: string } };
    expect(rt.metadata.reason).toBe('verify_no_convergence');
  });

  test('detail 省略時は従来どおりの message になる（後方互換）', async () => {
    const did = await escalateBlockedTask(prisma, task, 'verify_repair_exhausted', NOW);

    expect(did).toBe(true);
    const n = createNotification.mock.calls[0][0] as { data: { message: string } };
    expect(n.data.message).toContain('検証修復の予算を使い切りました');
    expect(n.data.message).not.toContain('undefined');
  });

  test('idempotency 判定の DB 失敗時はエスカレーションしない（通知増殖より延期を優先）', async () => {
    mockPrisma.workflowTransition.count.mockRejectedValue(new Error('db down'));

    const did = await escalateBlockedTask(prisma, task, 'abandoned_old', NOW);

    expect(did).toBe(false);
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('通知が失敗しても遷移は記録され true（best-effort 副作用）', async () => {
    createNotification.mockRejectedValue(new Error('notify down'));

    const did = await escalateBlockedTask(prisma, task, 'abandoned_old', NOW);

    expect(did).toBe(true);
    expect(recordTransition).toHaveBeenCalledTimes(1);
  });
});

describe('countEscalatedBlocked', () => {
  beforeEach(() => {
    mockPrisma.workflowTransition.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.count.mockReset().mockResolvedValue(0);
  });

  test('blocked_escalated 済みかつ現在も blocked の件数を返す', async () => {
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { taskId: 597 },
      { taskId: 600 },
      { taskId: null },
    ]);
    mockPrisma.task.count.mockResolvedValue(2);

    const n = await countEscalatedBlocked(prisma);

    expect(n).toBe(2);
    const arg = mockPrisma.task.count.mock.calls[0][0] as {
      where: { id: { in: number[] }; status: string };
    };
    expect(arg.where.id.in).toEqual([597, 600]);
    expect(arg.where.status).toBe('blocked');
  });

  test('エスカレーション記録が無ければ 0（task.count を呼ばない）', async () => {
    const n = await countEscalatedBlocked(prisma);

    expect(n).toBe(0);
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
  });
});
