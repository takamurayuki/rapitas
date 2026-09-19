/**
 * prompt-band-evidence ユニットテスト
 *
 * resolveComplexityBand の境界値、extractVerifyComplexity の正常系/セクション
 * 無し/チェックボックス無し、computeBandEvidence のサンプル数閾値挙動
 * （0件/閾値未満/閾値ちょうど/飽和）、verify失敗率のタスク単位デデュープ、
 * DB例外時のinsufficient_dataフォールバックを検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));

interface ExecutionRow {
  executionTimeMs: number | null;
  inputTokens: number;
  taskId: number | null;
}
interface TaskRow {
  id: number;
  complexityScore: number | null;
}

let executionRows: ExecutionRow[] = [];
let taskRows: TaskRow[] = [];
let transitionTaskIds: number[] = [];
/** Transitions with an explicit timestamp, for window-boundary cases. */
let datedTransitions: { taskId: number; createdAt: Date }[] = [];
let planContentByTask = new Map<number, string>();
let agentExecutionShouldThrow = false;

const agentExecutionFindMany = mock(() => {
  if (agentExecutionShouldThrow) throw new Error('boom');
  return Promise.resolve(
    executionRows.map((r) => ({
      executionTimeMs: r.executionTimeMs,
      inputTokens: r.inputTokens,
      session: { config: { taskId: r.taskId } },
    })),
  );
});
const taskFindMany = mock((args: { where: { id: { in: number[] } } }) =>
  Promise.resolve(taskRows.filter((t) => args.where.id.in.includes(t.id))),
);
const workflowTransitionFindMany = mock(
  (args: { where: { taskId: { in: number[] }; createdAt?: { gte?: Date; lt?: Date } } }) => {
    const inWindow = (d: Date) =>
      (!args.where.createdAt?.gte || d >= args.where.createdAt.gte) &&
      (!args.where.createdAt?.lt || d < args.where.createdAt.lt);
    const all = [
      ...transitionTaskIds.map((taskId) => ({
        taskId,
        createdAt: new Date('2026-03-01T00:00:00Z'),
      })),
      ...datedTransitions,
    ];
    return Promise.resolve(
      all
        .filter((r) => args.where.taskId.in.includes(r.taskId) && inWindow(r.createdAt))
        .map(({ taskId }) => ({ taskId })),
    );
  },
);
const workflowFileFindMany = mock((args: { where: { taskId: { in: number[] } } }) =>
  Promise.resolve(
    [...planContentByTask.entries()]
      .filter(([taskId]) => args.where.taskId.in.includes(taskId))
      .map(([taskId, content]) => ({ taskId, content })),
  ),
);

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: {
    agentExecution: { findMany: agentExecutionFindMany },
    task: { findMany: taskFindMany },
    workflowTransition: { findMany: workflowTransitionFindMany },
    workflowFile: { findMany: workflowFileFindMany },
  },
}));

const {
  resolveComplexityBand,
  extractVerifyComplexity,
  computeBandEvidence,
  BAND_EVIDENCE_MIN_SAMPLES,
  _resetBandEvidenceCache,
} = await import('./prompt-band-evidence');

const RANGE = { validFrom: new Date('2026-01-01T00:00:00Z'), validUntil: null };

beforeEach(() => {
  executionRows = [];
  taskRows = [];
  transitionTaskIds = [];
  datedTransitions = [];
  planContentByTask = new Map();
  agentExecutionShouldThrow = false;
  agentExecutionFindMany.mockClear();
  taskFindMany.mockClear();
  workflowTransitionFindMany.mockClear();
  workflowFileFindMany.mockClear();
  _resetBandEvidenceCache();
});

describe('resolveComplexityBand', () => {
  test('境界値: 35以下はlight、36〜70はstandard、71以上はcomprehensive', () => {
    expect(resolveComplexityBand(0)).toBe('light');
    expect(resolveComplexityBand(35)).toBe('light');
    expect(resolveComplexityBand(36)).toBe('standard');
    expect(resolveComplexityBand(70)).toBe('standard');
    expect(resolveComplexityBand(71)).toBe('comprehensive');
    expect(resolveComplexityBand(100)).toBe('comprehensive');
  });
});

describe('extractVerifyComplexity', () => {
  test('完了条件セクション内のチェックボックス行数を数える', () => {
    const plan =
      '## 完了条件\n- [ ] item1\n- [x] item2\n- [X] item3\n\n## 別セクション\n- [ ] 対象外';
    expect(extractVerifyComplexity(plan)).toBe(3);
  });

  test('完了条件セクションが無ければ0を返す', () => {
    expect(extractVerifyComplexity('## 別のセクション\n本文のみ')).toBe(0);
  });

  test('完了条件セクションにチェックボックスが無ければ0を返す', () => {
    expect(extractVerifyComplexity('## 完了条件\n本文のみ、チェックボックス無し')).toBe(0);
  });
});

