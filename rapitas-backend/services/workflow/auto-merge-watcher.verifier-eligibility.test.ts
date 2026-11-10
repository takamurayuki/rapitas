/**
 * auto-merge-watcher.verifier-eligibility テスト
 *
 * watcher の完了経路（PR モードの CI 成功、マージモードのマージ成功）が、
 * 検証役の適格性を確認できないまま完了しないこと、マージモードでは確認できない
 * PR をマージもしないことを、実物の watcher・停止ガード・verifier-eligibility を
 * 通して固定する（G2 routing1 再レビュー3：completeTaskRow は停止状態しか見ず、
 * 適格性と先送り記録を確認していなかった）。
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('./auto-merge-checks', () => ({
  blockingChecks: () => new Set(['Lint Code']),
  evaluateAutoMergeChecks: () => 'pass',
  readPrChecks: async () => [{ name: 'Lint Code', bucket: 'pass' }],
  readMergeState: async () => 'CLEAN',
  readHeadSha: async () => 'sha-current',
  updatePrBranch: async () => true,
  readIsDraft: async () => false,
  ghPath: () => 'gh',
}));
mock.module('./auto-merge-premerge-gate', () => ({
  evaluatePreMergeGate: async () => ({ ok: true }),
  RATCHET_CHECK_NAME: 'ratchet-check',
}));
mock.module('./auto-merge-baseline-drift', () => ({ checkBaselineDrift: async () => false }));
mock.module('./auto-merge-ci-failure', () => ({ handleCiFailure: async () => undefined }));
mock.module('./ci-self-repair', () => ({
  attemptCiRepair: async () => ({ bounced: false }),
  CI_REPAIR_CAUSE: 'ci_repair',
}));
mock.module('../github/conflict-task', () => ({
  fileConflictResolutionTask: async () => ({ created: false, taskId: null }),
}));
mock.module('../github/pr-link', () => ({
  resolveIntegrationId: async () => 1,
  linkAutoCreatedPr: async () => null,
}));
mock.module('./auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: () => {},
  markExhausted: async () => undefined,
  decideTerminalState: async () => ({ terminal: false }),
  readExhaustionRecord: async () => ({ exhausted: false, headSha: null, exhaustedAt: null }),
}));
mock.module('./auto-merge-notify', () => ({ notify: async () => undefined }));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));
mock.module('../../utils/database/fail-closed-count', () => ({
  countWithFailClosed: (p: Promise<number>) => p,
}));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
mock.module('./review-hold', () => ({
  REVIEW_HOLD_RESOLVED_CAUSE: 'adversarial_review_hold_resolved',
  readReviewHold: async () => null,
  holdForHumanReview,
}));
const mergePullRequest = mock(async () => ({ success: true, mergeStrategy: 'squash' as const }));
mock.module('../agents/orchestrator/git-operations/pr/branch-pr-ops', () => ({
  mergePullRequest,
}));
const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger, logger: noopLogger }));

type Where = { session?: { mode?: unknown }; cause?: { in?: string[] } };
let verifierModel: string | null = null;
let verifierDbDown = false;
let latestVerifyCause = 'file_saved:verify';
// Routed by query: the verifier lookup filters on session.mode, the stop
// guard's latest-execution lookup does not.
const verifierLookup = mock(async () => {
  if (verifierDbDown) throw new Error('db down');
  return { modelName: verifierModel, status: 'completed', session: { mode: 'workflow-verifier' } };
});
const taskUpdateMany = mock(async (_a: unknown) => ({ count: 1 }));
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: {
    task: {
      findUnique: async () => ({ status: 'in-progress', themeId: null }),
      update: async () => ({}),
      updateMany: taskUpdateMany,
    },
    gitHubPullRequest: {
      findFirst: async () => ({ title: 'PR', headBranch: 'feature/x', baseBranch: 'develop' }),
      updateMany: async () => ({ count: 1 }),
    },
    agentExecution: {
      findFirst: async (a: { where?: Where }) =>
        a.where?.session?.mode
          ? verifierLookup()
          : { id: 9, status: 'completed', startedAt: new Date('2026-11-10T05:00:00Z') },
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowTransition: {
      count: async () => 0,
      findMany: async () => [],
      findFirst: async (a: { where?: Where }) =>
        a.where?.cause?.in?.includes('file_saved:verify') ? { cause: latestVerifyCause } : null,
    },
    themeAutoRun: { findFirst: async () => null },
  },
}));

const { AutoMergeWatcher } = await import('./auto-merge-watcher');

type Mode = 'merge' | 'pr';
const run = (mode: Mode) => {
  const w = AutoMergeWatcher.getInstance() as unknown as {
    process: (c: Record<string, unknown>, b: Set<string>) => Promise<void>;
  };
  return w.process(
    {
      taskId: 1471,
      taskTitle: 'tier table',
      prNumber: 1470,
      baseBranch: 'develop',
      cwd: '/repo',
      threshold: 0,
      completedAt: null,
      mode,
    },
    new Set(['Lint Code']),
  );
};

beforeEach(() => {
  verifierModel = 'claude-opus-5-5';
  verifierDbDown = false;
  latestVerifyCause = 'file_saved:verify';
  verifierLookup.mockClear();
  taskUpdateMany.mockClear();
  mergePullRequest.mockClear();
  holdForHumanReview.mockReset().mockResolvedValue('held');
});

describe.each(['merge', 'pr'] as const)('watcher %s モードの完了経路', (mode) => {
  test('レビューの再現：検証役の実モデル未報告 → 完了しない', async () => {
    verifierModel = null;
    await run(mode);
    expect(verifierLookup).toHaveBeenCalled();
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(holdForHumanReview.mock.calls[0]?.[0].source).toBe('merge_watcher');
  });

  test('記録の読み取り失敗＋保留書き込みも失敗 → 完了しない', async () => {
    verifierDbDown = true;
    holdForHumanReview.mockRejectedValue(new Error('hold write failed'));
    await run(mode);
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  test('不適格な検証役（Haiku）なら完了しない', async () => {
    verifierModel = 'claude-haiku-5-5';
    await run(mode);
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  test('最新の verify 保存が先送りのまま残っていれば完了しない', async () => {
    latestVerifyCause = 'verifier_eligibility_deferred';
    await run(mode);
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  test('適格と確認できれば、従来どおり完了する', async () => {
    await run(mode);
    expect(verifierLookup).toHaveBeenCalled();
    expect(taskUpdateMany).toHaveBeenCalledTimes(1);
  });
});

test('マージモードでは、適格と確認できない PR をマージもしない', async () => {
  verifierModel = null;
  await run('merge');
  expect(mergePullRequest).not.toHaveBeenCalled();
});

test('マージモードで適格なら、マージしてから完了する', async () => {
  await run('merge');
  expect(mergePullRequest).toHaveBeenCalledTimes(1);
  expect(taskUpdateMany).toHaveBeenCalledTimes(1);
});
