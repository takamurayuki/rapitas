/**
 * auto-merge-ci-failure テスト
 *
 * CI失敗ハンドリングのオーケストレーション順序を検証する:
 * BEHIND なら update-branch を1回だけ試して return（ci_repair を呼ばない）、
 * DIRTY は注入コールバックへ委譲、前回 bounce から head 不変（no-diff）は
 * markExhausted+専用通知で park、それ以外は従来どおり bounded ci_repair。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockReadMergeState = mock(() => Promise.resolve<string | null>('BLOCKED'));
const mockReadHeadSha = mock(() => Promise.resolve<string | null>('sha-current'));
const mockUpdatePrBranch = mock(() => Promise.resolve(true));
mock.module('../../services/workflow/auto-merge-checks', () => ({
  readMergeState: mockReadMergeState,
  readHeadSha: mockReadHeadSha,
  updatePrBranch: mockUpdatePrBranch,
}));

const mockAttemptCiRepair = mock(() =>
  Promise.resolve<{ bounced: boolean; attempt?: number }>({ bounced: true, attempt: 1 }),
);
mock.module('../../services/workflow/ci-self-repair', () => ({
  attemptCiRepair: mockAttemptCiRepair,
  CI_REPAIR_CAUSE: 'ci_repair',
}));

const mockMarkExhausted = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: mockMarkExhausted,
  decideTerminalState: () => Promise.resolve({ skip: false }),
}));

const mockNotify = mock(() => Promise.resolve());
mock.module('../../services/workflow/auto-merge-notify', () => ({ notify: mockNotify }));

const mockRecordTransition = mock(() => Promise.resolve());
mock.module('../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

const mockPrisma = {
  workflowTransition: {
    findMany: mock(() => Promise.resolve<{ metadata: string }[]>([])),
    findFirst: mock(() => Promise.resolve<{ metadata: string } | null>(null)),
  },
};
mock.module('../../config/database', () => ({ prisma: mockPrisma }));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { handleCiFailure, UPDATE_BRANCH_ATTEMPTED_CAUSE } =
  await import('../../services/workflow/auto-merge-ci-failure');

const candidate = {
  taskId: 556,
  taskTitle: 'test task',
  prNumber: 339,
  baseBranch: 'develop',
  cwd: '/repo',
  threshold: 0,
  completedAt: new Date(),
  mode: 'merge' as const,
};

const tryHandleConflictFalse = mock(() => Promise.resolve(false));

beforeEach(() => {
  mockReadMergeState.mockReset().mockResolvedValue('BLOCKED');
  mockReadHeadSha.mockReset().mockResolvedValue('sha-current');
  mockUpdatePrBranch.mockReset().mockResolvedValue(true);
  mockAttemptCiRepair.mockReset().mockResolvedValue({ bounced: true, attempt: 1 });
  mockMarkExhausted.mockReset().mockResolvedValue(undefined);
  mockNotify.mockReset().mockResolvedValue(undefined);
  mockRecordTransition.mockReset().mockResolvedValue(undefined);
  mockPrisma.workflowTransition.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.workflowTransition.findFirst.mockReset().mockResolvedValue(null);
  tryHandleConflictFalse.mockClear();
});

describe('handleCiFailure — 前段 update-branch (BEHIND)', () => {
  test('BEHIND+未試行 → updatePrBranch を1回実行し、ci_repair は呼ばれないこと', async () => {
    mockReadMergeState.mockResolvedValue('BEHIND');

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockUpdatePrBranch).toHaveBeenCalledTimes(1);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
    expect(tryHandleConflictFalse).not.toHaveBeenCalled();
    const rt = mockRecordTransition.mock.calls[0][0] as {
      cause: string;
      metadata: { headSha: string; ok: boolean };
    };
    expect(rt.cause).toBe(UPDATE_BRANCH_ATTEMPTED_CAUSE);
    expect(rt.metadata.headSha).toBe('sha-current');
    expect(rt.metadata.ok).toBe(true);
  });

  test('BEHIND+同一headShaで試行済み → update-branch せず ci_repair に進むこと', async () => {
    mockReadMergeState.mockResolvedValue('BEHIND');
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'sha-current', ok: true }) },
    ]);

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockUpdatePrBranch).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('BEHIND+headShaが変わっていれば再度 update-branch すること', async () => {
    mockReadMergeState.mockResolvedValue('BEHIND');
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'sha-old', ok: true }) },
    ]);

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockUpdatePrBranch).toHaveBeenCalledTimes(1);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
  });

  test('headSha が読めない場合は "unknown" キーで1回だけ試行すること', async () => {
    mockReadMergeState.mockResolvedValue('BEHIND');
    mockReadHeadSha.mockResolvedValue(null);

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockUpdatePrBranch).toHaveBeenCalledTimes(1);
    const rt = mockRecordTransition.mock.calls[0][0] as { metadata: { headSha: string } };
    expect(rt.metadata.headSha).toBe('unknown');

    // 2回目の tick: 記録済みの 'unknown' と一致し ci_repair へフォールスルー。
    mockPrisma.workflowTransition.findMany.mockResolvedValue([
      { metadata: JSON.stringify({ headSha: 'unknown', ok: true }) },
    ]);
    mockUpdatePrBranch.mockClear();
    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);
    expect(mockUpdatePrBranch).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('update-branch 自体が失敗しても return し ci_repair は呼ばれないこと', async () => {
    mockReadMergeState.mockResolvedValue('BEHIND');
    mockUpdatePrBranch.mockResolvedValue(false);

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
    const rt = mockRecordTransition.mock.calls[0][0] as { metadata: { ok: boolean } };
    expect(rt.metadata.ok).toBe(false);
  });
});

describe('handleCiFailure — DIRTY 委譲', () => {
  test('注入した tryHandleConflict が true を返すと ci_repair は呼ばれないこと', async () => {
    const tryHandleConflictTrue = mock(() => Promise.resolve(true));

    await handleCiFailure(candidate, ['Lint Code'], tryHandleConflictTrue);

    expect(tryHandleConflictTrue).toHaveBeenCalledTimes(1);
    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
    expect(mockMarkExhausted).not.toHaveBeenCalled();
  });
});

describe('handleCiFailure — no-diff 正直化', () => {
  test('前回 ci_repair の headSha と現在の head が一致 → park+専用通知、ci_repair は呼ばれないこと', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      metadata: JSON.stringify({ attempt: 1, headSha: 'sha-current' }),
    });

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockAttemptCiRepair).not.toHaveBeenCalled();
    expect(mockMarkExhausted).toHaveBeenCalledTimes(1);
    const reason = mockMarkExhausted.mock.calls[0][3] as string;
    expect(reason).toContain('no diff');
    const n = mockNotify.mock.calls[0][0] as { type: string; message: string };
    expect(n.type).toBe('auto_merge_ci_repair_no_diff');
    expect(n.message).toContain('変更なしで終了');
    expect(n.message).toContain('ローカル再現不能の可能性');
  });

  test('head が前回 bounce 後に変わっていれば通常どおり ci_repair すること', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      metadata: JSON.stringify({ attempt: 1, headSha: 'sha-old' }),
    });

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockMarkExhausted).not.toHaveBeenCalled();
    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });

  test('前回 ci_repair に headSha 記録が無ければ no-diff 検出はスキップされること', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      metadata: JSON.stringify({ attempt: 1 }),
    });

    await handleCiFailure(candidate, ['Quick Build Check'], tryHandleConflictFalse);

    expect(mockAttemptCiRepair).toHaveBeenCalledTimes(1);
  });
});

describe('handleCiFailure — 通常の ci_repair 経路', () => {
  test('bounced:true → ciContext 付きで呼ばれ、auto_merge_ci_repair を通知すること', async () => {
    mockAttemptCiRepair.mockResolvedValue({ bounced: true, attempt: 2 });

    await handleCiFailure(candidate, ['Lint Code', 'Test Backend'], tryHandleConflictFalse);

    const args = mockAttemptCiRepair.mock.calls[0] as unknown[];
    expect(args[0]).toBe(556);
    expect(args[1]).toEqual(['Lint Code', 'Test Backend']);
    expect(args[3]).toEqual({ cwd: '/repo', prNumber: 339 });
    const n = mockNotify.mock.calls[0][0] as { type: string; message: string };
    expect(n.type).toBe('auto_merge_ci_repair');
    expect(n.message).toContain('Lint Code, Test Backend');
    expect(n.message).toContain('2回目');
  });

  test('bounced:false → markExhausted+auto_merge_ci_failed を通知すること', async () => {
    mockAttemptCiRepair.mockResolvedValue({ bounced: false });

    await handleCiFailure(candidate, ['Lint Code'], tryHandleConflictFalse);

    expect(mockMarkExhausted).toHaveBeenCalledTimes(1);
    expect(mockMarkExhausted.mock.calls[0][3]).toBe('ci failed (repairs exhausted)');
    const n = mockNotify.mock.calls[0][0] as { type: string };
    expect(n.type).toBe('auto_merge_ci_failed');
  });
});
