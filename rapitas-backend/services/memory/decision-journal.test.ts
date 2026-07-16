/**
 * decision-journal テスト
 *
 * plan承認ゲート判断の記録(decider タグ埋め込み)、終端結果による較正ポリシー
 * (承認+完了=correct / 承認+失敗=wrong / 差し戻し+完了=correct /
 * 差し戻し+失敗=partial)、および人間vs自動の較正統計を検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

interface DecisionRow {
  id: number;
  decision: string;
  context: string;
  calibration: string;
  status: string;
  reviewedAt: Date | null;
}

let rows: DecisionRow[] = [];
let nextId = 1;
const updates: Array<{ id: number; data: Record<string, unknown> }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    decisionLog: {
      create: mock((args: { data: Record<string, unknown> }) => {
        const row: DecisionRow = {
          id: nextId++,
          decision: args.data.decision as string,
          context: args.data.context as string,
          calibration: 'pending',
          status: 'open',
          reviewedAt: null,
        };
        rows.push(row);
        return Promise.resolve({ id: row.id });
      }),
      findMany: mock((args: { where?: { taskId?: number; status?: string } }) => {
        let out = rows;
        if (args?.where?.status) out = out.filter((r) => r.status === args.where!.status);
        return Promise.resolve(out);
      }),
      update: mock((args: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        const row = rows.find((r) => r.id === args.where.id);
        if (row) {
          if (args.data.calibration) row.calibration = args.data.calibration as string;
          if (args.data.status) row.status = args.data.status as string;
        }
        return Promise.resolve({});
      }),
    },
  },
}));

const {
  recordPlanDecision,
  calibratePlanDecisionsForTask,
  getDecisionCalibrationStats,
  parseDecider,
} = await import('./decision-journal');

beforeEach(() => {
  rows = [];
  nextId = 1;
  updates.length = 0;
});

describe('parseDecider', () => {
  test('extracts the decider tag; untagged rows default to user', () => {
    expect(parseDecider('タスク#5 のplan承認ゲート [decidedBy:auto]')).toBe('auto');
    expect(parseDecider('タスク#5 のplan承認ゲート [decidedBy:user]')).toBe('user');
    expect(parseDecider('古い形式のcontext')).toBe('user');
    expect(parseDecider(null)).toBe('user');
  });
});

describe('recordPlanDecision', () => {
  test('records an approval with the decider embedded in context', async () => {
    const id = await recordPlanDecision({
      taskId: 7,
      approved: true,
      decidedBy: 'auto',
      taskTitle: '[Bug] fix cache',
    });
    expect(id).toBe(1);
    expect(rows[0].decision).toBe('[plan承認] [Bug] fix cache');
    expect(parseDecider(rows[0].context)).toBe('auto');
  });

  test('records a rejection with the 差し戻し label', async () => {
    await recordPlanDecision({ taskId: 8, approved: false, decidedBy: 'user' });
    expect(rows[0].decision).toContain('[plan差し戻し]');
  });
});

describe('calibratePlanDecisionsForTask', () => {
  test('approval + completed → correct', async () => {
    await recordPlanDecision({ taskId: 1, approved: true, decidedBy: 'user' });
    const n = await calibratePlanDecisionsForTask(1, 'completed');
    expect(n).toBe(1);
    expect(rows[0].calibration).toBe('correct');
    expect(rows[0].status).toBe('reviewed');
  });

  test('approval + blocked → wrong', async () => {
    await recordPlanDecision({ taskId: 2, approved: true, decidedBy: 'auto' });
    await calibratePlanDecisionsForTask(2, 'blocked');
    expect(rows[0].calibration).toBe('wrong');
  });

  test('rejection + completed → correct / rejection + blocked → partial', async () => {
    await recordPlanDecision({ taskId: 3, approved: false, decidedBy: 'user' });
    await calibratePlanDecisionsForTask(3, 'completed');
    expect(rows[0].calibration).toBe('correct');

    await recordPlanDecision({ taskId: 4, approved: false, decidedBy: 'user' });
    await calibratePlanDecisionsForTask(4, 'blocked');
    expect(rows[1].calibration).toBe('partial');
  });

  test('already-reviewed rows are not re-calibrated', async () => {
    await recordPlanDecision({ taskId: 5, approved: true, decidedBy: 'user' });
    await calibratePlanDecisionsForTask(5, 'completed');
    updates.length = 0;
    const n = await calibratePlanDecisionsForTask(5, 'blocked');
    expect(n).toBe(0);
    expect(updates).toHaveLength(0);
  });
});

describe('getDecisionCalibrationStats', () => {
  test('aggregates precision per decider (human vs auto)', async () => {
    // user: 2 correct, 1 wrong → precision 2/3
    await recordPlanDecision({ taskId: 1, approved: true, decidedBy: 'user' });
    await calibratePlanDecisionsForTask(1, 'completed');
    await recordPlanDecision({ taskId: 2, approved: true, decidedBy: 'user' });
    await calibratePlanDecisionsForTask(2, 'completed');
    await recordPlanDecision({ taskId: 3, approved: true, decidedBy: 'user' });
    await calibratePlanDecisionsForTask(3, 'blocked');
    // auto: 1 wrong → precision 0
    await recordPlanDecision({ taskId: 4, approved: true, decidedBy: 'auto' });
    await calibratePlanDecisionsForTask(4, 'blocked');
    // pending row (uncalibrated)
    await recordPlanDecision({ taskId: 5, approved: true, decidedBy: 'auto' });

    const stats = await getDecisionCalibrationStats();
    expect(stats.byDecider.user.total).toBe(3);
    expect(stats.byDecider.user.precision).toBeCloseTo(2 / 3);
    expect(stats.byDecider.auto.total).toBe(2);
    expect(stats.byDecider.auto.pending).toBe(1);
    expect(stats.byDecider.auto.precision).toBe(0);
  });

  test('no judged rows → precision null', async () => {
    await recordPlanDecision({ taskId: 9, approved: true, decidedBy: 'user' });
    const stats = await getDecisionCalibrationStats();
    expect(stats.byDecider.user.precision).toBeNull();
  });
});