describe('computeBandEvidence', () => {
  test('タスクが0件ならinsufficientData=trueで安全値を返す', async () => {
    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.sampleSize).toBe(0);
    expect(evidence.insufficientData).toBe(true);
  });

  test(`サンプル数が閾値(${BAND_EVIDENCE_MIN_SAMPLES}件)未満ならinsufficientData=true`, async () => {
    executionRows = Array.from({ length: 3 }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.sampleSize).toBe(3);
    expect(evidence.insufficientData).toBe(true);
  });

  test(`サンプル数が閾値(${BAND_EVIDENCE_MIN_SAMPLES}件)ちょうどならinsufficientData=false`, async () => {
    executionRows = Array.from({ length: BAND_EVIDENCE_MIN_SAMPLES }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.sampleSize).toBe(BAND_EVIDENCE_MIN_SAMPLES);
    expect(evidence.insufficientData).toBe(false);
  });

  test('飽和サンプル(50件)でも正しく集計され、confidenceScoreが1に近づく', async () => {
    executionRows = Array.from({ length: 50 }, (_, i) => ({
      executionTimeMs: 6000,
      inputTokens: 500,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.sampleSize).toBe(50);
    expect(evidence.insufficientData).toBe(false);
    expect(evidence.avgExecutionTimeMs).toBe(6000);
    expect(evidence.confidenceScore).toBeGreaterThan(0.9);
  });

  test('verify失敗率はタスク単位でデデュープする(同一タスクの複数差し戻しを1件として数える)', async () => {
    executionRows = Array.from({ length: BAND_EVIDENCE_MIN_SAMPLES }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));
    // task 1 に verify_repair が3回記録されていても、失敗タスク数は1件。
    transitionTaskIds = [1, 1, 1];

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.verifyFailureRate).toBeCloseTo(1 / BAND_EVIDENCE_MIN_SAMPLES, 5);
    expect(evidence.avgIterationCount).toBeCloseTo(3 / BAND_EVIDENCE_MIN_SAMPLES, 5);
  });

  test('complexityScoreがnullのタスクは分母・分子から除外する', async () => {
    executionRows = Array.from({ length: BAND_EVIDENCE_MIN_SAMPLES }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r, i) => ({
      id: r.taskId as number,
      complexityScore: i === 0 ? null : 10,
    }));

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.sampleSize).toBe(BAND_EVIDENCE_MIN_SAMPLES - 1);
  });

  test('plan.mdの完了条件からverify複雑度の平均を算出する', async () => {
    executionRows = [1, 2].map((taskId) => ({ executionTimeMs: 1000, inputTokens: 100, taskId }));
    taskRows = [1, 2].map((id) => ({ id, complexityScore: 10 }));
    planContentByTask.set(1, '## 完了条件\n- [ ] a\n- [ ] b');
    planContentByTask.set(2, '## 完了条件\n- [ ] a');

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.avgVerifyComplexity).toBeCloseTo(1.5, 5);
  });

  test('DBクエリが例外を投げてもinsufficientDataで安全に返す', async () => {
    agentExecutionShouldThrow = true;
    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.insufficientData).toBe(true);
    expect(evidence.sampleSize).toBe(0);
  });

  test('差し戻し遷移は版の有効期間内のものだけを数える(他の版の差し戻しを混ぜない)', async () => {
    executionRows = Array.from({ length: BAND_EVIDENCE_MIN_SAMPLES }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));
    // task 1 の差し戻しが窓の前(旧版時代)と窓内に1件ずつ。窓内の1件だけが対象。
    datedTransitions = [
      { taskId: 1, createdAt: new Date('2025-12-01T00:00:00Z') },
      { taskId: 1, createdAt: new Date('2026-02-01T00:00:00Z') },
    ];

    const evidence = await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(evidence.avgIterationCount).toBeCloseTo(1 / BAND_EVIDENCE_MIN_SAMPLES, 5);
  });

  test('TTLキャッシュ: 満了後の呼び出しは再集計する', async () => {
    executionRows = Array.from({ length: BAND_EVIDENCE_MIN_SAMPLES }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));

    const realNow = Date.now;
    try {
      let now = realNow.call(Date);
      Date.now = () => now;
      await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
      const callsAfterFirst = agentExecutionFindMany.mock.calls.length;

      now += 9 * 60 * 1000; // TTL(10分)内 → キャッシュヒット
      await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
      expect(agentExecutionFindMany.mock.calls.length).toBe(callsAfterFirst);

      now += 2 * 60 * 1000; // 合計11分 → 満了して再集計
      await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
      expect(agentExecutionFindMany.mock.calls.length).toBe(callsAfterFirst + 1);
    } finally {
      Date.now = realNow;
    }
  });

  test('TTLキャッシュ: 同一キーの2回目呼び出しはDBクエリを発行しない', async () => {
    executionRows = Array.from({ length: BAND_EVIDENCE_MIN_SAMPLES }, (_, i) => ({
      executionTimeMs: 1000,
      inputTokens: 100,
      taskId: i + 1,
    }));
    taskRows = executionRows.map((r) => ({ id: r.taskId as number, complexityScore: 10 }));

    await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    const callsAfterFirst = agentExecutionFindMany.mock.calls.length;
    await computeBandEvidence('implementer', 'claude-sonnet-5', 'light', RANGE);
    expect(agentExecutionFindMany.mock.calls.length).toBe(callsAfterFirst);
  });
});
