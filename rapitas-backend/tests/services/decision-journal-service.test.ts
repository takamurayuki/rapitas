/**
 * decision-journal-service テスト
 * decision-journal-service.ts のビジネスロジックのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockDecisionLog = {
  findUnique: mock(() => Promise.resolve(null)),
  findMany: mock(() => Promise.resolve([])),
  create: mock(() => Promise.resolve(null)),
  update: mock(() => Promise.resolve({})),
  delete: mock(() => Promise.resolve({})),
  count: mock(() => Promise.resolve(0)),
  groupBy: mock(() => Promise.resolve([])),
};

const mockTheme = {
  findFirst: mock(() => Promise.resolve(null)),
};

const mockTask = {
  create: mock(() => Promise.resolve({ id: 100 })),
};

const mockPrisma = {
  decisionLog: mockDecisionLog,
  theme: mockTheme,
  task: mockTask,
};

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));
mock.module('../../services/task/task-mutations', () => ({
  createTask: mock(() => Promise.resolve({ id: 100 })),
}));

const service = await import('../../services/memory/decision-journal-service');
// Imported at module scope: top-level await is valid here, but not inside the
// synchronous describe() callback below where this reference is consumed.
const { createTask } = await import('../../services/task/task-mutations');
const {
  createDecision,
  listDecisions,
  getDecision,
  updateDecision,
  deleteDecision,
  getReviewDue,
  recordReview,
  getCalibrationStats,
  convertDecisionToTask,
  normalizeCalibration,
  normalizeStatus,
} = service;

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  decision: 'Adopt TypeScript',
  context: 'チームの生産性向上が必要',
  rationale: '型安全性による品質向上',
  predictedOutcome: '3ヶ月でエラーが50%減少',
  confidence: 0.7,
  reviewDate: new Date('2025-12-31'),
  actualOutcome: null,
  calibration: 'pending',
  status: 'open',
  themeId: null,
  taskId: null,
  reviewedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('normalizeCalibration', () => {
  test.each([
    ['correct', 'correct'],
    ['partial', 'partial'],
    ['wrong', 'wrong'],
    ['pending', 'pending'],
    ['invalid', 'pending'],
    [undefined, 'pending'],
    [null, 'pending'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalizeCalibration(input)).toBe(expected);
  });
});

describe('normalizeStatus', () => {
  test.each([
    ['open', 'open'],
    ['reviewed', 'reviewed'],
    ['archived', 'archived'],
    ['unknown', 'open'],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalizeStatus(input)).toBe(expected);
  });
});

describe('createDecision', () => {
  beforeEach(() => {
    mockDecisionLog.create.mockReset().mockReturnValue(Promise.resolve(makeEntry()));
  });

  test('必須フィールドで決定を作成', async () => {
    const result = await createDecision({
      decision: 'Adopt TypeScript',
      context: '背景',
      predictedOutcome: '予想',
    });

    expect(result.id).toBe(1);
    expect(mockDecisionLog.create).toHaveBeenCalledTimes(1);
    const call = mockDecisionLog.create.mock.calls[0][0];
    expect(call.data.decision).toBe('Adopt TypeScript');
    expect(call.data.calibration).toBeUndefined();
  });

  test('confidence が 0–1 にクランプされる', async () => {
    mockDecisionLog.create.mockReturnValue(Promise.resolve(makeEntry({ confidence: 1.0 })));
    await createDecision({
      decision: 'test',
      context: 'ctx',
      predictedOutcome: 'out',
      confidence: 1.5,
    });

    const call = mockDecisionLog.create.mock.calls[0][0];
    expect(call.data.confidence).toBe(1.0);
  });
});

describe('listDecisions', () => {
  beforeEach(() => {
    mockDecisionLog.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockDecisionLog.count.mockReset().mockReturnValue(Promise.resolve(0));
  });

  test('status フィルタが where に反映される', async () => {
    await listDecisions({ status: 'open' });
    const call = mockDecisionLog.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('open');
  });

  test('status=all のとき where に status を含まない', async () => {
    await listDecisions({ status: 'all' });
    const call = mockDecisionLog.findMany.mock.calls[0][0];
    expect(call.where.status).toBeUndefined();
  });

  test('ページネーションが take/skip に反映される', async () => {
    await listDecisions({ limit: 5, offset: 10 });
    const call = mockDecisionLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(5);
    expect(call.skip).toBe(10);
  });

  test('total と decisions を返す', async () => {
    mockDecisionLog.findMany.mockReturnValue(Promise.resolve([makeEntry()]));
    mockDecisionLog.count.mockReturnValue(Promise.resolve(1));

    const result = await listDecisions({});
    expect(result.total).toBe(1);
    expect(result.decisions).toHaveLength(1);
  });
});

describe('getDecision', () => {
  test('ID で単一エントリを返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(makeEntry()));
    const result = await getDecision(1);
    expect(result?.id).toBe(1);
  });

  test('存在しない ID は null を返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(null));
    const result = await getDecision(999);
    expect(result).toBeNull();
  });
});

describe('updateDecision', () => {
  beforeEach(() => {
    mockDecisionLog.findUnique.mockReset().mockReturnValue(Promise.resolve(makeEntry()));
    mockDecisionLog.update.mockReset().mockReturnValue(Promise.resolve({}));
  });

  test('存在するエントリを更新して true を返す', async () => {
    const ok = await updateDecision(1, { decision: '新しい決定' });
    expect(ok).toBe(true);
    expect(mockDecisionLog.update).toHaveBeenCalledTimes(1);
  });

  test('存在しない ID は false を返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(null));
    const ok = await updateDecision(999, { decision: 'x' });
    expect(ok).toBe(false);
    expect(mockDecisionLog.update).not.toHaveBeenCalled();
  });
});

describe('deleteDecision', () => {
  test('存在するエントリを削除して true を返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(makeEntry()));
    mockDecisionLog.delete.mockReturnValue(Promise.resolve({}));

    const ok = await deleteDecision(1);
    expect(ok).toBe(true);
    expect(mockDecisionLog.delete).toHaveBeenCalledTimes(1);
  });

  test('存在しない ID は false を返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(null));
    const ok = await deleteDecision(999);
    expect(ok).toBe(false);
  });
});

describe('getReviewDue', () => {
  beforeEach(() => {
    // Reset call history so `mock.calls[0]` refers to this block's own call,
    // not a stale call left over from earlier describe blocks.
    mockDecisionLog.findMany.mockReset().mockReturnValue(Promise.resolve([]));
  });

  test('status=open かつ reviewDate <= now のエントリを返す', async () => {
    const pastDate = new Date('2020-01-01');
    const futureDate = new Date('2099-01-01');
    const overdueDue = makeEntry({ reviewDate: pastDate });
    const futureDue = makeEntry({ id: 2, reviewDate: futureDate });

    mockDecisionLog.findMany.mockReturnValue(Promise.resolve([overdueDue]));
    const result = await getReviewDue();

    expect(result).toHaveLength(1);
    const call = mockDecisionLog.findMany.mock.calls[0][0];
    expect(call.where.status).toBe('open');
    // reviewDate.lte should be set
    expect(call.where.reviewDate.lte).toBeDefined();
    // The mock returns overdueDue (filtered), not futureDue
    expect(result[0].id).toBe(overdueDue.id);
  });

  test('limit パラメータが take に反映される', async () => {
    mockDecisionLog.findMany.mockReturnValue(Promise.resolve([]));
    await getReviewDue(5);
    const call = mockDecisionLog.findMany.mock.calls[0][0];
    expect(call.take).toBe(5);
  });
});

describe('recordReview', () => {
  test('実績とキャリブレーションを記録してステータスを reviewed に更新', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(makeEntry()));
    mockDecisionLog.update.mockReturnValue(Promise.resolve({}));

    const ok = await recordReview(1, { actualOutcome: '予測通り', calibration: 'correct' });

    expect(ok).toBe(true);
    const call = mockDecisionLog.update.mock.calls[0][0];
    expect(call.data.calibration).toBe('correct');
    expect(call.data.status).toBe('reviewed');
    expect(call.data.reviewedAt).toBeInstanceOf(Date);
  });

  test('存在しない ID は false を返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(null));
    const ok = await recordReview(999, { actualOutcome: 'x', calibration: 'wrong' });
    expect(ok).toBe(false);
  });
});

describe('getCalibrationStats', () => {
  test('正解率を計算して返す', async () => {
    mockDecisionLog.count
      .mockReturnValueOnce(Promise.resolve(10)) // total
      .mockReturnValueOnce(Promise.resolve(4)); // reviewed
    mockDecisionLog.groupBy.mockReturnValue(
      Promise.resolve([
        { calibration: 'correct', _count: { id: 2 } },
        { calibration: 'wrong', _count: { id: 2 } },
      ]),
    );

    const stats = await getCalibrationStats();

    expect(stats.total).toBe(10);
    expect(stats.reviewed).toBe(4);
    expect(stats.accuracy).toBe(0.5); // 2 correct / 4 reviewed
    expect(stats.byCalibration).toHaveLength(2);
  });

  test('レビュー済みが 0 件のとき accuracy は 0 (ゼロ除算回避)', async () => {
    mockDecisionLog.count
      .mockReturnValueOnce(Promise.resolve(5))
      .mockReturnValueOnce(Promise.resolve(0));
    mockDecisionLog.groupBy.mockReturnValue(Promise.resolve([]));

    const stats = await getCalibrationStats();
    expect(stats.accuracy).toBe(0);
  });
});

describe('convertDecisionToTask', () => {
  beforeEach(() => {
    // Reset call history so `mock.calls[0]` refers to this block's own call,
    // not a stale call left over from earlier describe blocks.
    mockDecisionLog.findUnique.mockReset();
    mockDecisionLog.update.mockReset().mockReturnValue(Promise.resolve({}));
  });

  test('決定をタスクに変換してタスクIDを記録', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(makeEntry({ taskId: null })));
    mockDecisionLog.update.mockReturnValue(Promise.resolve({}));
    (createTask as ReturnType<typeof mock>).mockReturnValue(Promise.resolve({ id: 100 }));

    const taskId = await convertDecisionToTask(1);

    expect(taskId).toBe(100);
    const updateCall = mockDecisionLog.update.mock.calls[0][0];
    expect(updateCall.data.taskId).toBe(100);
  });

  test('存在しない ID は null を返す', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(null));
    const result = await convertDecisionToTask(999);
    expect(result).toBeNull();
  });

  test('既にタスク化された決定はエラーをスローする', async () => {
    mockDecisionLog.findUnique.mockReturnValue(Promise.resolve(makeEntry({ taskId: 50 })));
    await expect(convertDecisionToTask(1)).rejects.toThrow('既にタスク化されています');
  });
});
