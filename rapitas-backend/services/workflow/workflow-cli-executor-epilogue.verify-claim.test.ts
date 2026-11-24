/**
 * CLI エピローグから実測取得・同期バリデータまでの接続を検査する。
 * 検証対象のエピローグ、ヘルパー、ローダー、バリデータは実装をそのまま使う。
 */
import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { MeasuredJob } from './verify-claim';
import type { ValidationResult } from './phase-output-validator';

const TASK_ID = 1542;
const RUN_ID = 'cli-verify-run';
const SHA = 'a1b2c3d4e5f6';
const PLAN = '# 実装計画\n\n## 実装チェックリスト\n- [ ] 実測との照合';
const report = `# 検証レポート

## 検証結果サマリ
✅ 検証成功。全テスト通過。

## テスト結果
| 初回実行 | exit 1 | 原因を直して再実行 |
| RED 確認 | 修正を外すと9件失敗 | 想定どおり |
| 環境 | 環境に拒否され別経路で実行 | 完了 |

## チェックリスト
- ✅ 実装

\`\`\`json:verify-claim
${JSON.stringify({ version: 1, overall: 'success', runId: RUN_ID, sha: SHA, tests: { ran: true, failed: 0 } })}
\`\`\`
`;
const measuredJob: MeasuredJob = {
  status: 'completed',
  ok: true,
  unverifiable: false,
  revision: SHA,
  checks: [{ name: 'test', ran: true, errorCount: 0 }],
};

const getJobByRunId = mock(
  async (_taskId: number, _runId: string): Promise<MeasuredJob | null> => measuredJob,
);
const resolveVerifyPhaseStatus = mock(
  async (_params: { validation: ValidationResult }) => 'in_progress' as const,
);
mock.module('../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: async () => undefined,
}));
mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: async () => report,
  writeWorkflowFile: mock(async () => undefined),
  extractMarkdownFromOutput: () => null,
}));
mock.module('./verify-review-pending', () => ({
  resolveSettledWorkflowState: async () => ({ workflowStatus: 'in_progress' }),
}));
mock.module('./requirement-replan-guard', () => ({
  requirementReplannedSince: async () => false,
}));
mock.module('./transition-recorder', () => ({ recordTransition: mock(async () => undefined) }));
mock.module('./workflow-invariants', () => ({ checkWorkflowInvariants: async () => [] }));
mock.module('./plan-auto-approve', () => ({
  maybeAutoApprovePlan: async () => ({ approved: false }),
}));
mock.module('./plan-for-verify', () => ({ loadPlanContentForVerify: async () => PLAN }));
mock.module('./verification-job-store', () => ({ getJobByRunId }));
mock.module('./workflow-cli-executor-verify-gate', () => ({ resolveVerifyPhaseStatus }));

// 呼び出しは記録するが、判定は実バリデータに任せる。
const validators = await import('./phase-output-validator');
const validateVerify = spyOn(validators, 'validateVerify');
const { runPhaseEpilogue } = await import('./workflow-cli-executor-epilogue');

const run = () =>
  runPhaseEpilogue({
    taskId: TASK_ID,
    transition: { role: 'verifier', outputFile: 'verify', nextStatus: 'completed' },
    session: { id: 42 },
    result: { success: true, output: '' },
    resolvedWorktreePath: null,
    language: 'ja',
    phaseStartedAt: new Date(),
  });

describe('CLI エピローグの verify-claim 接続（F7）', () => {
  beforeEach(() => {
    getJobByRunId.mockReset().mockResolvedValue(measuredJob);
    validateVerify.mockClear();
    resolveVerifyPhaseStatus.mockClear();
  });

  test('主張した runId の実測を validateVerify 第3引数へ渡してから完了ゲートを呼ぶ', async () => {
    await run();

    expect(getJobByRunId).toHaveBeenCalledWith(TASK_ID, RUN_ID);
    expect(validateVerify).toHaveBeenCalledWith(report, PLAN, { job: measuredJob });
    expect(resolveVerifyPhaseStatus).toHaveBeenCalledWith(
      expect.objectContaining({ validation: expect.objectContaining({ ok: true }) }),
    );
  });

  test('ジョブが存在しなければ実際の差し戻し結果を完了ゲートへ渡す', async () => {
    getJobByRunId.mockResolvedValueOnce(null);
    await run();

    expect(validateVerify).toHaveBeenCalledWith(report, PLAN, { job: null });
    expect(resolveVerifyPhaseStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        validation: expect.objectContaining({
          ok: false,
          summary: expect.stringContaining('job-missing'),
        }),
      }),
    );
  });

  test('取得例外でもエラー情報を第3引数へ残して差し戻す', async () => {
    getJobByRunId.mockRejectedValueOnce(new Error('検証ジョブの読み取り失敗'));
    await run();

    expect(validateVerify).toHaveBeenCalledWith(report, PLAN, {
      job: null,
      fetchError: '検証ジョブの読み取り失敗',
    });
    expect(resolveVerifyPhaseStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        validation: expect.objectContaining({
          ok: false,
          summary: expect.stringContaining('読み取り失敗'),
        }),
      }),
    );
  });

  test('非同期の実測取得が終わるまでバリデータと完了ゲートへ進まない', async () => {
    let resolveLookup!: (job: MeasuredJob | null) => void;
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const lookupResult = new Promise<MeasuredJob | null>((resolve) => {
      resolveLookup = resolve;
    });
    getJobByRunId.mockImplementationOnce(() => {
      markLookupStarted();
      return lookupResult;
    });

    const pending = run();
    await lookupStarted;
    expect(validateVerify).not.toHaveBeenCalled();
    expect(resolveVerifyPhaseStatus).not.toHaveBeenCalled();
    resolveLookup(measuredJob);
    await pending;
    expect(validateVerify).toHaveBeenCalledWith(report, PLAN, { job: measuredJob });
  });
});
