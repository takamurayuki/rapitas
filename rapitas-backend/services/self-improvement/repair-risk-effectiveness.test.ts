/**
 * repair-risk-effectiveness unit tests
 *
 * MTTR burst handling (censored bursts excluded), cohort split (fired vs
 * mid/high-complexity not-fired), lowSample flag, deltas, and the DB wiring of
 * computeRepairRiskEffectiveness. prisma is stubbed (run in isolation).
 */
import { describe, test, expect, mock } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const transitionFindMany = mock((_a: unknown) => Promise.resolve([] as unknown[]));
const activityFindMany = mock((_a: unknown) => Promise.resolve([] as unknown[]));
const taskFindMany = mock((_a: unknown) => Promise.resolve([] as unknown[]));
mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: { findMany: transitionFindMany },
    activityLog: { findMany: activityFindMany },
    task: { findMany: taskFindMany },
    agentExecution: { findMany: mock(() => Promise.resolve([])) },
  },
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));

const { taskMttrMinutes, compareCohorts, computeRepairRiskEffectiveness } =
  await import('./repair-risk-effectiveness');
const { allTroubleCauses } = await import('../workflow/learning/repair-risk-model');

const TROUBLE = allTroubleCauses();
const at = (min: number) => new Date(Date.UTC(2026, 8, 1, 0, min));
const row = (taskId: number, cause: string, min: number) => ({ taskId, cause, createdAt: at(min) });

describe('taskMttrMinutes', () => {
  test('連続する差し戻しは1バーストとして最初の差し戻しから計測する', () => {
    const rows = [
      row(1, 'file_saved:verify', 0),
      row(1, 'verify_repair', 10),
      row(1, 'verify_repair', 20),
      row(1, 'file_saved:verify', 40),
    ];
    expect(taskMttrMinutes(rows, TROUBLE)).toBe(30);
  });

  test('複数バーストはタスク内で平均する', () => {
    const rows = [
      row(1, 'plan_critic_failed', 0),
      row(1, 'file_saved:plan', 10),
      row(1, 'ci_repair', 20),
      row(1, 'auto_advance', 50),
    ];
    expect(taskMttrMinutes(rows, TROUBLE)).toBe(20);
  });

  test('復帰行が無い未解決バーストは除外（0分扱いしない）', () => {
    expect(taskMttrMinutes([row(1, 'verify_repair', 5)], TROUBLE)).toBeNull();
    const rows = [
      row(1, 'verify_repair', 0),
      row(1, 'file_saved:verify', 10),
      row(1, 'ci_repair', 20),
    ];
    expect(taskMttrMinutes(rows, TROUBLE)).toBe(10);
  });
});

describe('compareCohorts', () => {
  const transitions = [
    // fired: task 1 bounced then recovered in 10 min, task 2 clean
    row(1, 'verify_repair', 0),
    row(1, 'file_saved:verify', 10),
    row(2, 'file_saved:verify', 0),
    // not fired, mid complexity: task 3 bounced (30 min), task 4 bounced, unresolved
    row(3, 'verify_repair', 0),
    row(3, 'file_saved:verify', 30),
    row(4, 'verify_repair', 0),
    // low complexity, not fired → excluded
    row(5, 'verify_repair', 0),
    // complexity unknown → excluded
    row(6, 'verify_repair', 0),
  ];
  const complexity = new Map<number, number | null>([
    [1, 80],
    [2, 70],
    [3, 50],
    [4, 90],
    [5, 10],
    [6, null],
  ]);

  test('発火群/非発火群の分割・差し戻し率・MTTR・差分', () => {
    const r = compareCohorts(
      { transitions, firedTaskIds: new Set([1, 2]), complexityByTask: complexity },
      8,
      90,
    );
    expect(r.windowDays).toBe(90);
    expect(r.fired).toMatchObject({
      sampleSize: 2,
      repairRate: 0.5,
      mttrMinutes: 10,
      mttrSampleSize: 1,
    });
    // task 4 is unresolved → counted in repairRate but not in MTTR
    expect(r.notFired).toMatchObject({
      sampleSize: 2,
      repairRate: 1,
      mttrMinutes: 30,
      mttrSampleSize: 1,
    });
    expect(r.delta).toEqual({ repairRateDelta: -0.5, mttrMinutesDelta: -20 });
  });

  test('サンプル不足は lowSample=true で数値は隠さない', () => {
    const r = compareCohorts(
      { transitions, firedTaskIds: new Set([1]), complexityByTask: complexity },
      2,
      30,
    );
    expect(r.fired.lowSample).toBe(true);
    expect(r.fired.repairRate).toBe(1);
    expect(r.notFired.lowSample).toBe(false);
  });

  test('片方に MTTR が無ければ差分は null', () => {
    const r = compareCohorts(
      {
        transitions: [row(1, 'file_saved:plan', 0)],
        firedTaskIds: new Set([1]),
        complexityByTask: complexity,
      },
      8,
      90,
    );
    expect(r.notFired.sampleSize).toBe(0);
    expect(r.delta.mttrMinutesDelta).toBeNull();
    expect(r.delta.repairRateDelta).toBe(0);
  });
});

describe('computeRepairRiskEffectiveness', () => {
  test('ActivityLog の予測記録で発火群を決める', async () => {
    transitionFindMany.mockResolvedValue([row(1, 'verify_repair', 0), row(1, 'auto_advance', 6)]);
    activityFindMany.mockResolvedValue([{ taskId: 1 }, { taskId: null }]);
    taskFindMany.mockResolvedValue([{ id: 1, complexityScore: 80 }]);
    const r = await computeRepairRiskEffectiveness(90);
    expect(r.fired).toMatchObject({ sampleSize: 1, mttrMinutes: 6 });
    const where = (activityFindMany.mock.calls[0]![0] as { where: { action: string } }).where;
    expect(where.action).toBe('repair_risk_predicted');
  });
});
