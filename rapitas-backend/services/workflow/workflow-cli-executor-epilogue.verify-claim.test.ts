/**
 * CLI エピローグから実測取得・同期バリデータまでの接続を検査する。
 * 検証対象のエピローグ、ヘルパー、ローダー、バリデータは実装をそのまま使う。
 */
import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { replanSnapshotDigest } from './requirement-replan-evidence';
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
${JSON.stringify({ version: 1, overall: 'success', runId: RUN_ID, sha: SHA, tests: { ran: true, failed: 0, passed: 42 } })}
\`\`\`
`;
const measuredJob: MeasuredJob = {
  status: 'completed',
  ok: true,
  unverifiable: false,
  revision: SHA,
  checks: [{ name: 'test', ran: true, ok: true, errorCount: 0, passedCount: 42 }],
};

const getJobByRunId = mock(
  async (_taskId: number, _runId: string): Promise<MeasuredJob | null> => measuredJob,
);
// Isolated SQLite for the real completion gate's stop guard (never the operational DB).
const db = new PrismaClient({
  datasources: {
    db: {
      url:
        'file:' +
        join(mkdtempSync(join(tmpdir(), 'rapitas-cli-claim-')), 't.db').replaceAll('\\', '/'),
    },
  },
});
mock.module('../../config/database', () => ({
  prisma: db,
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
// Mirrors every runtime export: the real completion gate imports this module too.
mock.module('./verification-job-store', () => ({
  PROCESS_INSTANCE_ID: 'test-process',
  STALE_RUNNING_MS: 30 * 60 * 1000,
  getJobByRunId,
  getLatestJob: async () => null,
  recordJobStart: async () => undefined,
  recordJobFinish: async () => undefined,
}));

// 呼び出しは記録するが、判定は実バリデータに任せる。
const validators = await import('./phase-output-validator');
const validateVerify = spyOn(validators, 'validateVerify');
// The completion gate is spied, not replaced: the C3 test below runs the real one.
const gateModule = await import('./workflow-cli-executor-verify-gate');
const realGate = gateModule.resolveVerifyPhaseStatus;
const resolveVerifyPhaseStatus = spyOn(gateModule, 'resolveVerifyPhaseStatus');
const reviewModule = await import('./requirement-replan-review');
// Only the external LLM call is replaced; every lifecycle/stop guard stays real.
spyOn(reviewModule, 'reviewRequirementReplan').mockImplementation(async (snapshot) => ({
  snapshotDigest: replanSnapshotDigest(snapshot),
  durationMs: 1,
  tokensUsed: 0,
  modelName: null,
  verdict: { kind: 'no_mismatch', reason: 'matching requirements' },
}));
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
    resolveVerifyPhaseStatus
      .mockClear()
      .mockImplementation(async (_params: { validation: ValidationResult }) => 'in_progress');
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

  test('control: without a stop the real gate gets past the stop guard (C3)', async () => {
    await createGateSchema();
    resolveVerifyPhaseStatus.mockImplementation(realGate);
    const outcome = await run().catch((err: unknown) => err);
    // Whatever the later gates decide, the stop guard is not what ends this run.
    const message = outcome instanceof Error ? outcome.message : JSON.stringify(outcome);
    expect(message).not.toContain('stop_not_resumed');
    expect(resolveVerifyPhaseStatus).toHaveBeenCalledTimes(1);
  });

  test('a stop recorded during the measured-job lookup is refused by the real gate (C3)', async () => {
    await createGateSchema();
    // The durable stop intent lands while the lookup is in flight.
    getJobByRunId.mockImplementationOnce(async () => {
      await db.$executeRawUnsafe(
        "INSERT INTO WorkflowTransition (taskId, actor, cause, createdAt) VALUES (?, 'system', 'theme_stop_execution_requested', ?)",
        TASK_ID,
        new Date(),
      );
      return measuredJob;
    });
    resolveVerifyPhaseStatus.mockImplementation(realGate);
    const outcome = await run().catch((err: unknown) => err);
    // The production stop guard (requirement replan lifecycle) refuses, not a test double.
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('stop_not_resumed');
    expect(resolveVerifyPhaseStatus).toHaveBeenCalledTimes(1);
    // Nothing moved the task forward after the stop: no completion, no admitted verify.
    expect(
      await db.task.findUnique({
        where: { id: TASK_ID },
        select: { status: true, workflowStatus: true },
      }),
    ).toEqual({ status: 'in-progress', workflowStatus: 'in_progress' });
    expect(
      await db.workflowTransition.count({
        where: { taskId: TASK_ID, cause: { in: ['verify_passed', 'verify_review_admitted'] } },
      }),
    ).toBe(0);
  });
});

/** Minimal tables the real completion gate and its stop guard read. */
async function createGateSchema(): Promise<void> {
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS Task (workspaceId INTEGER, id INTEGER PRIMARY KEY, title TEXT, description TEXT, goals TEXT, constraints TEXT, acceptanceCriteria TEXT, status TEXT, workflowStatus TEXT, workflowMode TEXT, updatedAt DATETIME, themeId INTEGER, parentId INTEGER, completedAt DATETIME, githubPrId INTEGER)',
    'CREATE TABLE IF NOT EXISTS WorkflowFile (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER, fileType TEXT, content TEXT, UNIQUE(taskId,fileType))',
    'CREATE TABLE IF NOT EXISTS WorkflowModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, mode TEXT, stepDefinitions TEXT)',
    'CREATE TABLE IF NOT EXISTS DeveloperModeConfig (workspaceId INTEGER, id INTEGER PRIMARY KEY, taskId INTEGER)',
    'CREATE TABLE IF NOT EXISTS AgentSession (workspaceId INTEGER, id INTEGER PRIMARY KEY, configId INTEGER)',
    "CREATE TABLE IF NOT EXISTS AgentExecution (workspaceId INTEGER, id INTEGER PRIMARY KEY, command TEXT NOT NULL DEFAULT 'execute', sessionId INTEGER, status TEXT, startedAt DATETIME)",
    'CREATE TABLE IF NOT EXISTS ThemeAutoRun (workspaceId INTEGER, id INTEGER PRIMARY KEY, themeId INTEGER UNIQUE, status TEXT)',
    'CREATE TABLE IF NOT EXISTS WorkflowTransition (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, fromStatus TEXT, toStatus TEXT, actor TEXT, cause TEXT, phase TEXT, executionId INTEGER, sessionId INTEGER, metadata TEXT DEFAULT "{}", invariantViolation BOOLEAN DEFAULT 0, invariantMessage TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
    'CREATE TABLE IF NOT EXISTS RequirementReviewClaim (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId INTEGER, snapshotDigest TEXT, requestKey TEXT, status TEXT, claimToken TEXT, ownerInstanceId TEXT, heartbeatAt DATETIME, resultJson TEXT, reason TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME, UNIQUE(taskId,snapshotDigest))',
    'CREATE TABLE IF NOT EXISTS RequirementReviewRetryRequest (workspaceId INTEGER, id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT UNIQUE, taskId INTEGER, consumedAt DATETIME, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)',
  ])
    await db.$executeRawUnsafe(sql);
  // Each test starts from the same rows (the tables are shared within this file).
  for (const table of ['Task', 'WorkflowFile', 'WorkflowTransition', 'RequirementReviewClaim'])
    await db.$executeRawUnsafe('DELETE FROM ' + table);
  await db.$executeRawUnsafe(
    "INSERT INTO Task (id, title, description, goals, constraints, acceptanceCriteria, status, workflowStatus, workflowMode, updatedAt) VALUES (?, 'task', '', '[]', '[]', '[\"実測と照合する\"]', 'in-progress', 'in_progress', 'standard', ?)",
    TASK_ID,
    new Date('2026-09-08T00:00:00Z'),
  );
  await db.$executeRawUnsafe(
    "INSERT INTO WorkflowFile (id, taskId, fileType, content) VALUES (1, ?, 'plan', ?), (2, ?, 'verify', ?)",
    TASK_ID,
    PLAN,
    TASK_ID,
    report,
  );
}
