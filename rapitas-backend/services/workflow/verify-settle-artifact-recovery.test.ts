/**
 * verify-settle-artifact-recovery.test
 *
 * Task 660: before the runner declares a `verify_done` task stuck, a PR already
 * on record must complete the task instead of blocking it — and nothing else
 * may (no PR, a lost compare-and-swap, or any DB error all yield false so the
 * caller keeps its normal `stuck` verdict).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
const policy = mock(async () => ({ autoMergePR: false }));
mock.module('./automation-policy', () => ({
  resolveAutomationPolicy: policy,
  resolveLandingMode: (p: {
    autoMergePR?: boolean;
    autoCreatePR?: boolean;
    autoCommit?: boolean;
  }) => {
    if (p.autoMergePR) return 'merge';
    if (p.autoCreatePR) return 'pr';
    if (p.autoCommit) return 'commit';
    return 'none';
  },
  isStagedCompletionEnabled: () =>
    process.env.RAPITAS_STAGED_COMPLETION !== 'false' &&
    process.env.RAPITAS_STAGED_COMPLETION !== '0',
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const findFirstPrMock = mock((): Promise<{ id: number } | null> => Promise.resolve(null));
const findUniqueTaskMock = mock(
  (): Promise<{ githubPrId: number | null } | null> => Promise.resolve(null),
);
const updateManyMock = mock(
  (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
    Promise.resolve({ count: 1 }),
);

mock.module('../../config', () => ({
  prisma: {
    gitHubPullRequest: { findFirst: findFirstPrMock },
    task: { findUnique: findUniqueTaskMock, updateMany: updateManyMock },
  },
}));

const recordTransitionMock = mock((_input: { cause: string; metadata?: unknown }) =>
  Promise.resolve(),
);
mock.module('./transition-recorder', () => ({ recordTransition: recordTransitionMock }));

const { recoverFromLandedArtifact, isAwaitingStagedPrCompletion } =
  await import('./verify-settle-artifact-recovery');

describe('recoverFromLandedArtifact', () => {
  test('PR existence does not complete a task requiring merge', async () => {
    policy.mockResolvedValue({ autoMergePR: true });
    findFirstPrMock.mockResolvedValue({ id: 458 });
    expect(await recoverFromLandedArtifact(658)).toBe(false);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    policy.mockReset().mockResolvedValue({ autoMergePR: false });
    findFirstPrMock.mockReset();
    findUniqueTaskMock.mockReset();
    updateManyMock.mockReset();
    recordTransitionMock.mockReset();
    findFirstPrMock.mockImplementation(() => Promise.resolve(null));
    findUniqueTaskMock.mockImplementation(() => Promise.resolve(null));
    updateManyMock.mockImplementation(() => Promise.resolve({ count: 1 }));
    recordTransitionMock.mockImplementation(() => Promise.resolve());
  });

  test('① GitHubPullRequest に紐づくPRがある → true、Task行を verify_done→completed に CAS 更新して遷移を記録する', async () => {
    findFirstPrMock.mockImplementation(() => Promise.resolve({ id: 458 }));

    await expect(recoverFromLandedArtifact(658)).resolves.toBe(true);

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const args = updateManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      id: 658,
      workflowStatus: 'verify_done',
      status: { in: ['todo', 'in-progress', 'in_progress'] },
    });
    expect(args.data).toMatchObject({ status: 'done', workflowStatus: 'completed' });
    expect(args.data.completedAt).toBeInstanceOf(Date);
    // linkedTaskId hit means the githubPrId fallback is never consulted.
    expect(findUniqueTaskMock).not.toHaveBeenCalled();
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    expect(recordTransitionMock.mock.calls[0][0]).toMatchObject({
      cause: 'verify_settle_artifact_recovered',
      metadata: { prSource: 'linked_pr', prRef: 458 },
    });
  });

  test('② Task.githubPrId のみある → true（フォールバック経路）', async () => {
    findUniqueTaskMock.mockImplementation(() => Promise.resolve({ githubPrId: 7 }));

    await expect(recoverFromLandedArtifact(580)).resolves.toBe(true);

    expect(findFirstPrMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(recordTransitionMock.mock.calls[0][0]).toMatchObject({
      metadata: { prSource: 'task_github_pr_id', prRef: 7 },
    });
  });

  test('③ どちらにもPRがない → false、Task行には触れない', async () => {
    await expect(recoverFromLandedArtifact(1)).resolves.toBe(false);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  test('④ CAS が0件更新（別経路で既に完了済み） → false、遷移は記録しない', async () => {
    findFirstPrMock.mockImplementation(() => Promise.resolve({ id: 458 }));
    updateManyMock.mockImplementation(() => Promise.resolve({ count: 0 }));

    await expect(recoverFromLandedArtifact(658)).resolves.toBe(false);

    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  test('⑤ PR照会が例外を投げる → false（安全側へフォールバック）', async () => {
    findFirstPrMock.mockImplementation(() => Promise.reject(new Error('db offline')));

    await expect(recoverFromLandedArtifact(658)).resolves.toBe(false);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  test('⑥ continue-execution経由でlinkAutoCreatedPrがlinkedTaskIdを設定した状態 → stuck判定せずtrue（task 951: 検出ロジック自体はリンクの発生源を区別しない）', async () => {
    // detectAndLinkContinuationPr → linkAutoCreatedPr が設定するのと同じ形の
    // GitHubPullRequest行（linkedTaskId経由）を模擬する。
    findFirstPrMock.mockImplementation(() => Promise.resolve({ id: 707 }));

    await expect(recoverFromLandedArtifact(951)).resolves.toBe(true);

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(recordTransitionMock.mock.calls[0][0]).toMatchObject({
      metadata: { prSource: 'linked_pr', prRef: 707 },
    });
  });
});

describe('isAwaitingStagedPrCompletion（task 873/948）', () => {
  let previousStaged: string | undefined;

  beforeEach(() => {
    previousStaged = process.env.RAPITAS_STAGED_COMPLETION;
    delete process.env.RAPITAS_STAGED_COMPLETION;
    policy
      .mockReset()
      .mockResolvedValue({ autoCommit: true, autoCreatePR: true, autoMergePR: false });
    findFirstPrMock.mockReset().mockImplementation(() => Promise.resolve({ id: 458 }));
    findUniqueTaskMock.mockReset().mockImplementation(() => Promise.resolve(null));
  });

  test('(a) pr モード + staged有効(既定) + PR実在 → true', async () => {
    await expect(isAwaitingStagedPrCompletion(658)).resolves.toBe(true);
  });

  test('(b) merge モード（autoMergePR）→ false', async () => {
    policy.mockResolvedValue({ autoCommit: true, autoCreatePR: true, autoMergePR: true });
    await expect(isAwaitingStagedPrCompletion(658)).resolves.toBe(false);
  });

  test('(c) commit/none モード（autoCreatePR=false）→ false', async () => {
    policy.mockResolvedValue({ autoCommit: true, autoCreatePR: false, autoMergePR: false });
    await expect(isAwaitingStagedPrCompletion(658)).resolves.toBe(false);
  });

  test('(d) staged無効（明示 false）→ false', async () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'false';
    await expect(isAwaitingStagedPrCompletion(658)).resolves.toBe(false);
  });

  test('(e) PR未実在 → false', async () => {
    findFirstPrMock.mockImplementation(() => Promise.resolve(null));
    await expect(isAwaitingStagedPrCompletion(658)).resolves.toBe(false);
  });

  afterEach(() => {
    if (previousStaged === undefined) delete process.env.RAPITAS_STAGED_COMPLETION;
    else process.env.RAPITAS_STAGED_COMPLETION = previousStaged;
  });
});
