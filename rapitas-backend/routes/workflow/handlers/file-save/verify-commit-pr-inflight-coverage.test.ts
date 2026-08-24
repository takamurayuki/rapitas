/**
 * verify-commit-pr in-flight coverage テスト
 *
 * runVerifyCommitPrCompletion が registerVerifyCompletion に渡す Promise が、
 * commit/PR の初回試行だけでなく、履歴汚染リカバリ・再試行・完了ゲートを含む
 * パイプライン全体（runVerifyCommitPrPipeline の戻り値）であることを固定する
 * 回帰テスト。
 *
 * task 657: 旧実装は初回の performAutoCommitAndPR 呼び出しだけを登録しており、
 * その await が解決した時点（＝リカバリ・再試行が始まる前）で in-flight 登録が
 * 解除されていた。タスク653はリカバリ・再試行を含め verify_done から145秒後に
 * PR作成が完了したが、waitForVerifyCompletion は66秒時点で
 * hasVerifyCompletionInFlight()=false を観測し「ブロック」と誤通知した。
 * ここでは REAL の verify-completion-inflight レジストリを使い、パイプライン
 * (モック) が解決するまで hasVerifyCompletionInFlight が true を維持することを
 * 直接検証する。
 */
import { describe, expect, test, mock } from 'bun:test';

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

mock.module('../../../../config', () => ({
  prisma: {
    task: { updateMany: mock(() => Promise.resolve({ count: 1 })) },
  },
}));

mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mock(() => Promise.resolve()),
}));

interface PipelineOutcome {
  newStatus?: string;
  taskMarkedDone: boolean;
  autoCommitPRResult: Record<string, unknown>;
}

// Stands in for the recovery+retry work still running when the runner would
// otherwise poll for completion — resolved manually from the test body.
let resolvePipeline: ((outcome: PipelineOutcome) => void) | null = null;
const runVerifyCommitPrPipelineMock = mock(
  () =>
    new Promise<PipelineOutcome>((resolve) => {
      resolvePipeline = resolve;
    }),
);
mock.module('./verify-commit-pr-pipeline', () => ({
  runVerifyCommitPrPipeline: runVerifyCommitPrPipelineMock,
}));

// NOTE: verify-completion-inflight is intentionally NOT mocked — this test
// exercises the real registry to prove hasVerifyCompletionInFlight() actually
// observes the pipeline's lifetime.
const { runVerifyCommitPrCompletion } = await import('./verify-commit-pr');
const { hasVerifyCompletionInFlight, resetVerifyCompletionRegistry } =
  await import('../../../../services/workflow/verify-completion-inflight');

function buildParams(taskId: number) {
  return {
    taskId,
    fileType: 'verify' as const,
    newStatus: 'verify_done',
    verifyGateBlocked: false,
    staleVerifyRequest: false,
    isConflictResolutionTask: false,
    conflictTask: null,
    savedContent: '# 検証結果',
    preferredBaseBranchForVerify: null,
  };
}

describe('runVerifyCommitPrCompletion — in-flight はパイプライン全体をカバーする', () => {
  test('リカバリ・再試行に相当するパイプライン未解決の間 hasVerifyCompletionInFlight が true を維持すること', async () => {
    resetVerifyCompletionRegistry();
    const taskId = 657;

    const completion = runVerifyCommitPrCompletion(buildParams(taskId));

    // registerVerifyCompletion runs synchronously before the pipeline Promise
    // is awaited — a couple of microtask ticks are enough to reach it.
    await Promise.resolve();
    await Promise.resolve();

    expect(hasVerifyCompletionInFlight(taskId)).toBe(true);

    resolvePipeline?.({ newStatus: 'completed', taskMarkedDone: true, autoCommitPRResult: {} });
    const result = await completion;

    expect(result.taskMarkedDone).toBe(true);
    expect(result.newStatus).toBe('completed');
    expect(hasVerifyCompletionInFlight(taskId)).toBe(false);
  });

  test('パイプラインが例外を投げても in-flight 登録が解除されること', async () => {
    resetVerifyCompletionRegistry();
    const taskId = 658;
    runVerifyCommitPrPipelineMock.mockImplementationOnce(() =>
      Promise.reject(new Error('pipeline threw')),
    );

    await expect(runVerifyCommitPrCompletion(buildParams(taskId))).rejects.toThrow(
      'pipeline threw',
    );
    expect(hasVerifyCompletionInFlight(taskId)).toBe(false);
  });
});
